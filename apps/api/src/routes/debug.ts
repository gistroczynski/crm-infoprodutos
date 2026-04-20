import { Router, Request, Response } from 'express'
import { query, queryOne } from '../db'
import { hotmartService } from '../services/hotmart'

export const debugRouter = Router()

// ── GET /api/debug/sync-datas ──────────────────────────────────────────────
// Diagnóstico: mostra a última compra no banco, a última sync e o gap atual.
// Útil para entender por que vendas recentes não aparecem.
debugRouter.get('/sync-datas', async (_req: Request, res: Response) => {
  try {
    const [ultimaCompraRow, ultimaSyncRow, distRow] = await Promise.all([
      queryOne<{ data: string; transaction_id: string; produto: string }>(`
        SELECT
          co.data_compra::text  AS data,
          co.hotmart_transaction_id AS transaction_id,
          p.nome AS produto
        FROM compras co
        JOIN produtos p ON p.id = co.produto_id
        WHERE co.status IN ('COMPLETE', 'APPROVED')
        ORDER BY co.data_compra DESC
        LIMIT 1
      `),
      queryOne<{ valor: string }>(`
        SELECT valor FROM configuracoes WHERE chave = 'ultima_sync'
      `),
      queryOne<{ dias: number; total_compras: number; total_clientes: number }>(`
        SELECT
          EXTRACT(EPOCH FROM (NOW() - MAX(co.data_compra)))::int / 86400 AS dias,
          COUNT(DISTINCT co.id)::int       AS total_compras,
          COUNT(DISTINCT co.cliente_id)::int AS total_clientes
        FROM compras co
        WHERE co.status IN ('COMPLETE', 'APPROVED')
      `),
    ])

    const ultimaCompraData = ultimaCompraRow?.data ? new Date(ultimaCompraRow.data) : null
    const ultimaSyncData   = ultimaSyncRow?.valor  ? new Date(ultimaSyncRow.valor)  : null
    const agora            = new Date()

    // Calcula qual seria a janela de busca do próximo sync incremental
    const proximoDesde = ultimaCompraData
      ? new Date(ultimaCompraData.getTime() - 1 * 24 * 60 * 60 * 1000)
      : null

    res.json({
      data_atual:             agora.toISOString(),
      ultima_compra_no_banco: ultimaCompraRow?.data ?? null,
      ultima_compra_produto:  ultimaCompraRow?.produto ?? null,
      ultima_compra_transaction: ultimaCompraRow?.transaction_id ?? null,
      dias_sem_nova_compra:   distRow?.dias ?? null,
      total_compras_banco:    distRow?.total_compras ?? 0,
      total_clientes_banco:   distRow?.total_clientes ?? 0,
      ultima_sync_rodou_em:   ultimaSyncRow?.valor ?? null,
      proximo_sync_incremental_desde: proximoDesde?.toISOString().slice(0, 10) ?? null,
      diagnostico: {
        problema_detectado: distRow != null && distRow.dias > 3
          ? `⚠️ Última venda há ${distRow.dias} dias — possível gap no sync`
          : '✓ Sync aparenta estar atualizado',
        recomendacao: distRow != null && distRow.dias > 3
          ? 'Execute POST /api/sync/completo para recuperar vendas dos últimos 60 dias'
          : null,
      },
    })
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})

// ── GET /api/debug/hotmart-vendas-recentes ─────────────────────────────────
// Investiga o que a API da Hotmart está retornando para datas recentes.
// Testa 3 formatos de data e retorna o payload bruto completo.
// Query param: ?desde=2026-04-13 (padrão: 8 dias atrás)
debugRouter.get('/hotmart-vendas-recentes', async (req: Request, res: Response) => {
  try {
    const desdeStr   = (req.query.desde as string) ?? ''
    const desdeDate  = desdeStr ? new Date(desdeStr + 'T00:00:00.000Z') : new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)
    const agoraDate  = new Date()

    const startMs  = desdeDate.getTime()         // milliseconds (ex: 1744502400000)
    const startSec = Math.floor(startMs / 1000)  // seconds     (ex: 1744502400)
    const endMs    = agoraDate.getTime()
    const endSec   = Math.floor(endMs / 1000)

    console.log(`[Debug/Hotmart] Testando start_date=${desdeDate.toISOString()} end_date=${agoraDate.toISOString()}`)

    // ── Teste A: milliseconds (formato atual do código) ──────────────────
    const testeA = await hotmartService.rawRequest('/payments/api/v1/sales/history', {
      max_results:        50,
      transaction_status: 'COMPLETE',
      start_date:         startMs,
      end_date:           endMs,
    })

    // ── Teste B: seconds ──────────────────────────────────────────────────
    const testeB = await hotmartService.rawRequest('/payments/api/v1/sales/history', {
      max_results:        50,
      transaction_status: 'COMPLETE',
      start_date:         startSec,
      end_date:           endSec,
    })

    // ── Teste C: sem filtro de data — últimas N transações ────────────────
    const testeC = await hotmartService.rawRequest('/payments/api/v1/sales/history', {
      max_results:        50,
      transaction_status: 'COMPLETE',
    })

    // ── Teste D: sem filtro de status (tudo) ──────────────────────────────
    const testeD = await hotmartService.rawRequest('/payments/api/v1/sales/history', {
      max_results: 10,
      start_date:  startMs,
      end_date:    endMs,
    })

    function resumir(result: Awaited<ReturnType<typeof hotmartService.rawRequest>>, label: string) {
      const body = result.body as {
        items?: Array<{ purchase?: { order_date?: number; transaction?: string; status?: string }; product?: { name?: string }; buyer?: { email?: string } }>
        page_info?: { total_results?: number; next_page_token?: string; results_per_page?: number }
      }
      const items = body?.items ?? []
      const pageInfo = body?.page_info ?? {}

      // Datas dos itens retornados (para ver se bate com o filtro)
      const datas = items.map(i => i.purchase?.order_date
        ? new Date(i.purchase.order_date).toISOString().slice(0, 10)
        : 'sem_data'
      )

      return {
        label,
        status_http:           result.status,
        total_results_hotmart: pageInfo.total_results ?? 0,
        items_retornados:      items.length,
        tem_proxima_pagina:    !!pageInfo.next_page_token,
        next_page_token:       pageInfo.next_page_token ?? null,
        datas_dos_itens:       [...new Set(datas)].sort(),
        data_mais_recente:     datas.length ? [...datas].sort().reverse()[0] : null,
        data_mais_antiga:      datas.length ? [...datas].sort()[0] : null,
        primeiros_5_itens: items.slice(0, 5).map(i => ({
          transaction: i.purchase?.transaction,
          status:      i.purchase?.status,
          data:        i.purchase?.order_date ? new Date(i.purchase.order_date).toISOString() : null,
          produto:     i.product?.name,
          buyer_email: i.buyer?.email,
        })),
        campos_disponiveis: items[0] ? Object.keys(items[0]) : [],
        payload_bruto_item0: items[0] ?? null,
      }
    }

    res.json({
      parametros_usados: {
        desde_iso:    desdeDate.toISOString(),
        ate_iso:      agoraDate.toISOString(),
        start_date_ms:  startMs,
        end_date_ms:    endMs,
        start_date_sec: startSec,
        end_date_sec:   endSec,
      },
      teste_A_milliseconds:   resumir(testeA, 'start_date em milliseconds (formato atual)'),
      teste_B_seconds:        resumir(testeB, 'start_date em seconds'),
      teste_C_sem_data:       resumir(testeC, 'sem filtro de data (últimas 50)'),
      teste_D_sem_status:     resumir(testeD, 'com data ms, sem filtro de status'),
      diagnostico: {
        formato_que_funciona: (() => {
          const bodyA = testeA.body as { items?: unknown[] }
          const bodyB = testeB.body as { items?: unknown[] }
          const bodyC = testeC.body as { items?: unknown[] }
          const qtdA = (bodyA?.items ?? []).length
          const qtdB = (bodyB?.items ?? []).length
          const qtdC = (bodyC?.items ?? []).length
          if (qtdA > 0) return `✅ Milliseconds funciona (${qtdA} itens)`
          if (qtdB > 0) return `✅ Seconds funciona (${qtdB} itens)`
          if (qtdC > 0) return `⚠️ Nenhum formato com data retorna itens. Sem filtro: ${qtdC} itens — possível que não haja vendas nesse período.`
          return '❌ Nenhuma venda retornada em nenhum formato — verificar credenciais ou período'
        })(),
      },
    })
  } catch (err) {
    console.error('[Debug/Hotmart] Erro:', err)
    res.status(500).json({ success: false, error: String(err) })
  }
})

