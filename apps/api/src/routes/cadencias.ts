import { Router, Request, Response } from 'express'
import { query, queryOne, pool } from '../db'
import { z } from 'zod'
import {
  buscarListaDoDia,
  avancarEtapa,
  inscreverClienteNaTrilhaAutomaticamente,
  buscarMetricasCadencias,
} from '../services/cadencia'
import { popularFilaReativacao } from '../services/reativacao'

export const cadenciasRouter = Router()

// ── GET /api/cadencias/trilhas ─────────────────────────────────────────────
cadenciasRouter.get('/trilhas', async (_req: Request, res: Response) => {
  try {
    const trilhas = await query<{
      id: string
      nome: string
      descricao: string | null
      ativa: boolean
      cor: string
      tipo_pipeline: string
      produto_entrada: string | null
      produto_destino: string | null
      total_etapas: number
      clientes_ativos: number
      clientes_convertidos: number
      taxa_conversao: number
    }>(`
      SELECT
        t.id,
        t.nome,
        t.descricao,
        t.ativa,
        t.cor,
        COALESCE(t.tipo_pipeline, 'ativo') AS tipo_pipeline,
        pe.nome                            AS produto_entrada,
        pd.nome                            AS produto_destino,
        (SELECT COUNT(*)::int FROM etapas_cadencia WHERE trilha_id = t.id AND ativa = true)
                                                                      AS total_etapas,
        COUNT(CASE WHEN ct.status = 'ativo'      THEN 1 END)::int    AS clientes_ativos,
        COUNT(CASE WHEN ct.status = 'convertido' THEN 1 END)::int    AS clientes_convertidos,
        CASE WHEN COUNT(ct.id) > 0
          THEN ROUND(
            COUNT(CASE WHEN ct.status = 'convertido' THEN 1 END)::numeric / COUNT(ct.id) * 100, 1
          )::float
          ELSE 0
        END                                                           AS taxa_conversao
      FROM trilhas_cadencia t
      LEFT JOIN produtos pe ON pe.id = t.produto_entrada_id
      LEFT JOIN produtos pd ON pd.id = t.produto_destino_id
      LEFT JOIN clientes_trilha ct ON ct.trilha_id = t.id
      GROUP BY t.id, pe.nome, pd.nome
      ORDER BY t.created_at ASC
    `)
    res.json({ success: true, trilhas })
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) })
  }
})

// ── GET /api/cadencias/diagnostico/:produtoId ─────────────────────────────
// Verifica se existe trilha vinculada ao produto, tanto por match direto
// (produto_entrada_id) quanto por nome similar (fallback do webhook).
cadenciasRouter.get('/diagnostico/:produtoId', async (req: Request, res: Response) => {
  try {
    const { produtoId } = req.params

    // Produto recebido
    const produto = await queryOne<{ id: string; nome: string; hotmart_id: string | null }>(
      'SELECT id, nome, hotmart_id FROM produtos WHERE id = $1', [produtoId]
    )
    if (!produto) return res.status(404).json({ error: 'Produto não encontrado' })

    // Match direto
    const matchDireto = await queryOne<{ trilha_id: string; trilha_nome: string }>(`
      SELECT t.id AS trilha_id, t.nome AS trilha_nome
      FROM trilhas_cadencia t
      WHERE t.produto_entrada_id = $1 AND t.ativa = true
      LIMIT 1
    `, [produtoId])

    // Match por nome (mesmo fallback usado no webhook)
    const nomeNorm    = produto.nome.replace(/^(cd|e-?book|ebook|gravação do workshop|gravacao do workshop|workshop|masterclass|desafio|programa|combo)[\s:–\-]*/gi, '').trim().toLowerCase().substring(0, 30)
    const nomePrefixo = produto.nome.toLowerCase().substring(0, 20)

    const matchNome = nomeNorm.length >= 6
      ? await queryOne<{ trilha_id: string; trilha_nome: string; produto_entrada: string }>(`
          SELECT tc.id AS trilha_id, tc.nome AS trilha_nome, pe.nome AS produto_entrada
          FROM trilhas_cadencia tc
          JOIN produtos pe ON pe.id = tc.produto_entrada_id
          WHERE tc.ativa = true
            AND (LOWER(pe.nome) LIKE $1 OR LOWER(pe.nome) LIKE $2)
          LIMIT 1
        `, [`%${nomeNorm}%`, `%${nomePrefixo}%`])
      : null

    // Todos os vínculos diretos de trilhas ativas
    const todasTrilhas = await query<{
      trilha_nome: string
      produto_entrada_id: string | null
      produto_entrada_nome: string | null
    }>(`
      SELECT t.nome AS trilha_nome, t.produto_entrada_id, pe.nome AS produto_entrada_nome
      FROM trilhas_cadencia t
      LEFT JOIN produtos pe ON pe.id = t.produto_entrada_id
      WHERE t.ativa = true
      ORDER BY t.tipo_pipeline, t.nome
    `)

    res.json({
      produto: { id: produto.id, nome: produto.nome, hotmart_id: produto.hotmart_id },
      nome_normalizado: nomeNorm,
      match_direto:  matchDireto  ?? null,
      match_por_nome: matchNome   ?? null,
      sera_inscrito:  !!(matchDireto || matchNome),
      todas_trilhas_ativas: todasTrilhas,
    })
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})

// ── GET /api/cadencias/trilhas/:id ────────────────────────────────────────
cadenciasRouter.get('/trilhas/:id', async (req: Request, res: Response) => {
  try {
    const trilha = await queryOne<{
      id: string; nome: string; descricao: string | null; ativa: boolean
      cor: string; produto_entrada_id: string | null; produto_destino_id: string | null
      produto_entrada: string | null; produto_destino: string | null
    }>(`
      SELECT t.*, pe.nome AS produto_entrada, pd.nome AS produto_destino
      FROM trilhas_cadencia t
      LEFT JOIN produtos pe ON pe.id = t.produto_entrada_id
      LEFT JOIN produtos pd ON pd.id = t.produto_destino_id
      WHERE t.id = $1
    `, [req.params.id])

    if (!trilha) return res.status(404).json({ success: false, error: 'Trilha não encontrada' })

    const etapas = await query(`
      SELECT * FROM etapas_cadencia WHERE trilha_id = $1 ORDER BY numero_etapa ASC
    `, [req.params.id])

    res.json({ success: true, trilha, etapas })
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) })
  }
})

