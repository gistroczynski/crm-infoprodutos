import { Router, Request, Response } from 'express'
import { query, queryOne } from '../db'

export const dashboardRouter = Router()

// ── Helpers ────────────────────────────────────────────────────────────────

/** Extrai inicio/fim do query string. Padrão: mês atual. */
function parseDateRange(req: Request): { inicio: string; fim: string } {
  const i = req.query.inicio as string | undefined
  const f = req.query.fim    as string | undefined
  if (i && f) return { inicio: i, fim: f }
  const now = new Date()
  const y  = now.getFullYear()
  const m  = String(now.getMonth() + 1).padStart(2, '0')
  const ld = new Date(y, now.getMonth() + 1, 0).getDate()
  return { inicio: `${y}-${m}-01`, fim: `${y}-${m}-${String(ld).padStart(2, '0')}` }
}

/**
 * Retorna a lista de status SQL para queries de faturamento.
 * Inclui APPROVED quando fim está nos últimos 7 dias: vendas recentes
 * chegam pelo webhook como APPROVED e só viram COMPLETE após alguns dias.
 */
function statusFaturamento(fim: string): string {
  const hoje = new Date()
  const fimDate = new Date(fim + 'T23:59:59Z')
  const diasDesdeFim = (hoje.getTime() - fimDate.getTime()) / 86_400_000
  return diasDesdeFim <= 7
    ? `'COMPLETE', 'COMPLETED', 'Completo', 'APPROVED'`
    : `'COMPLETE', 'COMPLETED', 'Completo'`
}

/** Lê configuração de IDs de produtos do funil salva em configuracoes. */
async function readFunilConfig() {
  const rows = await query<{ chave: string; valor: string | null }>(
    `SELECT chave, valor FROM configuracoes
     WHERE chave IN ('produto_principal_id', 'produtos_entrada_ids', 'produtos_upsell_ids')`
  )
  const m = Object.fromEntries(rows.map(r => [r.chave, r.valor ?? '']))
  let entradaIds: string[] = []
  let upsellIds:  string[] = []
  const principalId = m['produto_principal_id'] || null
  try { entradaIds = JSON.parse(m['produtos_entrada_ids'] || '[]') } catch {}
  try { upsellIds  = JSON.parse(m['produtos_upsell_ids']  || '[]') } catch {}
  return { entradaIds, upsellIds, principalId }
}

/**
 * Conta clientes DISTINCT e soma receita de compras no período.
 * Usa DISTINCT ON (hotmart_transaction_id) para evitar duplicatas.
 * Se ids.length > 0 filtra por produto_id IN ids; senão usa coluna tipo.
 */
async function buscarEtapaFunil(
  ids: string[],
  tipoFallback: string,
  inicio: string,
  fim: string,
): Promise<{ total_clientes: number; receita: number }> {
  if (ids.length > 0) {
    const row = await queryOne<{ total_clientes: number; receita: number }>(`
      SELECT
        COUNT(DISTINCT t.cliente_id)::int         AS total_clientes,
        COALESCE(SUM(t.valor), 0)::float           AS receita
      FROM (
        SELECT DISTINCT ON (COALESCE(co.hotmart_transaction_id, co.id::text))
          co.cliente_id,
          COALESCE(co.valor_liquido, co.valor)::numeric AS valor
        FROM compras co
        WHERE co.status IN (${statusFaturamento(fim)})
          AND (co.moeda = 'BRL' OR co.moeda IS NULL)
          AND co.produto_id = ANY($1::uuid[])
          AND (co.data_compra AT TIME ZONE 'America/Sao_Paulo')::date >= $2::date
          AND (co.data_compra AT TIME ZONE 'America/Sao_Paulo')::date <= $3::date
        ORDER BY COALESCE(co.hotmart_transaction_id, co.id::text), co.id
      ) t
    `, [ids, inicio, fim])
    return row ?? { total_clientes: 0, receita: 0 }
  }
  const row = await queryOne<{ total_clientes: number; receita: number }>(`
    SELECT
      COUNT(DISTINCT t.cliente_id)::int         AS total_clientes,
      COALESCE(SUM(t.valor), 0)::float           AS receita
    FROM (
      SELECT DISTINCT ON (COALESCE(co.hotmart_transaction_id, co.id::text))
        co.cliente_id,
        COALESCE(co.valor_liquido, co.valor)::numeric AS valor
      FROM compras co
      JOIN produtos p ON p.id = co.produto_id
      WHERE co.status IN (${statusFaturamento(fim)})
        AND (co.moeda = 'BRL' OR co.moeda IS NULL)
        AND COALESCE(p.tipo, 'entrada') = $1
        AND (co.data_compra AT TIME ZONE 'America/Sao_Paulo')::date >= $2::date
        AND (co.data_compra AT TIME ZONE 'America/Sao_Paulo')::date <= $3::date
      ORDER BY COALESCE(co.hotmart_transaction_id, co.id::text), co.id
    ) t
  `, [tipoFallback, inicio, fim])
  return row ?? { total_clientes: 0, receita: 0 }
}