// ── GET /api/debug/transacoes-raw ─────────────────────────────────────────
// 5 últimas transações sem filtro de status — payload completo para análise
debugRouter.get('/transacoes-raw', async (req: Request, res: Response) => {
  try {
    const n = Math.min(Number(req.query.n ?? 5), 20)
    const result = await hotmartService.buscarTransacoesRaw(n)

    // Para cada item, extrai os campos relevantes para análise
    const analise = result.items.map(item => ({
      // Identificação
      transaction: item.purchase.transaction,
      status:      item.purchase.status,
      data:        new Date(item.purchase.order_date).toISOString().slice(0, 10),

      // Produto
      produto_id:   item.product.id,
      produto_nome: item.product.name,

      // Comprador
      buyer_email: item.buyer.email,

      // ── Campos de order bump ───────────────────────────────────────────
      is_order_bump:  item.purchase.is_order_bump,       // boolean ou undefined
      offer_code:     item.purchase.offer?.code,          // código da oferta
      payment_type:   item.purchase.payment?.type,        // CREDIT_CARD, BILLET, etc
      commission_as:  item.purchase.commission_as,        // PRODUCER, AFFILIATE, etc
      hotmart_fee:    item.purchase.hotmart_fee,          // objeto com total/percentage

      // ── Payload bruto da compra (para inspeção completa) ──────────────
      purchase_raw: item.purchase,

      // ── Campos disponíveis no objeto purchase ─────────────────────────
      campos_purchase: Object.keys(item.purchase),
      campos_item:     Object.keys(item),
    }))

    res.json({
      success:        true,
      http_status:    result.status,
      total_retornado: result.items.length,
      page_info:      result.page_info,
      analise,
      // Payload bruto dos primeiros 3 itens completos
      payloads_brutos: result.items.slice(0, 3),
    })
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) })
  }
})

