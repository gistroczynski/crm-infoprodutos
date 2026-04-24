import { Router, Request, Response } from 'express'
import { query, queryOne, pool } from '../db'
import { z } from 'zod'
import {
  buscarListaDoDia,
  avancarEtapa,
  inscreverClienteNaTrilhaAutomaticamente,
  buscarMetricasCadencias,
} from '../services/cadencia'

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

// ── POST /api/cadencias/trilhas ───────────────────────────────────────────
const trilhaSchema = z.object({
  nome:               z.string().min(1),
  descricao:          z.string().optional(),
  produto_entrada_id: z.string().uuid().optional(),
  produto_destino_id: z.string().uuid().optional(),
  cor:                z.string().optional(),
})

cadenciasRouter.post('/trilhas', async (req: Request, res: Response) => {
  try {
    const body = trilhaSchema.parse(req.body)
    const nova = await queryOne<{ id: string }>(`
      INSERT INTO trilhas_cadencia (nome, descricao, produto_entrada_id, produto_destino_id, cor)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id
    `, [body.nome, body.descricao ?? null, body.produto_entrada_id ?? null, body.produto_destino_id ?? null, body.cor ?? '#3B82F6'])
    res.status(201).json({ success: true, id: nova!.id })
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors })
    res.status(500).json({ success: false, error: String(err) })
  }
})

// ── PUT /api/cadencias/trilhas/:id ────────────────────────────────────────
cadenciasRouter.put('/trilhas/:id', async (req: Request, res: Response) => {
  try {
    const body = trilhaSchema.partial().parse(req.body)
    await pool.query(`
      UPDATE trilhas_cadencia
      SET
        nome               = COALESCE($2, nome),
        descricao          = COALESCE($3, descricao),
        produto_entrada_id = COALESCE($4::uuid, produto_entrada_id),
        produto_destino_id = COALESCE($5::uuid, produto_destino_id),
        cor                = COALESCE($6, cor)
      WHERE id = $1
    `, [req.params.id, body.nome ?? null, body.descricao ?? null, body.produto_entrada_id ?? null, body.produto_destino_id ?? null, body.cor ?? null])
    res.json({ success: true })
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors })
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

// ── Reexporta inscreverClienteNaTrilhaAutomaticamente para uso interno ─────
export { inscreverClienteNaTrilhaAutomaticamente }