// ── GET /api/dashboard (legacy) ────────────────────────────────────────────
dashboardRouter.get('/', async (_req: Request, res: Response) => {
  try {
    const hoje = new Date().toISOString().slice(0, 10)
    const [totais, distribuicao, contatosHoje] = await Promise.all([
      queryOne<{ total_clientes: number; clientes_alta: number; clientes_media: number; clientes_baixa: number }>(`
        SELECT
          COUNT(DISTINCT c.id)::int AS total_clientes,
          COUNT(DISTINCT CASE WHEN ls.prioridade = 'alta'  THEN c.id END)::int AS clientes_alta,
          COUNT(DISTINCT CASE WHEN ls.prioridade = 'media' THEN c.id END)::int AS clientes_media,
          COUNT(DISTINCT CASE WHEN ls.prioridade = 'baixa' OR ls.prioridade IS NULL THEN c.id END)::int AS clientes_baixa
        FROM clientes c LEFT JOIN lead_scores ls ON ls.cliente_id = c.id
      `),
      query<{ status: string; total: number }>(`
        SELECT COALESCE(sc.status,'novo') AS status, COUNT(*)::int AS total
        FROM clientes c LEFT JOIN status_clientes sc ON sc.cliente_id = c.id
        GROUP BY sc.status
      `),
      queryOne<{ contatados: number; pendentes: number }>(`
        SELECT
          COUNT(CASE WHEN status_contato != 'pendente' THEN 1 END)::int AS contatados,
          COUNT(CASE WHEN status_contato  = 'pendente' THEN 1 END)::int AS pendentes
        FROM lista_diaria WHERE data = $1
      `, [hoje]),
    ])
    res.json({ totais, distribuicao_status: distribuicao, contatos_hoje: contatosHoje })
  } catch (err) { res.status(500).json({ error: String(err) }) }
})