// ── GET /api/debug/transacao/:id ──────────────────────────────────────────
// Detalhes completos de uma transação específica pelo transaction ID
debugRouter.get('/transacao/:id', async (req: Request, res: Response) => {
  try {
    const result = await hotmartService.buscarDetalheTransacao(req.params.id)
    res.json({ success: result.status < 400, ...result })
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) })
  }
})

// ── GET /api/debug/produto/:hotmartId/ofertas ─────────────────────────────
// Ofertas de um produto específico
debugRouter.get('/produto/:hotmartId/ofertas', async (req: Request, res: Response) => {
  try {
    const result = await hotmartService.buscarOfertasProduto(req.params.hotmartId)
    res.json({ success: result.status < 400, ...result })
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) })
  }
})

// ── GET /api/debug/analise-produtos ──────────────────────────────────────
// Análise de quais produtos são comprados como order bump vs principal
debugRouter.get('/analise-produtos', async (_req: Request, res: Response) => {
  try {
    const [produtos, resumoGeral] = await Promise.all([
      query<{
        id: string
        nome: string
        hotmart_id: string | null
        total_compras: number
        compras_como_order_bump: number
        compras_como_principal: number
        percentual_order_bump: number
        offer_codes_encontrados: string[]
        purchase_types: string[]
      }>(`
        SELECT
          p.id,
          p.nome,
          p.hotmart_id,
          COUNT(co.id)::int                                                    AS total_compras,
          COUNT(CASE WHEN co.is_order_bump = true  THEN 1 END)::int           AS compras_como_order_bump,
          COUNT(CASE WHEN co.is_order_bump = false OR co.is_order_bump IS NULL THEN 1 END)::int
                                                                               AS compras_como_principal,
          CASE WHEN COUNT(co.id) > 0
            THEN ROUND(
              COUNT(CASE WHEN co.is_order_bump = true THEN 1 END)::numeric
              / COUNT(co.id) * 100, 1
            )::float
            ELSE 0
          END                                                                  AS percentual_order_bump,
          COALESCE(
            ARRAY_AGG(DISTINCT co.offer_code) FILTER (WHERE co.offer_code IS NOT NULL),
            '{}'
          )                                                                    AS offer_codes_encontrados,
          COALESCE(
            ARRAY_AGG(DISTINCT co.purchase_type) FILTER (WHERE co.purchase_type IS NOT NULL),
            '{}'
          )                                                                    AS purchase_types
        FROM produtos p
        LEFT JOIN compras co ON co.produto_id = p.id AND co.status IN ('COMPLETE', 'APPROVED')
        GROUP BY p.id, p.nome, p.hotmart_id
        HAVING COUNT(co.id) > 0
        ORDER BY total_compras DESC
      `),

      queryOne<{
        total_compras: number
        com_is_order_bump_preenchido: number
        total_order_bumps: number
        total_sem_flag: number
        offer_codes_distintos: number
        purchase_types: string
      }>(`
        SELECT
          COUNT(*)::int                                              AS total_compras,
          COUNT(CASE WHEN is_order_bump IS NOT NULL THEN 1 END)::int AS com_is_order_bump_preenchido,
          COUNT(CASE WHEN is_order_bump = true THEN 1 END)::int     AS total_order_bumps,
          COUNT(CASE WHEN is_order_bump IS NULL THEN 1 END)::int    AS total_sem_flag,
          COUNT(DISTINCT offer_code)::int                            AS offer_codes_distintos,
          STRING_AGG(DISTINCT purchase_type, ', ') FILTER (WHERE purchase_type IS NOT NULL)
                                                                     AS purchase_types
        FROM compras
        WHERE status IN ('COMPLETE', 'APPROVED')
      `),
    ])

    // Identifica produtos que parecem ser order bumps (>= 50% das compras com is_order_bump=true)
    const provaveisOrderBumps = produtos.filter(p => p.percentual_order_bump >= 50)

    // Alerta sobre cobertura: quantos registros já têm o campo preenchido
    const cobertura = resumoGeral
      ? Math.round((resumoGeral.com_is_order_bump_preenchido / resumoGeral.total_compras) * 100)
      : 0

    res.json({
      alerta_cobertura: cobertura < 100
        ? `⚠️  Apenas ${cobertura}% das compras têm is_order_bump preenchido. Execute um sync completo para popular os campos.`
        : '✅ Todas as compras têm is_order_bump preenchido.',
      resumo: resumoGeral,
      provaveis_order_bumps: provaveisOrderBumps.map(p => ({
        nome: p.nome,
        total_compras: p.total_compras,
        percentual_order_bump: p.percentual_order_bump,
      })),
      produtos,
    })
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) })
  }
})