// ── Helpers de criação de etapas ─────────────────────────────────────────

const DIAS_POR_ETAPAS: Record<number, number[]> = {
  3: [1, 7, 21],
  4: [1, 7, 14, 30],
  5: [1, 3, 7, 14, 30],
  6: [1, 3, 7, 14, 21, 30],
}

const MENSAGENS_PADRAO = [
  'Olá {nome}! Vi que você acabou de adquirir o {produto}. Estou aqui se precisar de qualquer ajuda 👊',
  'E aí {nome}, como está sendo sua experiência com o {produto}?',
  'Oi {nome}! Tenho algo que pode complementar muito bem o {produto} que você tem. Posso te contar?',
  '{nome}, vou ser direto: o Conduta Masculina é o próximo passo natural para quem tem o {produto}. Quer saber mais?',
  '{nome}, ainda dá tempo de dar o próximo passo. O Conduta Masculina vai complementar tudo que você já tem 💪',
  'Última mensagem por aqui, {nome}. Quando sentir que é hora do próximo nível, o Conduta vai estar aqui 🤝',
]

// ── POST /api/cadencias/trilhas ───────────────────────────────────────────
const trilhaCreateSchema = z.object({
  nome:               z.string().min(1),
  descricao:          z.string().optional(),
  tipo_pipeline:      z.enum(['ativo', 'reativacao']).default('ativo'),
  produto_entrada_id: z.string().uuid().nullable().optional(),
  produto_destino_id: z.string().uuid().nullable().optional(),
  cor:                z.string().optional(),
  num_etapas:         z.number().int().min(3).max(6).default(5),
})

cadenciasRouter.post('/trilhas', async (req: Request, res: Response) => {
  try {
    const body = trilhaCreateSchema.parse(req.body)

    const nova = await queryOne<{ id: string }>(`
      INSERT INTO trilhas_cadencia (nome, descricao, tipo_pipeline, produto_entrada_id, produto_destino_id, cor)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id
    `, [
      body.nome,
      body.descricao ?? null,
      body.tipo_pipeline,
      body.produto_entrada_id ?? null,
      body.produto_destino_id ?? null,
      body.cor ?? '#3B82F6',
    ])

    const trilhaId = nova!.id
    const dias = DIAS_POR_ETAPAS[body.num_etapas]

    for (let i = 0; i < body.num_etapas; i++) {
      await query(`
        INSERT INTO etapas_cadencia (trilha_id, numero_etapa, nome, dia_envio, mensagem_whatsapp, ativa, ordem)
        VALUES ($1, $2, $3, $4, $5, true, $2)
      `, [trilhaId, i + 1, `Mensagem ${i + 1}`, dias[i], MENSAGENS_PADRAO[i]])
    }

    res.status(201).json({ success: true, id: trilhaId })
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors })
    res.status(500).json({ success: false, error: String(err) })
  }
})

