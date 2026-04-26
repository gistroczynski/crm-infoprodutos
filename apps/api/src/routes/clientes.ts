import { Router, Request, Response } from 'express'
import { query, queryOne } from '../db'
import { z } from 'zod'
import type { Cliente } from '@crm/shared'

export const clientesRouter = Router()

const clienteSchema = z.object({
  nome: z.string().min(1),
  email: z.string().email(),
  telefone_raw: z.string().optional(),
  hotmart_id: z.string().optional(),
})

// ── GET /clientes ──────────────────────────────────────────────────────────
clientesRouter.get('/', async (req: Request, res: Response) => {
  try {
    const page    = Math.max(1, Number(req.query.page  ?? 1))
    const limit   = Math.min(100, Math.max(1, Number(req.query.limit ?? req.query.per_page ?? 20)))
    const offset  = (page - 1) * limit
    const search    = req.query.search    as string | undefined
    const status    = req.query.status    as string | undefined
    const prioridade = req.query.prioridade as string | undefined
    const compras   = req.query.compras   as string | undefined  // 'com' | 'sem'

    // Build WHERE conditions — params start at $3 (limit=$1, offset=$2)
    const conditions: string[] = []
    const params: unknown[]    = [limit, offset]

    if (search) {
      params.push(`%${search}%`)
      conditions.push(`(c.nome ILIKE $${params.length} OR c.email ILIKE $${params.length})`)
    }
    if (status) {
      params.push(status)
      conditions.push(`COALESCE(sc.status, 'novo') = $${params.length}`)
    }
    if (prioridade) {
      params.push(prioridade)
      conditions.push(`COALESCE(ls.prioridade, 'baixa') = $${params.length}`)
    }
    if (compras === 'com') {
      conditions.push(`EXISTS (SELECT 1 FROM compras co2 WHERE co2.cliente_id = c.id AND co2.status IN ('COMPLETE', 'APPROVED'))`)
    } else if (compras === 'sem') {
      conditions.push(`NOT EXISTS (SELECT 1 FROM compras co2 WHERE co2.cliente_id = c.id AND co2.status IN ('COMPLETE', 'APPROVED'))`)
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

    const rows = await query<{
      id: string; nome: string; email: string
      telefone_formatado: string | null; telefone_valido: boolean
      score: number; prioridade: string; status: string
      total_compras: number; total_gasto: number
      ultima_compra: string | null; dias_desde_ultima_compra: number | null
      ultimo_produto: string | null
    }>(`
      SELECT
        c.id, c.nome, c.email, c.telefone_formatado, c.telefone_valido,
        CASE WHEN COUNT(co.id) FILTER (WHERE co.status IN ('COMPLETE', 'APPROVED')) = 0
             THEN 0
             ELSE COALESCE(ls.score, 0)
        END AS score,
        CASE WHEN COUNT(co.id) FILTER (WHERE co.status IN ('COMPLETE', 'APPROVED')) = 0
             THEN 'baixa'
             ELSE COALESCE(ls.prioridade, 'baixa')
        END AS prioridade,
        CASE WHEN COUNT(co.id) FILTER (WHERE co.status IN ('COMPLETE', 'APPROVED')) = 0
             THEN 'sem_compras'
             ELSE COALESCE(sc.status, 'novo')
        END AS status,

        COUNT(co.id)    FILTER (WHERE co.status IN ('COMPLETE', 'APPROVED'))::int   AS total_compras,
        COALESCE(SUM(co.valor::numeric) FILTER (WHERE co.status IN ('COMPLETE', 'APPROVED')), 0)::float
                                                                      AS total_gasto,
        MAX(co.data_compra) FILTER (WHERE co.status IN ('COMPLETE', 'APPROVED'))    AS ultima_compra,
        (CURRENT_DATE - MAX(co.data_compra::date) FILTER (WHERE co.status IN ('COMPLETE', 'APPROVED')))::int
                                                                      AS dias_desde_ultima_compra,

        -- Nome do último produto comprado
        (
          SELECT p2.nome
          FROM compras co2
          JOIN produtos p2 ON p2.id = co2.produto_id
          WHERE co2.cliente_id = c.id AND co2.status IN ('COMPLETE', 'APPROVED')
          ORDER BY co2.data_compra DESC
          LIMIT 1
        ) AS ultimo_produto

      FROM clientes c
      LEFT JOIN lead_scores    ls ON ls.cliente_id = c.id
      LEFT JOIN status_clientes sc ON sc.cliente_id = c.id
      LEFT JOIN compras        co ON co.cliente_id  = c.id
      ${whereClause}
      GROUP BY c.id, c.nome, c.email, c.telefone_formatado, c.telefone_valido,
               ls.score, ls.prioridade, sc.status
      ORDER BY COALESCE(ls.score, 0) DESC
      LIMIT $1 OFFSET $2
    `, params)

    // Count with same filters
    const countParams: unknown[] = []
    const countConditions: string[] = []
    if (search) {
      countParams.push(`%${search}%`)
      countConditions.push(`(c.nome ILIKE $${countParams.length} OR c.email ILIKE $${countParams.length})`)
    }
    if (status) {
      countParams.push(status)
      countConditions.push(`COALESCE(sc.status, 'novo') = $${countParams.length}`)
    }
    if (prioridade) {
      countParams.push(prioridade)
      countConditions.push(`COALESCE(ls.prioridade, 'baixa') = $${countParams.length}`)
    }
    if (compras === 'com') {
      countConditions.push(`EXISTS (SELECT 1 FROM compras co2 WHERE co2.cliente_id = c.id AND co2.status IN ('COMPLETE', 'APPROVED'))`)
    } else if (compras === 'sem') {
      countConditions.push(`NOT EXISTS (SELECT 1 FROM compras co2 WHERE co2.cliente_id = c.id AND co2.status IN ('COMPLETE', 'APPROVED'))`)
    }
    const countWhere = countConditions.length ? `WHERE ${countConditions.join(' AND ')}` : ''

    const [{ total }] = await query<{ total: string }>(`
      SELECT COUNT(DISTINCT c.id)::text AS total
      FROM clientes c
      LEFT JOIN lead_scores    ls ON ls.cliente_id = c.id
      LEFT JOIN status_clientes sc ON sc.cliente_id = c.id
      ${countWhere}
    `, countParams)

    const totalNum = Number(total)
    res.json({
      clientes:    rows,
      total:       totalNum,
      page,
      limit,
      total_pages: Math.ceil(totalNum / limit),
    })
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})

// ── GET /clientes/:id  — perfil completo ────────────────────────────────────
clientesRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id

    const [clienteRow, scoreRow, statusRow, comprasRows] = await Promise.all([
      queryOne<{
        id: string; nome: string; email: string
        telefone_formatado: string | null; telefone_valido: boolean; created_at: string
      }>(`SELECT id, nome, email, telefone_formatado, telefone_valido, created_at FROM clientes WHERE id = $1`, [id]),

      queryOne<{ score: number; prioridade: string; motivos: string; updated_at: string }>(
        `SELECT score, prioridade, motivos, updated_at FROM lead_scores WHERE cliente_id = $1`, [id]
      ),

      queryOne<{ status: string }>(
        `SELECT status FROM status_clientes WHERE cliente_id = $1`, [id]
      ),

      query<{
        id: string; produto_nome: string; produto_tipo: string
        is_order_bump: boolean; valor: number | null
        data_compra: string; primeira_compra: string; dias_atras: number
        num_compras: number; total_pago: number; is_assinatura: boolean
      }>(`
        SELECT
          co.produto_id                                                                       AS id,
          p.nome                                                                              AS produto_nome,
          COALESCE(p.tipo, 'entrada')                                                        AS produto_tipo,
          bool_or(COALESCE(co.is_order_bump, false))                                         AS is_order_bump,
          COUNT(*)::int                                                                       AS num_compras,
          COALESCE(SUM(COALESCE(co.valor_liquido, co.valor)::numeric), 0)::float             AS total_pago,
          (ARRAY_AGG(COALESCE(co.valor_liquido, co.valor)::float
            ORDER BY co.data_compra DESC))[1]                                                AS valor,
          (MIN(co.data_compra) AT TIME ZONE 'America/Sao_Paulo')::date::text                AS primeira_compra,
          (MAX(co.data_compra) AT TIME ZONE 'America/Sao_Paulo')::date::text                AS data_compra,
          (COUNT(*) > 1)                                                                      AS is_assinatura,
          (CURRENT_DATE - (MAX(co.data_compra) AT TIME ZONE 'America/Sao_Paulo')::date)::int AS dias_atras
        FROM compras co
        JOIN produtos p ON p.id = co.produto_id
        WHERE co.cliente_id = $1 AND co.status IN ('COMPLETE', 'APPROVED')
        GROUP BY co.produto_id, p.nome, p.tipo
        ORDER BY MAX(co.data_compra) DESC
      `, [id]),
    ])

    if (!clienteRow) return res.status(404).json({ error: 'Cliente não encontrado' })

    // ── Resumo ──────────────────────────────────────────────────────────────
    // Cada linha já é única por produto (GROUP BY). total_pago acumula todas as cobranças.
    const totalGasto         = comprasRows.reduce((s, c) => s + (c.total_pago ?? 0), 0)
    const quantidadeCompras  = comprasRows.reduce((s, c) => s + (c.num_compras ?? 1), 0)

    const todasPrimeiras = comprasRows.map(c => new Date(c.primeira_compra + 'T12:00:00').getTime())
    const diasPrimeira = todasPrimeiras.length
      ? Math.round((Date.now() - Math.min(...todasPrimeiras)) / 86_400_000)
      : null
    const diasUltima = comprasRows.length ? comprasRows[0].dias_atras : null

    // ── Jornada: entrada → order_bump → upsell (tipo=principal) ─────────────
    const temEntrada   = comprasRows.some(c => c.produto_tipo === 'entrada')
    const temOrderBump = comprasRows.some(c => c.is_order_bump === true)
    const temUpsell    = comprasRows.some(c => c.produto_tipo === 'principal')

    let proximo_passo_sugerido: string
    if (!temEntrada)        proximo_passo_sugerido = 'Indicar produto de entrada'
    else if (!temOrderBump) proximo_passo_sugerido = 'Oferecer order bump'
    else if (!temUpsell)    proximo_passo_sugerido = 'Momento ideal para oferecer o Upsell'
    else                    proximo_passo_sugerido = 'Cliente ascendido ✓'

    res.json({
      cliente: clienteRow,
      score: scoreRow
        ? { ...scoreRow, motivos: typeof scoreRow.motivos === 'string' ? JSON.parse(scoreRow.motivos) : scoreRow.motivos }
        : { score: 0, prioridade: 'baixa', motivos: [], updated_at: null },
      status: statusRow?.status ?? 'novo',
      compras: comprasRows,
      resumo: {
        total_gasto:                Math.round(totalGasto * 100) / 100,
        quantidade_compras:         quantidadeCompras,
        dias_desde_primeira_compra: diasPrimeira,
        dias_desde_ultima_compra:   diasUltima,
        tem_produto_upsell:         temUpsell,
        proximo_passo_sugerido,
      },
    })
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})