// ── GET /api/dashboard/resumo?inicio=YYYY-MM-DD&fim=YYYY-MM-DD ─────────────
dashboardRouter.get('/resumo', async (req: Request, res: Response) => {
  try {
    const { inicio, fim } = parseDateRange(req)

    const [periodo, faturamentoUsd, porProduto, clientes] = await Promise.all([

      // Faturamento BRL líquido — deduplicado por transaction_id
      queryOne<{ faturamento: number; total_compras: number; ticket_medio: number }>(`
        SELECT
          COALESCE(SUM(v.valor), 0)::float  AS faturamento,
          COUNT(*)::int                     AS total_compras,
          COALESCE(AVG(v.valor), 0)::float  AS ticket_medio
        FROM (
          SELECT DISTINCT ON (COALESCE(hotmart_transaction_id, id::text))
            COALESCE(valor_liquido, valor)::numeric AS valor
          FROM compras
          WHERE status IN (${statusFaturamento(fim)})
            AND (moeda = 'BRL' OR moeda IS NULL)
            AND COALESCE(valor_liquido, valor) IS NOT NULL
            AND (data_compra AT TIME ZONE 'America/Sao_Paulo')::date >= $1::date
            AND (data_compra AT TIME ZONE 'America/Sao_Paulo')::date <= $2::date
          ORDER BY COALESCE(hotmart_transaction_id, id::text), id
        ) v
      `, [inicio, fim]),

      // Faturamento USD líquido — separado, sem converter
      queryOne<{ faturamento: number; total_compras: number }>(`
        SELECT
          COALESCE(SUM(v.valor), 0)::float AS faturamento,
          COUNT(*)::int                    AS total_compras
        FROM (
          SELECT DISTINCT ON (COALESCE(hotmart_transaction_id, id::text))
            COALESCE(valor_liquido, valor)::numeric AS valor
          FROM compras
          WHERE status IN (${statusFaturamento(fim)})
            AND moeda = 'USD'
            AND COALESCE(valor_liquido, valor) IS NOT NULL
            AND (data_compra AT TIME ZONE 'America/Sao_Paulo')::date >= $1::date
            AND (data_compra AT TIME ZONE 'America/Sao_Paulo')::date <= $2::date
          ORDER BY COALESCE(hotmart_transaction_id, id::text), id
        ) v
      `, [inicio, fim]),

      // Top produtos no período — usa valor líquido
      query<{ produto_id: string; nome: string; tipo: string; total_vendas: number; receita: number }>(`
        SELECT
          p.id                                                             AS produto_id,
          p.nome,
          COALESCE(p.tipo, 'entrada')                                      AS tipo,
          COUNT(co.id)::int                                                AS total_vendas,
          COALESCE(SUM(COALESCE(co.valor_liquido, co.valor)::numeric), 0)::float AS receita
        FROM produtos p
        JOIN compras co ON co.produto_id = p.id
          AND co.status IN (${statusFaturamento(fim)})
          AND COALESCE(co.valor_liquido, co.valor) IS NOT NULL
          AND (co.moeda = 'BRL' OR co.moeda IS NULL)
          AND co.data_compra::date >= $1::date
          AND co.data_compra::date <= $2::date
        GROUP BY p.id, p.nome, p.tipo
        ORDER BY receita DESC
        LIMIT 20
      `, [inicio, fim]),

      // Clientes totais e com produto principal (sempre all-time — KPI acumulado)
      queryOne<{ total_clientes: number; clientes_com_principal: number }>(`
        SELECT
          COUNT(DISTINCT c.id)::int AS total_clientes,
          COUNT(DISTINCT CASE
            WHEN EXISTS (
              SELECT 1 FROM compras co2
              JOIN produtos p2 ON p2.id = co2.produto_id
              WHERE co2.cliente_id = c.id AND p2.tipo = 'principal' AND co2.status IN ('COMPLETE', 'APPROVED')
            ) THEN c.id END)::int AS clientes_com_principal
        FROM clientes c
      `),
    ])

    const totalC      = clientes?.total_clientes      ?? 0
    const comPrincipal = clientes?.clientes_com_principal ?? 0
    const taxaAscensao = totalC > 0 ? Math.round((comPrincipal / totalC) * 100) : 0

    res.json({
      faturamento_total:      periodo?.faturamento   ?? 0, // BRL líquido
      faturamento_mes_atual:  periodo?.faturamento   ?? 0,
      faturamento_brl:        periodo?.faturamento   ?? 0,
      faturamento_usd:        faturamentoUsd?.faturamento ?? 0,
      ticket_medio:           periodo?.ticket_medio  ?? 0,
      total_clientes:         totalC,
      clientes_com_principal: comPrincipal,
      taxa_ascensao:          taxaAscensao,
      total_compras:          periodo?.total_compras ?? 0,
      receita_por_produto:    porProduto,
      periodo:                { inicio, fim },
    })
  } catch (err) { res.status(500).json({ error: String(err) }) }
})

// ── GET /api/dashboard/funil?inicio=&fim= ──────────────────────────────────
dashboardRouter.get('/funil', async (req: Request, res: Response) => {
  try {
    const { inicio, fim } = parseDateRange(req)
    const { entradaIds, principalId } = await readFunilConfig()

    const principalIds = principalId ? [principalId] : []

    // Etapa order_bump: compras marcadas como is_order_bump=true no período
    const orderBumpPromise = queryOne<{ total_clientes: number; receita: number }>(`
      SELECT
        COUNT(DISTINCT co.cliente_id)::int         AS total_clientes,
        COALESCE(SUM(co.valor::numeric), 0)::float AS receita
      FROM compras co
      WHERE co.status IN (${statusFaturamento(fim)})
        AND co.is_order_bump = true
        AND co.data_compra::date >= $1::date
        AND co.data_compra::date <= $2::date
    `, [inicio, fim])

    const [entrada, order_bump_row, upsell] = await Promise.all([
      buscarEtapaFunil(entradaIds,  'entrada',   inicio, fim),
      orderBumpPromise,
      buscarEtapaFunil(principalIds,'principal', inicio, fim),
    ])

    const order_bump = order_bump_row ?? { total_clientes: 0, receita: 0 }

    const base = entrada.total_clientes
    const taxaOB     = base > 0 ? Math.round((order_bump.total_clientes / base) * 100) : 0
    const taxaUpsell = base > 0 ? Math.round((upsell.total_clientes     / base) * 100) : 0

    res.json({
      entrada,
      order_bump: { ...order_bump, taxa_conversao_de_entrada: taxaOB     },
      upsell:     { ...upsell,     taxa_conversao_de_entrada: taxaUpsell },
    })
  } catch (err) { res.status(500).json({ error: String(err) }) }
})

