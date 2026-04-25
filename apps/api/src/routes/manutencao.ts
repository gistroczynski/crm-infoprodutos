import { Router, Request, Response } from 'express'
import { pool, queryOne } from '../db'

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
