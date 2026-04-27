import { Router, Request, Response } from 'express'
import { pool, query, queryOne } from '../db'
import { hotmartService } from '../services/hotmart'

export const manutencaoRouter = Router()

// ── POST /api/manutencao/limpar-duplicatas-compras ─────────────────────────
// Remove compras duplicadas geradas por reimportações de CSV.
//
// Estratégia:
//   1. Para compras com hotmart_transaction_id: mantém apenas a de maior valor
//      por transaction_id (produto principal do pedido).
//   2. Para compras sem hotmart_transaction_id: mantém apenas 1 por
//      (cliente_id, produto_id, data_compra::date).
//
// Executa em transação — faz rollback em caso de erro.
manutencaoRouter.post('/limpar-duplicatas-compras', async (_req: Request, res: Response) => {
  const client = await pool.connect()
  try {
    const [{ total: antes }] = (await client.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM compras WHERE status IN ('COMPLETE', 'APPROVED')`
    )).rows

    await client.query('BEGIN')

    // 1. Duplicatas com transaction_id: mantém a de maior valor
    const { rowCount: removidasPorTransaction } = await client.query(`
      DELETE FROM compras
      WHERE id IN (
        SELECT id FROM (
          SELECT
            id,
            ROW_NUMBER() OVER (
              PARTITION BY hotmart_transaction_id
              ORDER BY valor::numeric DESC NULLS LAST, id ASC
            ) AS rn
          FROM compras
          WHERE hotmart_transaction_id IS NOT NULL
            AND status IN ('COMPLETE', 'APPROVED')
        ) ranked
        WHERE rn > 1
      )
    `)

    // 2. Duplicatas sem transaction_id: mantém a mais antiga por (cliente + produto + data)
    const { rowCount: removidasPorData } = await client.query(`
      DELETE FROM compras
      WHERE id IN (
        SELECT id FROM (
          SELECT
            id,
            ROW_NUMBER() OVER (
              PARTITION BY cliente_id, produto_id, data_compra::date
              ORDER BY id ASC
            ) AS rn
          FROM compras
          WHERE hotmart_transaction_id IS NULL
            AND status IN ('COMPLETE', 'APPROVED')
        ) ranked
        WHERE rn > 1
      )
    `)

    await client.query('COMMIT')

    const [{ total: depois }] = (await client.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM compras WHERE status IN ('COMPLETE', 'APPROVED')`
    )).rows

    const totalRemovidas = (removidasPorTransaction ?? 0) + (removidasPorData ?? 0)

    res.json({
      success:                        true,
      compras_antes:                  Number(antes),
      compras_depois:                 Number(depois),
      total_removidas:                totalRemovidas,
      removidas_por_transaction_id:   removidasPorTransaction ?? 0,
      removidas_por_produto_data:     removidasPorData ?? 0,
    })
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    res.status(500).json({ success: false, error: String(err) })
  } finally {
    client.release()
  }
})

// ── POST /api/manutencao/limpar-compras-sem-id ────────────────────────────
// Remove compras sem hotmart_transaction_id quando já existe uma compra
// equivalente COM transaction_id para o mesmo cliente + produto na mesma data.
// Compras sem ID sem correspondente são mantidas — são compras reais importadas.
manutencaoRouter.post('/limpar-compras-sem-id', async (_req: Request, res: Response) => {
  const client = await pool.connect()
  try {
    const [{ verificadas }] = (await client.query<{ verificadas: string }>(
      `SELECT COUNT(*)::text AS verificadas FROM compras WHERE hotmart_transaction_id IS NULL`
    )).rows

    await client.query('BEGIN')

    const { rowCount: removidas } = await client.query(`
      DELETE FROM compras
      WHERE hotmart_transaction_id IS NULL
        AND id IN (
          SELECT c_sem.id
          FROM compras c_sem
          WHERE c_sem.hotmart_transaction_id IS NULL
            AND EXISTS (
              SELECT 1 FROM compras c_com
              WHERE c_com.cliente_id              = c_sem.cliente_id
                AND c_com.produto_id              = c_sem.produto_id
                AND c_com.hotmart_transaction_id IS NOT NULL
                AND DATE(c_com.data_compra)       = DATE(c_sem.data_compra)
            )
        )
    `)

    await client.query('COMMIT')

    const totalVerificadas = Number(verificadas)
    const totalRemovidas   = removidas ?? 0

    res.json({
      success:    true,
      verificadas: totalVerificadas,
      removidas:   totalRemovidas,
      mantidas:    totalVerificadas - totalRemovidas,
      mensagem:    `${totalRemovidas} compras sem ID removidas por ter equivalente com transaction_id`,
    })
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    res.status(500).json({ success: false, error: String(err) })
  } finally {
    client.release()
  }
})