// ── GET /api/debug/identificar-order-bumps ───────────────────────────────
// Detecta order bumps por co-compra simultânea (mesma transação, ≤ N segundos)
debugRouter.get('/identificar-order-bumps', async (req: Request, res: Response) => {
  try {
    const janelaSeg = Number(req.query.janela_segundos ?? 120) // padrão: 120s

    // Pares de compras com diferença <= janelaSeg (mesmo cliente)
    const pares = await query<{
      co1_id: string
      co2_id: string
      produto1: string
      produto2: string
      valor1: string
      valor2: string
      segundos: number
      data: string
    }>(`
      SELECT
        co1.id          AS co1_id,
        co2.id          AS co2_id,
        p1.nome         AS produto1,
        p2.nome         AS produto2,
        co1.valor::text AS valor1,
        co2.valor::text AS valor2,
        ABS(EXTRACT(EPOCH FROM (co1.data_compra - co2.data_compra)))::int AS segundos,
        co1.data_compra::date::text AS data
      FROM compras co1
      JOIN compras co2
        ON co1.cliente_id = co2.cliente_id
        AND co1.id < co2.id
        AND co1.status IN ('COMPLETE', 'APPROVED') AND co2.status IN ('COMPLETE', 'APPROVED')
        AND ABS(EXTRACT(EPOCH FROM (co1.data_compra - co2.data_compra))) <= $1
      JOIN produtos p1 ON p1.id = co1.produto_id
      JOIN produtos p2 ON p2.id = co2.produto_id
      ORDER BY co1.data_compra DESC
    `, [janelaSeg])

    // Conta quantas vezes cada produto aparece como o MENOR valor em uma co-compra
    const contagemOB: Record<string, { nome: string; contagem: number; ids: string[] }> = {}

    for (const par of pares) {
      const v1 = Number(par.valor1)
      const v2 = Number(par.valor2)
      // O de menor valor é o candidato a order bump (em caso de empate, ambos são candidatos)
      const [ob_id, ob_nome] = v1 <= v2
        ? [par.co1_id, par.produto1]
        : [par.co2_id, par.produto2]

      if (!contagemOB[ob_nome]) contagemOB[ob_nome] = { nome: ob_nome, contagem: 0, ids: [] }
      contagemOB[ob_nome].contagem++
      if (!contagemOB[ob_nome].ids.includes(ob_id)) contagemOB[ob_nome].ids.push(ob_id)
    }

    const ranking = Object.values(contagemOB)
      .sort((a, b) => b.contagem - a.contagem)
      .map(x => ({ ...x, ids: undefined })) // omite ids na resposta resumida

    res.json({
      success:         true,
      janela_segundos: janelaSeg,
      total_pares:     pares.length,
      candidatos_order_bump: ranking,
      aviso: '⚠️  Campo is_order_bump não é retornado pela API Hotmart em /sales/history. Disponível apenas em webhooks. Use POST /api/debug/marcar-order-bumps para marcar historicamente por co-compra.',
    })
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) })
  }
})

