import { Router, Request, Response } from 'express'
import { query, queryOne } from '../db'

export const vendasRouter = Router()

// ── Helper: monta condições WHERE reutilizáveis ────────────────────────────

function buildWhere(
  inicio: string,
  fim: string,
  produto_id?: string,
  busca?: string,
  startAt = 1,
) {
  const conds: string[] = [
    `co.status = 'COMPLETE'`,
    `co.data_compra >= $${startAt}::date`,
    `co.data_compra <  ($${startAt + 1}::date + INTERVAL '1 day')`,
  ]
  const params: unknown[] = [inicio, fim]

  if (produto_id) {
    params.push(produto_id)
    conds.push(`co.produto_id = $${startAt + params.length - 1}`)
  }
  if (busca) {
    params.push(`%${busca}%`)
    conds.push(`(c.nome ILIKE $${startAt + params.length - 1} OR c.email ILIKE $${startAt + params.length - 1})`)
  }

  return { where: `WHERE ${conds.join(' AND ')}`, params }
}

const FROM_JOIN = `
  FROM compras co
  JOIN clientes c ON c.id = co.cliente_id
  JOIN produtos p ON p.id = co.produto_id
`

// ── GET /api/vendas ─────────────────────────────────────────────────────────

vendasRouter.get('/', async (req: Request, res: Response) => {
  try {
    const page   = Math.max(1, Number(req.query.page  ?? 1))
    const limit  = Math.min(200, Math.max(1, Number(req.query.limit ?? 50)))
    const offset = (page - 1) * limit

    const hoje   = new Date()
    const iniMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1).toISOString().split('T')[0]
    const inicio = (req.query.inicio    as string) || iniMes
    const fim    = (req.query.fim       as string) || hoje.toISOString().split('T')[0]
    const produtoId = req.query.produto_id as string | undefined
    const busca     = req.query.busca      as string | undefined

    // Base params (for count/resumo): $1=inicio, $2=fim, $3+=extras
    const { where: baseWhere, params: baseParams } = buildWhere(inicio, fim, produtoId, busca, 1)

    // List params: $1=limit, $2=offset, $3=inicio, $4=fim, $5+=extras
    const { where: listWhere, params: listBaseParams } = buildWhere(inicio, fim, produtoId, busca, 3)
    const listParams: unknown[] = [limit, offset, ...listBaseParams]

    const [vendas, stats, porDia] = await Promise.all([

      query<{
        id: string; transaction_id: string; cliente_id: string
        cliente_nome: string; cliente_email: string; cliente_telefone: string | null
        produto_nome: string; produto_tipo: string; is_order_bump: boolean
        valor: number | null; data_compra: string; dias_atras: number
      }>(`
        SELECT
          co.id,
          co.hotmart_transaction_id          AS transaction_id,
          c.id                               AS cliente_id,
          c.nome                             AS cliente_nome,
          c.email                            AS cliente_email,
          c.telefone_formatado               AS cliente_telefone,
          p.nome                             AS produto_nome,
          p.tipo                             AS produto_tipo,
          COALESCE(co.is_order_bump, false)  AS is_order_bump,
          co.valor::float                    AS valor,
          co.data_compra,
          (CURRENT_DATE - co.data_compra::date)::int AS dias_atras
        ${FROM_JOIN}
        ${listWhere}
        ORDER BY co.data_compra DESC
        LIMIT $1 OFFSET $2
      `, listParams),

      queryOne<{ total: string; receita: string; ticket: string }>(`
        SELECT
          COUNT(*)::text                                  AS total,
          COALESCE(SUM(co.valor::numeric), 0)::text      AS receita,
          CASE WHEN COUNT(*) > 0
               THEN (SUM(co.valor::numeric) / COUNT(*))::text
               ELSE '0' END                              AS ticket
        ${FROM_JOIN}
        ${baseWhere}
      `, baseParams),

      query<{ data: string; quantidade: string; receita: string }>(`
        SELECT
          co.data_compra::date::text            AS data,
          COUNT(*)::text                        AS quantidade,
          COALESCE(SUM(co.valor::numeric), 0)::text AS receita
        ${FROM_JOIN}
        ${baseWhere}
        GROUP BY co.data_compra::date
        ORDER BY co.data_compra::date
      `, baseParams),
    ])

    const total       = Number(stats?.total   ?? 0)
    const total_pages = Math.ceil(total / limit) || 1

    res.json({
      vendas,
      total,
      page,
      limit,
      total_pages,
      resumo: {
        total_vendas:  total,
        receita_total: Number(stats?.receita ?? 0),
        ticket_medio:  Number(stats?.ticket  ?? 0),
        por_dia: porDia.map(d => ({
          data:       d.data,
          quantidade: Number(d.quantidade),
          receita:    Number(d.receita),
        })),
      },
    })
  } catch (err) {
    console.error('[Vendas] GET /', err)
    res.status(500).json({ error: 'Erro ao buscar vendas.' })
  }
})

// ── GET /api/vendas/hoje ────────────────────────────────────────────────────