// ── POST /api/manutencao/corrigir-valores-centavos ────────────────────────
// Divide por 100 compras importadas em centavos:
// - sem casas decimais (valor = FLOOR(valor))
// - acima do produto mais caro (~R$197), threshold em R$200
manutencaoRouter.post('/corrigir-valores-centavos', async (_req: Request, res: Response) => {
  const client = await pool.connect()
  try {
    const { rows: antes } = await client.query<{ id: string; valor: string }>(`
      SELECT id, valor::text
      FROM compras
      WHERE hotmart_transaction_id IS NULL
        AND valor > 200
        AND valor = FLOOR(valor)
      ORDER BY valor DESC
      LIMIT 100
    `)

    if (antes.length === 0) {
      return res.json({
        success:    true,
        corrigidas: 0,
        mensagem:   'Nenhuma compra com valor suspeito encontrada.',
      })
    }

    await client.query('BEGIN')

    const { rowCount: corrigidas } = await client.query(`
      UPDATE compras
      SET valor = valor / 100
      WHERE hotmart_transaction_id IS NULL
        AND valor > 200
        AND valor = FLOOR(valor)
    `)

    const { rows: depois } = await client.query<{ id: string; valor: string }>(`
      SELECT id, valor::text FROM compras WHERE id = ANY($1)
    `, [antes.map(r => r.id)])

    await client.query('COMMIT')

    res.json({
      success:    true,
      corrigidas: corrigidas ?? 0,
      valores_antes:  antes.map(r  => ({ id: r.id,  valor: Number(r.valor)  })),
      valores_depois: depois.map(r => ({ id: r.id,  valor: Number(r.valor)  })),
    })
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    res.status(500).json({ success: false, error: String(err) })
  } finally {
    client.release()
  }
})

// ── GET /api/manutencao/diagnostico-duplicatas ────────────────────────────
// Conta TODAS as compras — sem filtro por transaction_id.
manutencaoRouter.get('/diagnostico-duplicatas', async (_req: Request, res: Response) => {
  try {
    const [totais, porOrigem] = await Promise.all([
      queryOne<{
        total_compras: string
        transacoes_unicas: string
        duplicatas: string
        sem_transaction_id: string
      }>(`
        SELECT
          COUNT(*)                                              AS total_compras,
          COUNT(DISTINCT hotmart_transaction_id)               AS transacoes_unicas,
          COUNT(*) - COUNT(DISTINCT hotmart_transaction_id)    AS duplicatas,
          COUNT(*) FILTER (WHERE hotmart_transaction_id IS NULL) AS sem_transaction_id
        FROM compras
      `),

      pool.query<{ origem: string; quantidade: string }>(`
        SELECT
          CASE
            WHEN hotmart_transaction_id LIKE 'HP%' THEN 'Hotmart real'
            WHEN hotmart_transaction_id IS NULL     THEN 'Sem ID'
            ELSE 'Outro'
          END AS origem,
          COUNT(*)::text AS quantidade
        FROM compras
        GROUP BY 1
        ORDER BY 2 DESC
      `),
    ])

    res.json({
      total_compras:      Number(totais?.total_compras      ?? 0),
      transacoes_unicas:  Number(totais?.transacoes_unicas  ?? 0),
      duplicatas:         Number(totais?.duplicatas         ?? 0),
      sem_transaction_id: Number(totais?.sem_transaction_id ?? 0),
      por_origem: porOrigem.rows.map(r => ({
        origem:     r.origem,
        quantidade: Number(r.quantidade),
      })),
    })
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) })
  }
})