// ── PUT /api/cadencias/trilhas/:id ────────────────────────────────────────
const trilhaUpdateSchema = z.object({
  nome:               z.string().min(1).optional(),
  descricao:          z.string().optional(),
  tipo_pipeline:      z.enum(['ativo', 'reativacao']).optional(),
  produto_entrada_id: z.string().uuid().nullable().optional(),
  produto_destino_id: z.string().uuid().nullable().optional(),
  cor:                z.string().optional(),
  ativa:              z.boolean().optional(),
})

cadenciasRouter.put('/trilhas/:id', async (req: Request, res: Response) => {
  try {
    const body = trilhaUpdateSchema.parse(req.body)
    await pool.query(`
      UPDATE trilhas_cadencia
      SET
        nome               = COALESCE($2,        nome),
        produto_entrada_id = COALESCE($3::uuid,  produto_entrada_id),
        produto_destino_id = COALESCE($4::uuid,  produto_destino_id),
        cor                = COALESCE($5,        cor),
        ativa              = COALESCE($6,        ativa),
        tipo_pipeline      = COALESCE($7,        tipo_pipeline)
      WHERE id = $1
    `, [
      req.params.id,
      body.nome               ?? null,
      body.produto_entrada_id ?? null,
      body.produto_destino_id ?? null,
      body.cor                ?? null,
      body.ativa              ?? null,
      body.tipo_pipeline      ?? null,
    ])
    res.json({ success: true })
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors })
    res.status(500).json({ success: false, error: String(err) })
  }
})

