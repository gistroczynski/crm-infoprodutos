import { Router, Request, Response } from 'express'
import { query, queryOne } from '../db'

export const vendasRouter = Router()

// ── Constantes de status e deduplicação ───────────────────────────────────
const STATUS_OK = `co.status IN ('COMPLETE', 'COMPLETED')`
const TX_KEY    = `COALESCE(co.hotmart_transaction_id, co.id::text)`

// ── Helpers de timezone ────────────────────────────────────────────────────
const TZ        = `'America/Sao_Paulo'`
const HOJE_BRT  = `(NOW() AT TIME ZONE ${TZ})::date`
const ONTEM_BRT = `(NOW() AT TIME ZONE ${TZ})::date - 1`
const DATA_BRT  = (col: string) => `(${col} AT TIME ZONE ${TZ})::date`

// ── Helper: monta condições WHERE reutilizáveis ────────────────────────────
function buildWhere(
  inicio: string,
  fim: string,
  produto_id?: string,
  busca?: string,
  startAt = 1,
) {
  const conds: string[] = [
    STATUS_OK,
    `(co.data_compra AT TIME ZONE 'America/Sao_Paulo')::date >= $${startAt}::date`,
    `(co.data_compra AT TIME ZONE 'America/Sao_Paulo')::date <= $${startAt + 1}::date`,
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

    const agora   = new Date()
    const hojeStr = agora.toLocaleDateString('pt-BR', {
      timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
    }).split('/').reverse().join('-')
    const [y, m] = hojeStr.split('-')
    const iniMes  = `${y}-${m}-01`
    const inicio  = (req.query.inicio as string) || iniMes
    const fim     = (req.query.fim    as string) || hojeStr
    const produtoId = req.query.produto_id as string | undefined
    const busca     = req.query.busca      as string | undefined

    // Base params (for count/resumo): $1=inicio, $2=fim, $3+=extras
    const { where: baseWhere, params: baseParams } = buildWhere(inicio, fim, produtoId, busca, 1)

    // List params: $1=limit, $2=offset, $3=inicio, $4=fim, $5+=extras
    const { where: listWhere, params: listBaseParams } = buildWhere(inicio, fim, produtoId, busca, 3)
    const listParams: unknown[] = [limit, offset, ...listBaseParams]

    const tipo = (req.query.tipo as string) || 'personalizado'

    // Comparison period SQL expressions (using $1=inicio, $2=fim from baseParams)
    let antInicioSql: string
    let antFimSql:   string
    if (tipo === 'mes') {
      antInicioSql = `$1::date - INTERVAL '1 month'`
      antFimSql    = `$2::date - INTERVAL '1 month'`
    } else if (tipo === 'ano') {
      antInicioSql = `$1::date - INTERVAL '1 year'`
      antFimSql    = `$2::date - INTERVAL '1 year'`
    } else {
      // hoje, semana, personalizado: same duration shifted back
      antFimSql    = `$1::date - 1`
      antInicioSql = `$1::date - ($2::date - $1::date) - 1`
    }

    const [vendas, stats, porDia, comparacaoRow] = await Promise.all([

      // List with dedup: DISTINCT ON inside, then re-sort by date outside
      query<{
        id: string; transaction_id: string; cliente_id: string
        cliente_nome: string; cliente_email: string; cliente_telefone: string | null
        produto_nome: string; produto_tipo: string; is_order_bump: boolean
        valor: number | null; data_compra: string; dias_atras: number
      }>(`
        SELECT * FROM (
          SELECT DISTINCT ON (${TX_KEY})
            co.id,
            co.hotmart_transaction_id          AS transaction_id,
            c.id                               AS cliente_id,
            c.nome                             AS cliente_nome,
            c.email                            AS cliente_email,
            c.telefone_formatado               AS cliente_telefone,
            p.nome                             AS produto_nome,
            p.tipo                             AS produto_tipo,
            COALESCE(co.is_order_bump, false)           AS is_order_bump,
            COALESCE(co.valor_liquido, co.valor)::float AS valor,
            co.data_compra,
            (${HOJE_BRT} - (co.data_compra AT TIME ZONE 'America/Sao_Paulo')::date)::int AS dias_atras
          ${FROM_JOIN}
          ${listWhere}
          ORDER BY ${TX_KEY}, co.data_compra DESC
        ) t
        ORDER BY t.data_compra DESC
        LIMIT $1 OFFSET $2
      `, listParams),

      // Stats with dedup subquery
      queryOne<{ total: string; receita: string; ticket: string }>(`
        SELECT
          COUNT(*)::text                                                                   AS total,
          COALESCE(SUM(COALESCE(v.valor_liquido, v.valor)::numeric), 0)::text             AS receita,
          CASE WHEN COUNT(*) > 0
               THEN (SUM(COALESCE(v.valor_liquido, v.valor)::numeric) / COUNT(*))::text
               ELSE '0' END                                                                AS ticket
        FROM (
          SELECT DISTINCT ON (${TX_KEY})
            co.valor, co.valor_liquido
          ${FROM_JOIN}
          ${baseWhere}
          ORDER BY ${TX_KEY}, co.data_compra DESC
        ) v
      `, baseParams),

      // Por dia with dedup subquery
      query<{ data: string; quantidade: string; receita: string }>(`
        SELECT
          v.data_brt::text                                                                  AS data,
          COUNT(*)::text                                                                    AS quantidade,
          COALESCE(SUM(COALESCE(v.valor_liquido, v.valor)::numeric), 0)::text              AS receita
        FROM (
          SELECT DISTINCT ON (${TX_KEY})
            co.valor, co.valor_liquido,
            (co.data_compra AT TIME ZONE 'America/Sao_Paulo')::date AS data_brt
          ${FROM_JOIN}
          ${baseWhere}
          ORDER BY ${TX_KEY}, co.data_compra DESC
        ) v
        GROUP BY v.data_brt
        ORDER BY v.data_brt
      `, baseParams),

      // Comparison period with dedup subquery
      queryOne<{ total: string; receita: string }>(`
        SELECT
          COUNT(*)::text                                                                   AS total,
          COALESCE(SUM(COALESCE(v.valor_liquido, v.valor)::numeric), 0)::text             AS receita
        FROM (
          SELECT DISTINCT ON (${TX_KEY})
            co.valor, co.valor_liquido
          ${FROM_JOIN}
          WHERE ${STATUS_OK}
            AND (co.data_compra AT TIME ZONE 'America/Sao_Paulo')::date >= ${antInicioSql}
            AND (co.data_compra AT TIME ZONE 'America/Sao_Paulo')::date <= ${antFimSql}
          ORDER BY ${TX_KEY}, co.data_compra DESC
        ) v
      `, baseParams),
    ])

    const total       = Number(stats?.total   ?? 0)
    const total_pages = Math.ceil(total / limit) || 1

    const receitaAtual = Number(stats?.receita ?? 0)
    const totalAnt     = Number(comparacaoRow?.total   ?? 0)
    const receitaAnt   = Number(comparacaoRow?.receita ?? 0)
    const varVendas    = totalAnt    === 0 ? null : Math.round(((total        - totalAnt)   / totalAnt)    * 100)
    const varReceita   = receitaAnt  === 0 ? null : Math.round(((receitaAtual - receitaAnt) / receitaAnt)  * 100)

    res.json({
      vendas,
      total,
      page,
      limit,
      total_pages,
      resumo: {
        total_vendas:  total,
        receita_total: receitaAtual,
        ticket_medio:  Number(stats?.ticket  ?? 0),
        por_dia: porDia.map(d => ({
          data:       d.data,
          quantidade: Number(d.quantidade),
          receita:    Number(d.receita),
        })),
        comparacao: tipo === 'personalizado' ? null : {
          total_vendas_anterior: totalAnt,
          receita_anterior:      receitaAnt,
          variacao_vendas:       varVendas,
          variacao_receita:      varReceita,
        },
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
    const [vendasHoje, statsHoje, statsOntem, topProdutos] = await Promise.all([

      // List with dedup
      query<{
        id: string; transaction_id: string; cliente_id: string
        cliente_nome: string; cliente_email: string; cliente_telefone: string | null
        produto_nome: string; produto_tipo: string; is_order_bump: boolean
        valor: number | null; data_compra: string
      }>(`
        SELECT * FROM (
          SELECT DISTINCT ON (${TX_KEY})
            co.id,
            co.hotmart_transaction_id          AS transaction_id,
            c.id                               AS cliente_id,
            c.nome                             AS cliente_nome,
            c.email                            AS cliente_email,
            c.telefone_formatado               AS cliente_telefone,
            p.nome                             AS produto_nome,
            p.tipo                             AS produto_tipo,
            COALESCE(co.is_order_bump, false)           AS is_order_bump,
            COALESCE(co.valor_liquido, co.valor)::float AS valor,
            co.data_compra
          ${FROM_JOIN}
          WHERE ${STATUS_OK}
            AND ${DATA_BRT('co.data_compra')} = ${HOJE_BRT}
          ORDER BY ${TX_KEY}, co.data_compra DESC
        ) t
        ORDER BY t.data_compra DESC
      `),

      // Stats hoje with dedup
      queryOne<{ total: string; receita: string; ticket: string }>(`
        SELECT
          COUNT(*)::text                                                                   AS total,
          COALESCE(SUM(COALESCE(v.valor_liquido, v.valor)::numeric), 0)::text             AS receita,
          CASE WHEN COUNT(*) > 0
               THEN (SUM(COALESCE(v.valor_liquido, v.valor)::numeric) / COUNT(*))::text
               ELSE '0' END                                                                AS ticket
        FROM (
          SELECT DISTINCT ON (${TX_KEY})
            co.valor, co.valor_liquido
          ${FROM_JOIN}
          WHERE ${STATUS_OK}
            AND ${DATA_BRT('co.data_compra')} = ${HOJE_BRT}
          ORDER BY ${TX_KEY}, co.data_compra DESC
        ) v
      `),

      // Stats ontem with dedup
      queryOne<{ total: string; receita: string }>(`
        SELECT
          COUNT(*)::text                                                                   AS total,
          COALESCE(SUM(COALESCE(v.valor_liquido, v.valor)::numeric), 0)::text             AS receita
        FROM (
          SELECT DISTINCT ON (${TX_KEY})
            co.valor, co.valor_liquido
          ${FROM_JOIN}
          WHERE ${STATUS_OK}
            AND ${DATA_BRT('co.data_compra')} = ${ONTEM_BRT}
          ORDER BY ${TX_KEY}, co.data_compra DESC
        ) v
      `),

      // Top produtos hoje with dedup
      query<{ nome: string; quantidade: string; receita: string }>(`
        SELECT
          v.produto_nome                                                                    AS nome,
          COUNT(*)::text                                                                    AS quantidade,
          COALESCE(SUM(COALESCE(v.valor_liquido, v.valor)::numeric), 0)::text              AS receita
        FROM (
          SELECT DISTINCT ON (${TX_KEY})
            co.valor, co.valor_liquido, p.nome AS produto_nome
          ${FROM_JOIN}
          WHERE ${STATUS_OK}
            AND ${DATA_BRT('co.data_compra')} = ${HOJE_BRT}
          ORDER BY ${TX_KEY}, co.data_compra DESC
        ) v
        GROUP BY v.produto_nome
        ORDER BY COUNT(*) DESC
        LIMIT 5
      `),
    ])

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
    const agora   = new Date()
    const hojeStr = agora.toLocaleDateString('pt-BR', {
      timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
    }).split('/').reverse().join('-')
    const [ry, rm] = hojeStr.split('-')
    const iniMes  = `${ry}-${rm}-01`
    const inicio  = (req.query.inicio as string) || iniMes
    const fim     = (req.query.fim    as string) || hojeStr

    const rows = await query<{
      data: string; produto_nome: string; quantidade: string; receita: string
    }>(`
      SELECT
        v.data_brt::text                                                                    AS data,
        v.produto_nome,
        COUNT(*)::text                                                                      AS quantidade,
        COALESCE(SUM(COALESCE(v.valor_liquido, v.valor)::numeric), 0)::text                AS receita
      FROM (
        SELECT DISTINCT ON (${TX_KEY})
          co.valor, co.valor_liquido,
          (co.data_compra AT TIME ZONE 'America/Sao_Paulo')::date AS data_brt,
          p.nome AS produto_nome
        ${FROM_JOIN}
        WHERE ${STATUS_OK}
          AND (co.data_compra AT TIME ZONE 'America/Sao_Paulo')::date >= $1::date
          AND (co.data_compra AT TIME ZONE 'America/Sao_Paulo')::date <= $2::date
        ORDER BY ${TX_KEY}, co.data_compra DESC
      ) v
      GROUP BY v.data_brt, v.produto_nome
      ORDER BY v.data_brt, v.produto_nome
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