vendasRouter.get('/hoje', async (req: Request, res: Response) => {
  try {
    const hoje   = new Date().toISOString().split('T')[0]
    const ontem  = new Date(Date.now() - 86_400_000).toISOString().split('T')[0]

    const [vendasHoje, statsHoje, statsOntem] = await Promise.all([

      query<{
        id: string; transaction_id: string; cliente_id: string
        cliente_nome: string; cliente_email: string; cliente_telefone: string | null
        produto_nome: string; produto_tipo: string; is_order_bump: boolean
        valor: number | null; data_compra: string
      }>(`
        SELECT
          co.id,
          co.hotmart_transaction_id          AS transaction_id,
          c.id                               AS cliente_id,
          c.nome                             AS cliente_nome,
          c.email                            AS cliente_email,
          c.telefone_formatado               AS cliente_telefone,
          p.nome                             AS produto_nome,
          p.tipo                             AS produto_tipo,
          COALESCE(co.is_order_bump, false)  AS is_order_bump,
          co.valor::float                    AS valor,
          co.data_compra
        ${FROM_JOIN}
        WHERE co.status = 'COMPLETE'
          AND co.data_compra::date = $1::date
        ORDER BY co.data_compra DESC
      `, [hoje]),

      queryOne<{ total: string; receita: string; ticket: string }>(`
        SELECT
          COUNT(*)::text                             AS total,
          COALESCE(SUM(co.valor::numeric), 0)::text AS receita,
          CASE WHEN COUNT(*) > 0
               THEN (SUM(co.valor::numeric) / COUNT(*))::text
               ELSE '0' END                        AS ticket
        ${FROM_JOIN}
        WHERE co.status = 'COMPLETE'
          AND co.data_compra::date = $1::date
      `, [hoje]),

      queryOne<{ total: string; receita: string }>(`
        SELECT
          COUNT(*)::text                             AS total,
          COALESCE(SUM(co.valor::numeric), 0)::text AS receita
        ${FROM_JOIN}
        WHERE co.status = 'COMPLETE'
          AND co.data_compra::date = $1::date
      `, [ontem]),

      // Top produtos hoje
    ])

    const topProdutos = await query<{ nome: string; quantidade: string; receita: string }>(`
      SELECT
        p.nome,
        COUNT(*)::text                             AS quantidade,
        COALESCE(SUM(co.valor::numeric), 0)::text AS receita
      ${FROM_JOIN}
      WHERE co.status = 'COMPLETE'
        AND co.data_compra::date = $1::date
      GROUP BY p.nome
      ORDER BY COUNT(*) DESC
      LIMIT 5
    `, [hoje])

    const totalHoje   = Number(statsHoje?.total   ?? 0)
    const receitaHoje = Number(statsHoje?.receita  ?? 0)
    const ticketHoje  = Number(statsHoje?.ticket   ?? 0)
    const totalOntem  = Number(statsOntem?.total   ?? 0)
    const receitaOntem = Number(statsOntem?.receita ?? 0)

    const varVendas  = totalOntem  === 0 ? null : Math.round(((totalHoje  - totalOntem)  / totalOntem)  * 100)
    const varReceita = receitaOntem === 0 ? null : Math.round(((receitaHoje - receitaOntem) / receitaOntem) * 100)

    res.json({
      vendas:        vendasHoje,
      total_hoje:    totalHoje,
      receita_hoje:  receitaHoje,
      ticket_hoje:   ticketHoje,
      top_produtos:  topProdutos.map(t => ({
        nome:        t.nome,
        quantidade:  Number(t.quantidade),
        receita:     Number(t.receita),
      })),
      comparacao_ontem: {
        total_ontem:            totalOntem,
        receita_ontem:          receitaOntem,
        variacao_vendas_pct:    varVendas,
        variacao_receita_pct:   varReceita,
      },
    })
  } catch (err) {
    console.error('[Vendas] GET /hoje', err)
    res.status(500).json({ error: 'Erro ao buscar vendas de hoje.' })
  }
})

// ── GET /api/vendas/resumo-diario ───────────────────────────────────────────

vendasRouter.get('/resumo-diario', async (req: Request, res: Response) => {
  try {
    const hoje   = new Date()
    const iniMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1).toISOString().split('T')[0]
    const inicio = (req.query.inicio as string) || iniMes
    const fim    = (req.query.fim    as string) || hoje.toISOString().split('T')[0]

    const rows = await query<{
      data: string; produto_nome: string; quantidade: string; receita: string
    }>(`
      SELECT
        co.data_compra::date::text              AS data,
        p.nome                                  AS produto_nome,
        COUNT(*)::text                          AS quantidade,
        COALESCE(SUM(co.valor::numeric), 0)::text AS receita
      ${FROM_JOIN}
      WHERE co.status = 'COMPLETE'
        AND co.data_compra >= $1::date
        AND co.data_compra <  ($2::date + INTERVAL '1 day')
      GROUP BY co.data_compra::date, p.nome
      ORDER BY co.data_compra::date, p.nome
    `, [inicio, fim])

    // Agrupar por data
    const byData = new Map<string, { quantidade: number; receita: number; produtos: { nome: string; quantidade: number; receita: number }[] }>()

    for (const row of rows) {
      if (!byData.has(row.data)) {
        byData.set(row.data, { quantidade: 0, receita: 0, produtos: [] })
      }
      const day = byData.get(row.data)!
      const qty = Number(row.quantidade)
      const rec = Number(row.receita)
      day.quantidade += qty
      day.receita    += rec
      day.produtos.push({ nome: row.produto_nome, quantidade: qty, receita: rec })
    }

    const resultado = [...byData.entries()].map(([data, v]) => ({
      data,
      quantidade: v.quantidade,
      receita:    v.receita,
      produtos:   v.produtos,
    }))

    res.json(resultado)
  } catch (err) {
    console.error('[Vendas] GET /resumo-diario', err)
    res.status(500).json({ error: 'Erro ao buscar resumo diário.' })
  }
})