// ── POST /clientes ─────────────────────────────────────────────────────────
clientesRouter.post('/', async (req: Request, res: Response) => {
  try {
    const body = clienteSchema.parse(req.body)
    const [cliente] = await query<Cliente>(`
      INSERT INTO clientes (nome, email, telefone_raw, hotmart_id)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [body.nome, body.email, body.telefone_raw ?? null, body.hotmart_id ?? null])
    res.status(201).json(cliente)
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors })
    res.status(500).json({ error: String(err) })
  }
})

// ── PATCH /clientes/:id ────────────────────────────────────────────────────
clientesRouter.patch('/:id', async (req: Request, res: Response) => {
  try {
    const body = clienteSchema.partial().parse(req.body)
    const fields = Object.entries(body)
    if (fields.length === 0) return res.status(400).json({ error: 'Nenhum campo para atualizar' })

    const setClause = fields.map(([k], i) => `${k} = $${i + 2}`).join(', ')
    const values    = fields.map(([, v]) => v)

    const [cliente] = await query<Cliente>(
      `UPDATE clientes SET ${setClause}, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [req.params.id, ...values]
    )
    if (!cliente) return res.status(404).json({ error: 'Cliente não encontrado' })
    res.json(cliente)
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors })
    res.status(500).json({ error: String(err) })
  }
})
