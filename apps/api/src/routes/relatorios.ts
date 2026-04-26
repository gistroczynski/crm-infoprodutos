import { Router, Request, Response } from 'express'
import { query, queryOne } from '../db'

export const relatoriosRouter = Router()

// ── Helpers ────────────────────────────────────────────────────────────────

function parseDateRange(req: Request): { inicio: string; fim: string } {
  const i = req.query.inicio as string | undefined
  const f = req.query.fim    as string | undefined
  if (i && f) return { inicio: i, fim: f }
  const now = new Date()
  const y   = now.getFullYear()
  const m   = String(now.getMonth() + 1).padStart(2, '0')
  const ld  = new Date(y, now.getMonth() + 1, 0).getDate()
  return { inicio: `${y}-${m}-01`, fim: `${y}-${m}-${String(ld).padStart(2, '0')}` }
}

async function readFunilConfig() {
  const rows = await query<{ chave: string; valor: string | null }>(
    `SELECT chave, valor FROM configuracoes
     WHERE chave IN ('produto_principal_id', 'produtos_entrada_ids')`
  )
  const m = Object.fromEntries(rows.map(r => [r.chave, r.valor ?? '']))
  let entradaIds: string[] = []
  const principalId = m['produto_principal_id'] || null
  try { entradaIds = JSON.parse(m['produtos_entrada_ids'] || '[]') } catch {}
  return { entradaIds, principalId }
}

// ── GET /api/relatorios/ascensao ─────────────────────────────────────────
relatoriosRouter.get('/ascensao', async (req: Request, res: Response) => {
  try {
    const { inicio, fim } = parseDateRange(req)

    const [totais, tempoMedio, porSemana] = await Promise.all([

      // Clientes no período + novos ascendidos
      queryOne<{ total_clientes_periodo: number; novos_ascendidos: number }>(`
        SELECT
          COUNT(DISTINCT co_all.cliente_id)::int           AS total_clientes_periodo,
          COUNT(DISTINCT co_up.cliente_id)::int            AS novos_ascendidos
        FROM compras co_all
        LEFT JOIN (
          SELECT co2.cliente_id
          FROM compras co2
          JOIN produtos p2 ON p2.id = co2.produto_id AND p2.tipo = 'principal'
          WHERE co2.status IN ('COMPLETE', 'COMPLETED', 'APPROVED')
            AND (co2.data_compra AT TIME ZONE 'America/Sao_Paulo')::date >= $1::date
            AND (co2.data_compra AT TIME ZONE 'America/Sao_Paulo')::date <= $2::date
        ) co_up ON co_up.cliente_id = co_all.cliente_id
        WHERE co_all.status IN ('COMPLETE', 'COMPLETED', 'APPROVED')
          AND (co_all.data_compra AT TIME ZONE 'America/Sao_Paulo')::date >= $1::date
          AND (co_all.data_compra AT TIME ZONE 'America/Sao_Paulo')::date <= $2::date
      `, [inicio, fim]),

      // Tempo médio de ascensão: data primeira entrada → data compra upsell
      queryOne<{ tempo_medio: number | null }>(`
        SELECT ROUND(AVG(dias))::int AS tempo_medio
        FROM (
          SELECT
            co_up.cliente_id,
            (MIN(co_up.data_compra)::date - MIN(co_en.data_compra)::date) AS dias
          FROM compras co_up
          JOIN produtos p_up ON p_up.id = co_up.produto_id AND p_up.tipo = 'principal'
          JOIN compras co_en ON co_en.cliente_id = co_up.cliente_id
          JOIN produtos p_en ON p_en.id = co_en.produto_id AND p_en.tipo = 'entrada'
          WHERE co_up.status IN ('COMPLETE', 'COMPLETED', 'APPROVED')
            AND co_en.status IN ('COMPLETE', 'COMPLETED', 'APPROVED')
            AND (co_up.data_compra AT TIME ZONE 'America/Sao_Paulo')::date >= $1::date
            AND (co_up.data_compra AT TIME ZONE 'America/Sao_Paulo')::date <= $2::date
          GROUP BY co_up.cliente_id
          HAVING MIN(co_up.data_compra) >= MIN(co_en.data_compra)
        ) sub
      `, [inicio, fim]),

      // Ascensões agrupadas por semana
      query<{ semana: string; quantidade: number }>(`
        SELECT
          TO_CHAR(DATE_TRUNC('week', (co.data_compra AT TIME ZONE 'America/Sao_Paulo')::date), 'DD/MM') AS semana,
          COUNT(DISTINCT co.cliente_id)::int                         AS quantidade
        FROM compras co
        JOIN produtos p ON p.id = co.produto_id AND p.tipo = 'principal'
        WHERE co.status IN ('COMPLETE', 'COMPLETED', 'APPROVED')
          AND (co.data_compra AT TIME ZONE 'America/Sao_Paulo')::date >= $1::date
          AND (co.data_compra AT TIME ZONE 'America/Sao_Paulo')::date <= $2::date
        GROUP BY DATE_TRUNC('week', (co.data_compra AT TIME ZONE 'America/Sao_Paulo')::date)
        ORDER BY DATE_TRUNC('week', (co.data_compra AT TIME ZONE 'America/Sao_Paulo')::date)
      `, [inicio, fim]),
    ])

    const totalClientes  = totais?.total_clientes_periodo ?? 0
    const novosAscendidos = totais?.novos_ascendidos ?? 0
    const taxaAscensao   = totalClientes > 0
      ? Math.round((novosAscendidos / totalClientes) * 100)
      : 0

    res.json({
      total_clientes_periodo:     totalClientes,
      novos_ascendidos:           novosAscendidos,
      taxa_ascensao:              taxaAscensao,
      tempo_medio_ascensao_dias:  tempoMedio?.tempo_medio ?? 0,
      ascensoes_por_semana:       porSemana,
    })
  } catch (err) { res.status(500).json({ error: String(err) }) }
})

