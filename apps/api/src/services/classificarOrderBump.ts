import { pool, query } from '../db'

// ── Tipos ──────────────────────────────────────────────────────────────────

export interface ClassificacaoOB {
  is_order_bump: boolean
  motivo: string
}

interface CompraInput {
  id?: string                    // pode ser nova (ainda sem id)
  hotmart_transaction_id: string
  valor: number | null
  offer_code?: string | null
  is_order_bump_webhook?: boolean // campo is_order_bump vindo de webhook
}

interface OutraCompraNaJanela {
  hotmart_transaction_id: string
  valor: number | null
}

// ── Classificação de uma única compra ──────────────────────────────────────

/**
 * Aplica as regras em ordem de prioridade:
 *  a) webhook: campo is_order_bump recebido diretamente
 *  b) offer_code: padrão de texto sugere order bump
 *  c) co-compra: menor valor em janela temporal com outro produto
 */
export function classificarCompraComoOrderBump(
  compra: CompraInput,
  outrasComprasNaJanela: OutraCompraNaJanela[],
  valorMaximoOB: number = 100,
): ClassificacaoOB {

  // ── Regra a: webhook informou explicitamente ────────────────────────────
  if (compra.is_order_bump_webhook === true) {
    return { is_order_bump: true, motivo: 'webhook:is_order_bump=true' }
  }
  if (compra.is_order_bump_webhook === false) {
    return { is_order_bump: false, motivo: 'webhook:is_order_bump=false' }
  }

  // ── Regra b: offer_code indica order bump ───────────────────────────────
  if (compra.offer_code) {
    const lower = compra.offer_code.toLowerCase()
    if (/bump|_ob[_-]|^ob[_-]|order.?bump/.test(lower)) {
      return { is_order_bump: true, motivo: `offer_code:${compra.offer_code}` }
    }
  }

  // ── Regra c: co-compra de menor valor dentro de janela temporal ─────────
  if (outrasComprasNaJanela.length > 0 && compra.valor !== null) {
    const valorAtual = compra.valor
    const maxOutras  = Math.max(...outrasComprasNaJanela.map(c => Number(c.valor) || 0))

    if (valorAtual <= valorMaximoOB && valorAtual < maxOutras) {
      return {
        is_order_bump: true,
        motivo: `co-compra:R$${valorAtual.toFixed(2)}<R$${maxOutras.toFixed(2)},max_ob=R$${valorMaximoOB}`,
      }
    }
  }

  return { is_order_bump: false, motivo: '' }
}

// ── Reclassificação em massa no banco ──────────────────────────────────────

/**
 * Reclassifica TODAS as compras COMPLETE no banco usando as 3 regras.
 * Chamado após sync completo e pode ser chamado manualmente.
 */