// ── GET /api/manutencao/status-duplicatas ──────────────────────────────────
// Contagem rápida de duplicatas existentes sem modificar nada.
manutencaoRouter.get('/status-duplicatas', async (_req: Request, res: Response) => {
  try {
    const [porTransaction, porData, totais] = await Promise.all([
      queryOne<{ grupos: number; linhas_extras: number }>(`
        SELECT
          COUNT(DISTINCT hotmart_transaction_id)::int AS grupos,
          (SUM(cnt) - COUNT(*))::int                 AS linhas_extras
        FROM (
          SELECT hotmart_transaction_id, COUNT(*) AS cnt
          FROM compras
          WHERE hotmart_transaction_id IS NOT NULL
            AND status IN ('COMPLETE', 'APPROVED')
          GROUP BY hotmart_transaction_id
          HAVING COUNT(*) > 1
        ) sub
      `),

      queryOne<{ grupos: number; linhas_extras: number }>(`
        SELECT
          COUNT(*)::int                      AS grupos,
          (SUM(cnt) - COUNT(*))::int         AS linhas_extras
        FROM (
          SELECT cliente_id, produto_id, data_compra::date, COUNT(*) AS cnt
          FROM compras
          WHERE hotmart_transaction_id IS NULL
            AND status IN ('COMPLETE', 'APPROVED')
          GROUP BY cliente_id, produto_id, data_compra::date
          HAVING COUNT(*) > 1
        ) sub
      `),

      queryOne<{ total: number; total_gasto_bruto: string; total_gasto_correto: string }>(`
        SELECT
          COUNT(*)::int                                            AS total,
          SUM(valor::numeric)::text                               AS total_gasto_bruto,
          (
            SELECT SUM(valor::numeric)::text
            FROM (
              SELECT DISTINCT ON (COALESCE(hotmart_transaction_id, id::text))
                valor
              FROM compras
              WHERE status IN ('COMPLETE', 'APPROVED')
              ORDER BY COALESCE(hotmart_transaction_id, id::text), valor::numeric DESC
            ) sub
          )                                                       AS total_gasto_correto
        FROM compras
        WHERE status IN ('COMPLETE', 'APPROVED')
      `),
    ])

    const bruto  = Number(totais?.total_gasto_bruto  ?? 0)
    const correto = Number(totais?.total_gasto_correto ?? 0)

    res.json({
      total_compras:              totais?.total ?? 0,
      total_gasto_bruto:          bruto,
      total_gasto_correto:        correto,
      diferenca:                  Math.round((bruto - correto) * 100) / 100,
      duplicatas_por_transaction: porTransaction ?? { grupos: 0, linhas_extras: 0 },
      duplicatas_por_data:        porData        ?? { grupos: 0, linhas_extras: 0 },
      total_linhas_extras:
        (porTransaction?.linhas_extras ?? 0) + (porData?.linhas_extras ?? 0),
    })
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) })
  }
})