// ── GET /api/relatorios/funil ────────────────────────────────────────────
relatoriosRouter.get('/funil', async (req: Request, res: Response) => {
  try {
    const { inicio, fim }          = parseDateRange(req)
    const { entradaIds, principalId } = await readFunilConfig()
    const principalIds             = principalId ? [principalId] : []

    // Entrada
    const entradaRow = await (entradaIds.length > 0
      ? queryOne<{ total_clientes: number; receita: number }>(`
          SELECT COUNT(DISTINCT co.cliente_id)::int AS total_clientes,
                 COALESCE(SUM(COALESCE(co.valor_liquido, co.valor)::numeric), 0)::float AS receita
          FROM compras co
          WHERE co.status IN ('COMPLETE', 'APPROVED')
            AND co.produto_id = ANY($1::uuid[])
            AND (co.data_compra AT TIME ZONE 'America/Sao_Paulo')::date >= $2::date
            AND (co.data_compra AT TIME ZONE 'America/Sao_Paulo')::date <= $3::date
        `, [entradaIds, inicio, fim])
      : queryOne<{ total_clientes: number; receita: number }>(`
          SELECT COUNT(DISTINCT co.cliente_id)::int AS total_clientes,
                 COALESCE(SUM(COALESCE(co.valor_liquido, co.valor)::numeric), 0)::float AS receita
          FROM compras co
          JOIN produtos p ON p.id = co.produto_id
          WHERE co.status IN ('COMPLETE', 'APPROVED')
            AND COALESCE(p.tipo, 'entrada') = 'entrada'
            AND (co.data_compra AT TIME ZONE 'America/Sao_Paulo')::date >= $1::date
            AND (co.data_compra AT TIME ZONE 'America/Sao_Paulo')::date <= $2::date
        `, [inicio, fim]))

    // Order Bump
    const obRow = await queryOne<{ total_clientes: number; receita: number }>(`
      SELECT COUNT(DISTINCT co.cliente_id)::int AS total_clientes,
             COALESCE(SUM(COALESCE(co.valor_liquido, co.valor)::numeric), 0)::float AS receita
      FROM compras co
      WHERE co.status IN ('COMPLETE', 'APPROVED')
        AND co.is_order_bump = true
        AND (co.data_compra AT TIME ZONE 'America/Sao_Paulo')::date >= $1::date
        AND (co.data_compra AT TIME ZONE 'America/Sao_Paulo')::date <= $2::date
    `, [inicio, fim])

    // Upsell (produto principal configurado)
    const upsellRow = await (principalIds.length > 0
      ? queryOne<{ total_clientes: number; receita: number }>(`
          SELECT COUNT(DISTINCT co.cliente_id)::int AS total_clientes,
                 COALESCE(SUM(COALESCE(co.valor_liquido, co.valor)::numeric), 0)::float AS receita
          FROM compras co
          WHERE co.status IN ('COMPLETE', 'APPROVED')
            AND co.produto_id = ANY($1::uuid[])
            AND (co.data_compra AT TIME ZONE 'America/Sao_Paulo')::date >= $2::date
            AND (co.data_compra AT TIME ZONE 'America/Sao_Paulo')::date <= $3::date
        `, [principalIds, inicio, fim])
      : queryOne<{ total_clientes: number; receita: number }>(`
          SELECT COUNT(DISTINCT co.cliente_id)::int AS total_clientes,
                 COALESCE(SUM(COALESCE(co.valor_liquido, co.valor)::numeric), 0)::float AS receita
          FROM compras co
          JOIN produtos p ON p.id = co.produto_id
          WHERE co.status IN ('COMPLETE', 'APPROVED')
            AND p.tipo = 'principal'
            AND (co.data_compra AT TIME ZONE 'America/Sao_Paulo')::date >= $1::date
            AND (co.data_compra AT TIME ZONE 'America/Sao_Paulo')::date <= $2::date
        `, [inicio, fim]))

    const entrada = entradaRow ?? { total_clientes: 0, receita: 0 }
    const ob      = obRow      ?? { total_clientes: 0, receita: 0 }
    const upsell  = upsellRow  ?? { total_clientes: 0, receita: 0 }

    const taxaEntradaParaOB  = entrada.total_clientes > 0
      ? Math.round((ob.total_clientes     / entrada.total_clientes) * 100) : 0
    const taxaOBParaUpsell   = ob.total_clientes > 0
      ? Math.round((upsell.total_clientes / ob.total_clientes)      * 100) : 0

    res.json({
      por_etapa: [
        { etapa: 'Entrada',    ...entrada, taxa_para_proxima: taxaEntradaParaOB  },
        { etapa: 'Order Bump', ...ob,      taxa_para_proxima: taxaOBParaUpsell   },
        { etapa: 'Upsell',     ...upsell,  taxa_para_proxima: null               },
      ],
    })
  } catch (err) { res.status(500).json({ error: String(err) }) }
})