export async function reclassificarTodasCompras(valorMaximoOB = 100): Promise<{
  marcadas_ob: number
  desmarcadas: number
  por_regra: Record<string, number>
}> {
  // Reseta classificação primeiro (para re-rodar idempotente)
  await pool.query(`
    UPDATE compras SET is_order_bump = false, motivo_classificacao = NULL
    WHERE status IN ('COMPLETE', 'APPROVED')
  `)

  // ── Regra b: offer_code ─────────────────────────────────────────────────
  const { rowCount: porOfferCode } = await pool.query(`
    UPDATE compras
    SET is_order_bump        = true,
        motivo_classificacao = 'offer_code:' || offer_code
    WHERE status IN ('COMPLETE', 'APPROVED')
      AND offer_code IS NOT NULL
      AND offer_code ~* '(bump|_ob[_-]|^ob[_-]|order.?bump)'
  `)

  // ── Regra c: co-compra de menor valor ───────────────────────────────────
  const { rowCount: porCoCompra } = await pool.query(`
    WITH pares AS (
      SELECT
        co1.id      AS ob_id,
        co1.valor   AS ob_valor,
        MAX(co2.valor) AS max_outro
      FROM compras co1
      JOIN compras co2
        ON co1.cliente_id = co2.cliente_id
        AND co1.id          != co2.id
        AND co1.status IN ('COMPLETE', 'APPROVED')
        AND co2.status IN ('COMPLETE', 'APPROVED')
        AND ABS(EXTRACT(EPOCH FROM (co1.data_compra - co2.data_compra))) <= 120
        AND co1.is_order_bump = false    -- não reclassificar já marcados por offer_code
      WHERE co1.status IN ('COMPLETE', 'APPROVED')
        AND co1.valor  IS NOT NULL
        AND co1.valor  <= $1
      GROUP BY co1.id, co1.valor
      HAVING MAX(co2.valor) > co1.valor
    )
    UPDATE compras c
    SET is_order_bump        = true,
        motivo_classificacao = 'co-compra:R$' || p.ob_valor::text
                               || '<R$' || p.max_outro::text
                               || ',max_ob=R$' || $1::text
    FROM pares p
    WHERE c.id = p.ob_id
  `, [valorMaximoOB])

  // Conta totais finais
  const { rows: stats } = await pool.query(`
    SELECT
      COUNT(CASE WHEN is_order_bump = true  THEN 1 END)::int AS marcadas,
      COUNT(CASE WHEN is_order_bump = false THEN 1 END)::int AS nao_marcadas
    FROM compras WHERE status IN ('COMPLETE', 'APPROVED')
  `)

  return {
    marcadas_ob:  stats[0].marcadas,
    desmarcadas:  stats[0].nao_marcadas,
    por_regra: {
      offer_code:  porOfferCode ?? 0,
      co_compra:   porCoCompra  ?? 0,
    },
  }
}

// ── Reclassifica compras de um cliente específico ─────────────────────────

/**
 * Usado após salvar uma nova compra via webhook/sync incremental.
 * Reclassifica apenas as compras RECENT do cliente (últimas 24h).
 */
export async function reclassificarComprasCliente(
  clienteId: string,
  valorMaximoOB = 100,
): Promise<void> {
  // Busca compras do cliente nas últimas 24h para checar co-compras
  const compras = await query<{
    id: string; hotmart_transaction_id: string; valor: string | null
    offer_code: string | null; data_compra: string
  }>(`
    SELECT id, hotmart_transaction_id, valor::text, offer_code, data_compra
    FROM compras
    WHERE cliente_id = $1
      AND status IN ('COMPLETE', 'APPROVED')
      AND data_compra >= NOW() - INTERVAL '24 hours'
    ORDER BY data_compra
  `, [clienteId])

  if (compras.length === 0) return

  for (const compra of compras) {
    const outrasNaJanela = compras.filter(c => {
      if (c.id === compra.id) return false
      const diff = Math.abs(new Date(c.data_compra).getTime() - new Date(compra.data_compra).getTime())
      return diff <= 120_000 // 120 segundos
    }).map(c => ({
      hotmart_transaction_id: c.hotmart_transaction_id,
      valor: c.valor !== null ? Number(c.valor) : null,
    }))

    const classificacao = classificarCompraComoOrderBump(
      {
        hotmart_transaction_id: compra.hotmart_transaction_id,
        valor: compra.valor !== null ? Number(compra.valor) : null,
        offer_code: compra.offer_code,
      },
      outrasNaJanela,
      valorMaximoOB,
    )

    await pool.query(`
      UPDATE compras SET is_order_bump = $1, motivo_classificacao = $2
      WHERE id = $3
    `, [classificacao.is_order_bump, classificacao.motivo || null, compra.id])
  }
}

// ── Lê valor_maximo_order_bump da config ──────────────────────────────────

export async function lerValorMaximoOB(): Promise<number> {
  const rows = await query<{ valor: string }>(
    `SELECT valor FROM configuracoes WHERE chave = 'valor_maximo_order_bump'`
  )
  return Number(rows[0]?.valor ?? 100)
}