// ── POST /api/manutencao/sincronizar-transaction-ids ──────────────────────
// Para cada compra sem hotmart_transaction_id, busca na API da Hotmart pelo
// email do cliente + data da compra. Se encontrar → atualiza o campo.
// Isso permite que o DISTINCT ON das queries de receita deduplique corretamente.
//
// Query params opcionais: ?inicio=2026-04-01&fim=2026-04-30
// Por padrão processa todos os meses com compras sem ID.
manutencaoRouter.post('/sincronizar-transaction-ids', async (req: Request, res: Response) => {
  try {
    const inicioPar = req.query.inicio as string | undefined
    const fimPar    = req.query.fim    as string | undefined

    // 1. Busca compras sem transaction_id
    const whereExtra: string[] = []
    const params: unknown[] = []
    if (inicioPar) {
      params.push(inicioPar)
      whereExtra.push(`(co.data_compra AT TIME ZONE 'America/Sao_Paulo')::date >= $${params.length}::date`)
    }
    if (fimPar) {
      params.push(fimPar)
      whereExtra.push(`(co.data_compra AT TIME ZONE 'America/Sao_Paulo')::date <= $${params.length}::date`)
    }
    const extraWhere = whereExtra.length ? `AND ${whereExtra.join(' AND ')}` : ''

    const compras = await query<{
      id: string; email: string; produto_nome: string; data_compra: string; valor: number | null
    }>(`
      SELECT
        co.id,
        c.email,
        p.nome                                                         AS produto_nome,
        (co.data_compra AT TIME ZONE 'America/Sao_Paulo')::date::text AS data_compra,
        co.valor::float                                                AS valor
      FROM compras co
      JOIN clientes c ON c.id = co.cliente_id
      JOIN produtos p ON p.id = co.produto_id
      WHERE co.hotmart_transaction_id IS NULL
        ${extraWhere}
      ORDER BY co.data_compra
    `, params)

    if (compras.length === 0) {
      return res.json({ success: true, total: 0, atualizadas: 0, sem_match: 0, mensagem: 'Nenhuma compra sem transaction_id.' })
    }

    // 2. Descobre meses únicos para buscar na Hotmart com o mínimo de chamadas
    const mesesSet = new Set<string>()
    for (const c of compras) mesesSet.add(c.data_compra.slice(0, 7))

    // 3. Busca todas as vendas Hotmart por mês e indexa por email+data
    const fmt = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' })
    type TxInfo = { transaction: string; produto_nome: string }
    // chave: `email|YYYY-MM-DD`  →  lista de transações nesse dia
    const indexEmailData = new Map<string, TxInfo[]>()

    for (const mes of [...mesesSet].sort()) {
      const inicioMs = new Date(mes + '-01T00:00:00Z').getTime()
      const fimDate  = new Date(mes + '-01T00:00:00Z')
      fimDate.setUTCMonth(fimDate.getUTCMonth() + 1)
      fimDate.setUTCDate(0)
      fimDate.setUTCHours(23, 59, 59, 999)
      const fimMs = fimDate.getTime()

      console.log(`[sincronizar-tx-ids] Buscando Hotmart ${mes}...`)
      const itens = await hotmartService.buscarVendasPorPeriodo(inicioMs, fimMs)

      for (const item of itens) {
        const emailKey = item.buyer.email.toLowerCase().trim()
        const dataBRT  = fmt.format(new Date(item.purchase.order_date))
        const chave    = `${emailKey}|${dataBRT}`
        if (!indexEmailData.has(chave)) indexEmailData.set(chave, [])
        indexEmailData.get(chave)!.push({
          transaction:  item.purchase.transaction,
          produto_nome: item.product.name,
        })
      }
    }

    // 4. Tenta fazer match e atualizar cada compra
    let atualizadas = 0
    let semMatch    = 0
    const detalhes: Array<{
      id: string; email: string; produto: string; data: string
      transaction_id: string | null; match: boolean; motivo?: string
    }> = []

    for (const compra of compras) {
      const chave = `${compra.email.toLowerCase()}|${compra.data_compra}`
      const candidatos = indexEmailData.get(chave) ?? []

      let escolhido: TxInfo | undefined

      if (candidatos.length === 1) {
        // Match único por email + data — sem ambiguidade
        escolhido = candidatos[0]
      } else if (candidatos.length > 1) {
        // Desempata pelo nome do produto (normalizado)
        const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
        const normProduto = norm(compra.produto_nome)
        escolhido = candidatos.find(c => norm(c.produto_nome).includes(normProduto) || normProduto.includes(norm(c.produto_nome)))
        if (!escolhido) escolhido = candidatos[0] // fallback: primeiro candidato
      }

      if (escolhido) {
        await pool.query(
          `UPDATE compras SET hotmart_transaction_id = $1, updated_at = NOW() WHERE id = $2`,
          [escolhido.transaction, compra.id]
        )
        atualizadas++
        detalhes.push({ id: compra.id, email: compra.email, produto: compra.produto_nome, data: compra.data_compra, transaction_id: escolhido.transaction, match: true })
      } else {
        semMatch++
        detalhes.push({ id: compra.id, email: compra.email, produto: compra.produto_nome, data: compra.data_compra, transaction_id: null, match: false, motivo: 'email+data não encontrados na API Hotmart' })
      }
    }

    res.json({
      success:    true,
      total:      compras.length,
      atualizadas,
      sem_match:  semMatch,
      meses_consultados: [...mesesSet].sort(),
      detalhes,
    })
  } catch (err) {
    console.error('[sincronizar-transaction-ids] Erro:', err)
    res.status(500).json({ success: false, error: String(err) })
  }
})