// ── GET /api/relatorios/performance-lista ────────────────────────────────
relatoriosRouter.get('/performance-lista', async (req: Request, res: Response) => {
  try {
    const { inicio, fim } = parseDateRange(req)

    const [geral, porPrioridade, porDia] = await Promise.all([

      queryOne<{ total_contatos: number; total_convertidos: number }>(`
        SELECT
          COUNT(*) FILTER (WHERE status_contato != 'pendente')  ::int AS total_contatos,
          COUNT(*) FILTER (WHERE status_contato  = 'convertido')::int AS total_convertidos
        FROM lista_diaria
        WHERE data >= $1::date AND data <= $2::date
      `, [inicio, fim]),

      query<{ prioridade: string; contatos: number; convertidos: number }>(`
        SELECT
          prioridade,
          COUNT(*) FILTER (WHERE status_contato != 'pendente')  ::int AS contatos,
          COUNT(*) FILTER (WHERE status_contato  = 'convertido')::int AS convertidos
        FROM lista_diaria
        WHERE data >= $1::date AND data <= $2::date
        GROUP BY prioridade
        ORDER BY
          CASE prioridade WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END
      `, [inicio, fim]),

      query<{ data: string; contatos: number; convertidos: number }>(`
        WITH serie AS (
          SELECT generate_series($1::date, $2::date, '1 day'::interval)::date AS data
        )
        SELECT
          s.data::text,
          COUNT(ld.id) FILTER (WHERE ld.status_contato != 'pendente')  ::int AS contatos,
          COUNT(ld.id) FILTER (WHERE ld.status_contato  = 'convertido')::int AS convertidos
        FROM serie s
        LEFT JOIN lista_diaria ld ON ld.data = s.data
        GROUP BY s.data
        ORDER BY s.data
      `, [inicio, fim]),
    ])

    const totalContatos   = geral?.total_contatos    ?? 0
    const totalConvertidos = geral?.total_convertidos ?? 0
    const taxaConversao   = totalContatos > 0
      ? Math.round((totalConvertidos / totalContatos) * 100) : 0

    // Normaliza por prioridade como objeto
    const prioMap: Record<string, { contatos: number; convertidos: number; taxa: number }> = {
      alta:  { contatos: 0, convertidos: 0, taxa: 0 },
      media: { contatos: 0, convertidos: 0, taxa: 0 },
      baixa: { contatos: 0, convertidos: 0, taxa: 0 },
    }
    for (const row of porPrioridade) {
      const taxa = row.contatos > 0 ? Math.round((row.convertidos / row.contatos) * 100) : 0
      prioMap[row.prioridade] = { contatos: row.contatos, convertidos: row.convertidos, taxa }
    }

    res.json({
      total_contatos_realizados: totalContatos,
      total_convertidos:          totalConvertidos,
      taxa_conversao:             taxaConversao,
      por_prioridade:             prioMap,
      por_dia:                    porDia,
    })
  } catch (err) { res.status(500).json({ error: String(err) }) }
})