// ── GET /api/dashboard/evolucao?inicio=&fim= (ou ?periodo=N) ───────────────
dashboardRouter.get('/evolucao', async (req: Request, res: Response) => {
  try {
    let inicio: string, fim: string

    if (req.query.inicio && req.query.fim) {
      inicio = req.query.inicio as string
      fim    = req.query.fim    as string
    } else {
      // Compat com ?periodo=N (dias para trás a partir de hoje)
      const periodo = Math.min(Number(req.query.periodo ?? 30), 365)
      const now = new Date()
      fim    = now.toISOString().slice(0, 10)
      const ini = new Date(now); ini.setDate(ini.getDate() - periodo)
      inicio = ini.toISOString().slice(0, 10)
    }

    const rows = await query<{ data: string; receita: number; novas_compras: number }>(`
      WITH serie AS (
        SELECT generate_series($1::date, $2::date, '1 day'::interval)::date AS data
      ),
      compras_unicas AS (
        SELECT DISTINCT ON (COALESCE(hotmart_transaction_id, id::text))
          (data_compra AT TIME ZONE 'America/Sao_Paulo')::date AS data_compra,
          COALESCE(valor_liquido, valor)::numeric AS valor
        FROM compras
        WHERE status IN (${statusFaturamento(fim)})
          AND (moeda = 'BRL' OR moeda IS NULL)
          AND COALESCE(valor_liquido, valor) IS NOT NULL
        ORDER BY COALESCE(hotmart_transaction_id, id::text), id
      )
      SELECT
        s.data::text,
        COALESCE(SUM(cu.valor), 0)::float AS receita,
        COUNT(cu.valor)::int              AS novas_compras
      FROM serie s
      LEFT JOIN compras_unicas cu ON cu.data_compra = s.data
      GROUP BY s.data
      ORDER BY s.data ASC
    `, [inicio, fim])

    res.json(rows)
  } catch (err) { res.status(500).json({ error: String(err) }) }
})

// ── GET /api/dashboard/diagnostico-faturamento ────────────────────────────
dashboardRouter.get('/diagnostico-faturamento', async (req: Request, res: Response) => {
  try {
    const { inicio, fim } = parseDateRange(req)

    const [bruto, deduplicado, duplicatas] = await Promise.all([
      queryOne<{ total: number; receita: number }>(`
        SELECT COUNT(*)::int AS total, COALESCE(SUM(valor::numeric),0)::float AS receita
        FROM compras
        WHERE status IN (${statusFaturamento(fim)}) AND valor IS NOT NULL
          AND (data_compra AT TIME ZONE 'America/Sao_Paulo')::date >= $1::date
          AND (data_compra AT TIME ZONE 'America/Sao_Paulo')::date <= $2::date
      `, [inicio, fim]),

      queryOne<{ total: number; receita: number }>(`
        SELECT COUNT(*)::int AS total, COALESCE(SUM(v.valor),0)::float AS receita
        FROM (
          SELECT DISTINCT ON (COALESCE(hotmart_transaction_id, id::text))
            valor::numeric AS valor
          FROM compras
          WHERE status IN (${statusFaturamento(fim)}) AND valor IS NOT NULL
            AND (data_compra AT TIME ZONE 'America/Sao_Paulo')::date >= $1::date
            AND (data_compra AT TIME ZONE 'America/Sao_Paulo')::date <= $2::date
          ORDER BY COALESCE(hotmart_transaction_id, id::text), id
        ) v
      `, [inicio, fim]),

      query<{ transaction_id: string; ocorrencias: number; valor_total: number }>(`
        SELECT
          hotmart_transaction_id AS transaction_id,
          COUNT(*)::int          AS ocorrencias,
          SUM(valor::numeric)::float AS valor_total
        FROM compras
        WHERE status IN (${statusFaturamento(fim)}) AND valor IS NOT NULL
          AND hotmart_transaction_id IS NOT NULL
          AND (data_compra AT TIME ZONE 'America/Sao_Paulo')::date >= $1::date
          AND (data_compra AT TIME ZONE 'America/Sao_Paulo')::date <= $2::date
        GROUP BY hotmart_transaction_id
        HAVING COUNT(*) > 1
        ORDER BY ocorrencias DESC
        LIMIT 20
      `, [inicio, fim]),
    ])

    res.json({
      periodo: { inicio, fim },
      bruto:        { total_compras: bruto?.total ?? 0,        receita: bruto?.receita ?? 0 },
      deduplicado:  { total_compras: deduplicado?.total ?? 0,  receita: deduplicado?.receita ?? 0 },
      diferenca_receita: (bruto?.receita ?? 0) - (deduplicado?.receita ?? 0),
      transacoes_duplicadas: duplicatas.length,
      exemplos_duplicatas: duplicatas.slice(0, 10),
    })
  } catch (err) { res.status(500).json({ error: String(err) }) }
})