// ── DELETE /api/cadencias/trilhas/:id ─────────────────────────────────────
cadenciasRouter.delete('/trilhas/:id', async (req: Request, res: Response) => {
  try {
    const ativos = await queryOne<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM clientes_trilha WHERE trilha_id = $1 AND status = 'ativo'`,
      [req.params.id]
    )

    if ((ativos?.count ?? 0) > 0) {
      return res.status(409).json({
        success:         false,
        error:           `Esta trilha possui ${ativos!.count} cliente(s) em andamento.`,
        clientes_ativos: ativos!.count,
      })
    }

    await pool.query('BEGIN')
    await pool.query('DELETE FROM clientes_trilha  WHERE trilha_id = $1', [req.params.id])
    await pool.query('DELETE FROM etapas_cadencia  WHERE trilha_id = $1', [req.params.id])
    await pool.query('DELETE FROM trilhas_cadencia WHERE id        = $1', [req.params.id])
    await pool.query('COMMIT')

    res.json({ success: true })
  } catch (err) {
    await pool.query('ROLLBACK').catch(() => {})
    res.status(500).json({ success: false, error: String(err) })
  }
})

// ── GET /api/cadencias/trilhas/:id/etapas ────────────────────────────────
cadenciasRouter.get('/trilhas/:id/etapas', async (req: Request, res: Response) => {
  try {
    const etapas = await query(`
      SELECT * FROM etapas_cadencia WHERE trilha_id = $1 ORDER BY numero_etapa ASC
    `, [req.params.id])
    res.json({ success: true, etapas })
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) })
  }
})

// ── PUT /api/cadencias/etapas/:id ────────────────────────────────────────
const etapaSchema = z.object({
  nome:               z.string().min(1).optional(),
  mensagem_whatsapp:  z.string().min(1).optional(),
  objetivo:           z.string().optional(),
  ativa:              z.boolean().optional(),
})

cadenciasRouter.put('/etapas/:id', async (req: Request, res: Response) => {
  try {
    const body = etapaSchema.parse(req.body)
    await pool.query(`
      UPDATE etapas_cadencia
      SET
        nome              = COALESCE($2, nome),
        mensagem_whatsapp = COALESCE($3, mensagem_whatsapp),
        objetivo          = COALESCE($4, objetivo),
        ativa             = COALESCE($5, ativa)
      WHERE id = $1
    `, [req.params.id, body.nome ?? null, body.mensagem_whatsapp ?? null, body.objetivo ?? null, body.ativa ?? null])
    res.json({ success: true })
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors })
    res.status(500).json({ success: false, error: String(err) })
  }
})

// ── GET /api/cadencias/lista-do-dia ──────────────────────────────────────
cadenciasRouter.get('/lista-do-dia', async (_req: Request, res: Response) => {
  try {
    const itens = await buscarListaDoDia()
    res.json({ success: true, total: itens.length, itens })
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) })
  }
})

// ── PATCH /api/cadencias/clientes-trilha/:id/avancar ─────────────────────
const avancarSchema = z.object({
  status_contato: z.enum(['enviado', 'respondeu', 'sem_resposta', 'convertido', 'nao_quer']),
  observacao:     z.string().optional(),
})

cadenciasRouter.patch('/clientes-trilha/:id/avancar', async (req: Request, res: Response) => {
  try {
    const body = avancarSchema.parse(req.body)
    const resultado = await avancarEtapa(req.params.id, body.status_contato, body.observacao)
    res.json({ success: true, ...resultado })
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors })
    res.status(500).json({ success: false, error: String(err) })
  }
})

// ── POST /api/cadencias/clientes-trilha/inscrever ─────────────────────────
const inscreverSchema = z.object({
  cliente_id: z.string().uuid(),
  trilha_id:  z.string().uuid(),
})

cadenciasRouter.post('/clientes-trilha/inscrever', async (req: Request, res: Response) => {
  try {
    const body = inscreverSchema.parse(req.body)

    const etapa1 = await queryOne<{ dia_envio: number }>(`
      SELECT dia_envio FROM etapas_cadencia
      WHERE trilha_id = $1 AND numero_etapa = 1 AND ativa = true
    `, [body.trilha_id])

    const diasEtapa1 = etapa1?.dia_envio ?? 1

    const resultado = await queryOne<{ id: string }>(`
      INSERT INTO clientes_trilha (cliente_id, trilha_id, etapa_atual, data_proxima_etapa)
      VALUES ($1, $2, 1, NOW() + ($3 || ' days')::interval)
      ON CONFLICT (cliente_id, trilha_id) DO NOTHING
      RETURNING id
    `, [body.cliente_id, body.trilha_id, diasEtapa1])

    if (!resultado) {
      return res.status(409).json({ success: false, error: 'Cliente já inscrito nesta trilha' })
    }

    res.status(201).json({ success: true, id: resultado.id })
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors })
    res.status(500).json({ success: false, error: String(err) })
  }
})

// ── GET /api/cadencias/metricas ───────────────────────────────────────────
cadenciasRouter.get('/metricas', async (_req: Request, res: Response) => {
  try {
    const metricas = await buscarMetricasCadencias()
    res.json({ success: true, ...metricas })
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) })
  }
})

// ── GET /api/cadencias/cliente/:clienteId ────────────────────────────────
// Retorna em qual trilha o cliente está atualmente (para badge na lista diária)
cadenciasRouter.get('/cliente/:clienteId', async (req: Request, res: Response) => {
  try {
    const trilhas = await query<{
      id: string; trilha_nome: string; trilha_cor: string
      etapa_atual: number; total_etapas: number; status: string
    }>(`
      SELECT
        ct.id,
        t.nome  AS trilha_nome,
        t.cor   AS trilha_cor,
        ct.etapa_atual,
        (SELECT COUNT(*)::int FROM etapas_cadencia WHERE trilha_id = t.id AND ativa = true) AS total_etapas,
        ct.status
      FROM clientes_trilha ct
      JOIN trilhas_cadencia t ON t.id = ct.trilha_id
      WHERE ct.cliente_id = $1 AND ct.status = 'ativo'
      ORDER BY ct.created_at DESC
    `, [req.params.clienteId])
    res.json({ success: true, trilhas })
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) })
  }
})

// ── GET /api/cadencias/fluxo-ativo ───────────────────────────────────────
// Lista do dia filtrada para pipeline ativo (leads ≤ dias_lead_antigo)
cadenciasRouter.get('/fluxo-ativo', async (_req: Request, res: Response) => {
  try {
    const rows = await query<{
      id: string
      cliente_id: string
      cliente_nome: string
      cliente_email: string
      cliente_telefone: string | null
      trilha_id: string
      trilha_nome: string
      trilha_cor: string
      produto_entrada: string
      etapa_atual: number
      total_etapas: number
      etapa_id: string
      nome_etapa: string
      mensagem_whatsapp: string
      dias_na_trilha: number
      status: string
    }>(`
      SELECT
        ct.id,
        ct.cliente_id,
        c.nome                           AS cliente_nome,
        c.email                          AS cliente_email,
        c.telefone_formatado             AS cliente_telefone,
        t.id                             AS trilha_id,
        t.nome                           AS trilha_nome,
        t.cor                            AS trilha_cor,
        COALESCE(pe.nome, '')            AS produto_entrada,
        ct.etapa_atual,
        (SELECT COUNT(*)::int FROM etapas_cadencia WHERE trilha_id = t.id AND ativa = true)
                                         AS total_etapas,
        e.id                             AS etapa_id,
        e.nome                           AS nome_etapa,
        e.mensagem_whatsapp,
        EXTRACT(DAY FROM NOW() - ct.data_entrada)::int AS dias_na_trilha,
        ct.status
      FROM clientes_trilha ct
      JOIN clientes c           ON c.id = ct.cliente_id
      JOIN trilhas_cadencia t   ON t.id = ct.trilha_id
                                AND (t.tipo_pipeline = 'ativo' OR t.tipo_pipeline IS NULL)
      LEFT JOIN produtos pe     ON pe.id = t.produto_entrada_id
      JOIN etapas_cadencia e    ON e.trilha_id = t.id
                               AND e.numero_etapa = ct.etapa_atual
                               AND e.ativa = true
      WHERE ct.status = 'ativo'
        AND ct.data_proxima_etapa <= NOW()
        AND (ct.tipo_pipeline = 'ativo' OR ct.tipo_pipeline IS NULL)
      ORDER BY ct.data_proxima_etapa ASC
    `)

    const itens = rows.map(r => {
      const msg  = r.mensagem_whatsapp.replace(/\{nome\}/g, r.cliente_nome.split(' ')[0])
      const link = r.cliente_telefone
        ? `https://wa.me/${r.cliente_telefone}?text=${encodeURIComponent(msg)}`
        : null
      return { ...r, mensagem_do_dia: msg, link_whatsapp: link }
    })

    res.json({ success: true, total: itens.length, itens })
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) })
  }
})