// ── GET /api/relatorios/produtos ─────────────────────────────────────────
relatoriosRouter.get('/produtos', async (req: Request, res: Response) => {
  try {
    const { inicio, fim } = parseDateRange(req)

    const produtos = await query<{
      produto_id: string; nome: string; tipo: string
      total_vendas: number; receita: number; ticket_medio: number; novos_clientes: number
    }>(`
      SELECT
        p.id                                       AS produto_id,
        p.nome,
        COALESCE(p.tipo, 'entrada')                AS tipo,
        COUNT(co.id)::int                          AS total_vendas,
        COALESCE(SUM(COALESCE(co.valor_liquido, co.valor)::numeric), 0)::float AS receita,
        COALESCE(AVG(COALESCE(co.valor_liquido, co.valor)::numeric), 0)::float AS ticket_medio,
        COUNT(DISTINCT co.cliente_id)::int         AS novos_clientes
      FROM produtos p
      JOIN compras co ON co.produto_id = p.id
        AND co.status IN ('COMPLETE', 'APPROVED')
        AND COALESCE(co.valor_liquido, co.valor) IS NOT NULL
        AND (co.data_compra AT TIME ZONE 'America/Sao_Paulo')::date >= $1::date
        AND (co.data_compra AT TIME ZONE 'America/Sao_Paulo')::date <= $2::date
      GROUP BY p.id, p.nome, p.tipo
      ORDER BY receita DESC
    `, [inicio, fim])

    const totalReceita = produtos.reduce((s, p) => s + p.receita, 0)

    res.json({
      produtos: produtos.map(p => ({
        ...p,
        ticket_medio:       Math.round(p.ticket_medio * 100) / 100,
        percentual_receita: totalReceita > 0 ? Math.round((p.receita / totalReceita) * 100) : 0,
      })),
    })
  } catch (err) { res.status(500).json({ error: String(err) }) }
})

// ── GET /api/relatorios/cadencias ─────────────────────────────────────────
relatoriosRouter.get('/cadencias', async (req: Request, res: Response) => {
  try {
    const { inicio, fim } = parseDateRange(req)

    const rows = await query<{
      trilha_nome: string
      total_inscritos: number
      em_andamento: number
      convertidos: number
      desistiram: number
      concluidos: number
      taxa_conversao: number
      tempo_medio_dias: number
    }>(`
      SELECT
        t.nome                                                                AS trilha_nome,
        COUNT(ct.id)::int                                                     AS total_inscritos,
        COUNT(CASE WHEN ct.status = 'ativo'      THEN 1 END)::int            AS em_andamento,
        COUNT(CASE WHEN ct.status = 'convertido' THEN 1 END)::int            AS convertidos,
        COUNT(CASE WHEN ct.status = 'desistiu'   THEN 1 END)::int            AS desistiram,
        COUNT(CASE WHEN ct.status = 'concluido'  THEN 1 END)::int            AS concluidos,
        COALESCE(ROUND(
          COUNT(CASE WHEN ct.status = 'convertido' THEN 1 END)::numeric
          / NULLIF(COUNT(ct.id), 0) * 100
        ), 0)::int                                                            AS taxa_conversao,
        COALESCE(AVG(
          CASE WHEN ct.status = 'convertido'
               THEN ((NOW() AT TIME ZONE 'America/Sao_Paulo')::date - ct.data_entrada::date)
          END
        )::int, 0)                                                            AS tempo_medio_dias
      FROM trilhas_cadencia t
      LEFT JOIN clientes_trilha ct ON ct.trilha_id = t.id
        AND ct.data_entrada::date >= $1::date
        AND ct.data_entrada::date <= $2::date
      WHERE t.ativa = true
      GROUP BY t.id, t.nome
      ORDER BY taxa_conversao DESC, total_inscritos DESC
    `, [inicio, fim])

    res.json({ por_trilha: rows })
  } catch (err) { res.status(500).json({ error: String(err) }) }
})
