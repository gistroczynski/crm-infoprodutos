import { Router, Request, Response } from 'express'
import { query, queryOne } from '../db'
import { z } from 'zod'
import type { Configuracao } from '@crm/shared'

export const configuracoesRouter = Router()

// ── GET /api/configuracoes ─────────────────────────────────────────────────

configuracoesRouter.get('/', async (_req: Request, res: Response) => {
  try {
    const rows = await query<Configuracao>('SELECT * FROM configuracoes ORDER BY chave')
    res.json(rows)
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})

const configSchema = z.object({ valor: z.string() })

configuracoesRouter.put('/:chave', async (req: Request, res: Response) => {
  try {
    const { valor } = configSchema.parse(req.body)
    const row = await queryOne<Configuracao>(`
      INSERT INTO configuracoes (chave, valor, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (chave) DO UPDATE SET valor = $2, updated_at = NOW()
      RETURNING *
    `, [req.params.chave, valor])
    res.json(row)
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors })
    res.status(500).json({ error: String(err) })
  }
})

// ── Mensagens Template ─────────────────────────────────────────────────────

export interface MensagemTemplate {
  id:          string
  nome:        string
  texto:       string
  contexto:    string
  is_sistema:  boolean
  ativa:       boolean
  produto_id:  string | null
  updated_at:  string
}

const mensagemSchema = z.object({
  nome:      z.string().min(1).max(255),
  texto:     z.string().min(1),
  contexto:  z.string().min(1).max(100).default('geral'),
  ativa:     z.boolean().optional().default(true),
})

// GET /api/configuracoes/mensagens
configuracoesRouter.get('/mensagens', async (_req: Request, res: Response) => {
  try {
    const rows = await query<MensagemTemplate>(`
      SELECT id, nome, texto, contexto, is_sistema, ativa, produto_id,
             COALESCE(updated_at, NOW()) AS updated_at
      FROM mensagens_template
      ORDER BY contexto, is_sistema DESC, nome
    `)
    res.json(rows)
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})

// POST /api/configuracoes/mensagens
configuracoesRouter.post('/mensagens', async (req: Request, res: Response) => {
  try {
    const { nome, texto, contexto, ativa } = mensagemSchema.parse(req.body)
    const row = await queryOne<MensagemTemplate>(`
      INSERT INTO mensagens_template (nome, texto, contexto, is_sistema, ativa, updated_at)
      VALUES ($1, $2, $3, false, $4, NOW())
      RETURNING id, nome, texto, contexto, is_sistema, ativa, produto_id,
                COALESCE(updated_at, NOW()) AS updated_at
    `, [nome, texto, contexto, ativa])
    res.status(201).json(row)
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors })
    res.status(500).json({ error: String(err) })
  }
})

// PUT /api/configuracoes/mensagens/:id
configuracoesRouter.put('/mensagens/:id', async (req: Request, res: Response) => {
  try {
    const { nome, texto, contexto, ativa } = mensagemSchema.parse(req.body)
    const row = await queryOne<MensagemTemplate>(`
      UPDATE mensagens_template
      SET nome = $1, texto = $2, contexto = $3, ativa = $4, updated_at = NOW()
      WHERE id = $5
      RETURNING id, nome, texto, contexto, is_sistema, ativa, produto_id,
                COALESCE(updated_at, NOW()) AS updated_at
    `, [nome, texto, contexto, ativa, req.params.id])
    if (!row) return res.status(404).json({ error: 'Template não encontrado.' })
    res.json(row)
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors })
    res.status(500).json({ error: String(err) })
  }
})

// POST /api/configuracoes/mensagens/:id/duplicar
configuracoesRouter.post('/mensagens/:id/duplicar', async (req: Request, res: Response) => {
  try {
    const original = await queryOne<MensagemTemplate>(
      'SELECT * FROM mensagens_template WHERE id = $1', [req.params.id]
    )
    if (!original) return res.status(404).json({ error: 'Template não encontrado.' })

    const row = await queryOne<MensagemTemplate>(`
      INSERT INTO mensagens_template (nome, texto, contexto, is_sistema, ativa, updated_at)
      VALUES ($1, $2, $3, false, true, NOW())
      RETURNING id, nome, texto, contexto, is_sistema, ativa, produto_id,
                COALESCE(updated_at, NOW()) AS updated_at
    `, [`${original.nome} (cópia)`, original.texto, original.contexto])
    res.status(201).json(row)
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})

// DELETE /api/configuracoes/mensagens/:id
configuracoesRouter.delete('/mensagens/:id', async (req: Request, res: Response) => {
  try {
    const row = await queryOne<{ is_sistema: boolean }>(
      'SELECT is_sistema FROM mensagens_template WHERE id = $1', [req.params.id]
    )
    if (!row)            return res.status(404).json({ error: 'Template não encontrado.' })
    if (row.is_sistema)  return res.status(403).json({ error: 'Templates do sistema não podem ser excluídos.' })

    await query('DELETE FROM mensagens_template WHERE id = $1', [req.params.id])
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})