// ── POST /api/cadencias/fluxo-ativo/atualizar-prioridades ────────────────
cadenciasRouter.post('/fluxo-ativo/atualizar-prioridades', async (_req: Request, res: Response) => {
  try {
    const deletado = await pool.query(`
      DELETE FROM clientes_trilha
      WHERE etapa_atual = 1
        AND status = 'ativo'
        AND (tipo_pipeline = 'ativo' OR tipo_pipeline IS NULL)
    `)
    const removidos = deletado.rowCount ?? 0

    const clientes = await query<{ cliente_id: string; produto_id: string }>(`
      SELECT DISTINCT ON (co.cliente_id) co.cliente_id, co.produto_id
      FROM compras co
      WHERE (co.data_compra AT TIME ZONE 'America/Sao_Paulo')::date
              >= (NOW() AT TIME ZONE 'America/Sao_Paulo')::date - INTERVAL '30 days'
        AND co.status IN ('COMPLETE', 'COMPLETED', 'APPROVED')
      ORDER BY co.cliente_id, co.data_compra DESC
    `)

    let reinseridos = 0
    for (const c of clientes) {
      const trilhaId = await inscreverClienteNaTrilhaAutomaticamente(c.cliente_id, c.produto_id)
      if (trilhaId) reinseridos++
    }

    if (reinseridos > 0) {
      await pool.query(`
        UPDATE clientes_trilha
        SET data_proxima_etapa = NOW()
        WHERE etapa_atual = 1
          AND status = 'ativo'
          AND (tipo_pipeline = 'ativo' OR tipo_pipeline IS NULL)
          AND data_proxima_etapa > NOW()
      `)
    }

    res.json({
      success: true,
      removidos,
      reinseridos,
      mensagem: `${removidos} contatos removidos e ${reinseridos} reinseridos com prioridade atualizada`,
    })
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) })
  }
})

// ── POST /api/cadencias/reativacao/atualizar-prioridades ─────────────────
cadenciasRouter.post('/reativacao/atualizar-prioridades', async (_req: Request, res: Response) => {
  try {
    const deletado = await pool.query(`
      DELETE FROM clientes_trilha
      WHERE etapa_atual = 1
        AND status = 'ativo'
        AND tipo_pipeline = 'reativacao'
    `)
    const removidos = deletado.rowCount ?? 0

    const resultado = await popularFilaReativacao()

    res.json({
      success: true,
      removidos,
      reinseridos: resultado.adicionados,
    })
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) })
  }
})

// ── Reexporta inscreverClienteNaTrilhaAutomaticamente para uso interno ─────
export { inscreverClienteNaTrilhaAutomaticamente }