// ── POST /api/debug/marcar-order-bumps ────────────────────────────────────
// Marca is_order_bump=true nas compras de menor valor em co-compras simultâneas
// e atualiza o tipo do produto no catálogo
debugRouter.post('/marcar-order-bumps', async (req: Request, res: Response) => {
  try {
    const janelaSeg = Number(req.body?.janela_segundos ?? 120)

    // Identifica as compras que são order bumps (menor valor em par co-compra)
    const { rowCount: marcadas } = await (await import('../db')).pool.query(`
      UPDATE compras SET is_order_bump = true
      WHERE id IN (
        SELECT
          CASE WHEN co1.valor <= co2.valor THEN co1.id ELSE co2.id END AS ob_id
        FROM compras co1
        JOIN compras co2
          ON co1.cliente_id = co2.cliente_id
          AND co1.id < co2.id
          AND co1.status IN ('COMPLETE', 'APPROVED') AND co2.status IN ('COMPLETE', 'APPROVED')
          AND ABS(EXTRACT(EPOCH FROM (co1.data_compra - co2.data_compra))) <= $1
      )
    `, [janelaSeg])

    // Atualiza tipo dos produtos que têm >= 50% das compras marcadas como order_bump
    const produtosParaAtualizar = await query<{ produto_id: string; nome: string; pct: number }>(`
      SELECT
        co.produto_id,
        p.nome,
        ROUND(
          COUNT(CASE WHEN co.is_order_bump = true THEN 1 END)::numeric / COUNT(co.id) * 100, 1
        )::float AS pct
      FROM compras co
      JOIN produtos p ON p.id = co.produto_id
      WHERE co.status IN ('COMPLETE', 'APPROVED')
      GROUP BY co.produto_id, p.nome
      HAVING ROUND(
        COUNT(CASE WHEN co.is_order_bump = true THEN 1 END)::numeric / COUNT(co.id) * 100, 1
      ) >= 50
    `)

    let tiposAtualizados = 0
    for (const p of produtosParaAtualizar) {
      await (await import('../db')).pool.query(
        `UPDATE produtos SET tipo = 'order_bump' WHERE id = $1 AND tipo != 'principal'`,
        [p.produto_id]
      )
      tiposAtualizados++
    }

    res.json({
      success:              true,
      compras_marcadas:     marcadas ?? 0,
      produtos_tipo_order_bump: tiposAtualizados,
      produtos_atualizados: produtosParaAtualizar.map(p => ({ nome: p.nome, pct_ob: p.pct })),
    })
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) })
  }
})

// ── GET /api/debug/compras-sample ─────────────────────────────────────────
// Mostra as 10 compras mais recentes com todos os campos de order bump
debugRouter.get('/compras-sample', async (_req: Request, res: Response) => {
  try {
    const rows = await query<{
      transaction: string
      produto_nome: string
      is_order_bump: boolean
      offer_code: string | null
      purchase_type: string | null
      valor: string
      data_compra: string
    }>(`
      SELECT
        co.hotmart_transaction_id AS transaction,
        p.nome                    AS produto_nome,
        co.is_order_bump,
        co.offer_code,
        co.purchase_type,
        co.valor::text,
        co.data_compra::date::text AS data_compra
      FROM compras co
      JOIN produtos p ON p.id = co.produto_id
      WHERE co.status IN ('COMPLETE', 'APPROVED')
      ORDER BY co.data_compra DESC
      LIMIT 10
    `)
    res.json({ success: true, total: rows.length, compras: rows })
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) })
  }
})
