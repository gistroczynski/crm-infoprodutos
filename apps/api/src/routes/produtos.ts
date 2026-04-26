import { Router, Request, Response } from 'express'
import { query, queryOne } from '../db'
import { z } from 'zod'
import type { Produto } from '@crm/shared'

export const produtosRouter = Router()

const produtoSchema = z.object({
  nome: z.string().min(1),
  tipo: z.enum(['entrada', 'order_bump', 'upsell', 'principal']),
  preco: z.number().positive(),
  hotmart_id: z.string().optional(),
  ativo: z.boolean().optional(),
})

produtosRouter.get('/', async (_req: Request, res: Response) => {
  try {
    const rows = await query<Produto>(`
      SELECT DISTINCT ON (nome) id, hotmart_id, nome, tipo, preco, ativo, created_at
      FROM produtos
      WHERE ativo = true
      ORDER BY nome, created_at DESC
    `)
    res.json(rows)
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})

produtosRouter.post('/', async (req: Request, res: Response) => {
  try {
    const body = produtoSchema.parse(req.body)
    const [produto] = await query<Produto>(`
      INSERT INTO produtos (nome, tipo, preco, hotmart_id, ativo)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [body.nome, body.tipo, body.preco, body.hotmart_id ?? null, body.ativo ?? true])
    res.status(201).json(produto)
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors })
    res.status(500).json({ error: String(err) })
  }
})

produtosRouter.patch('/:id', async (req: Request, res: Response) => {
  try {
    const body = produtoSchema.partial().parse(req.body)
    const fields = Object.entries(body)
    if (fields.length === 0) return res.status(400).json({ error: 'Nenhum campo para atualizar' })

    const setClause = fields.map(([k], i) => `${k} = $${i + 2}`).join(', ')
    const [produto] = await query<Produto>(
      `UPDATE produtos SET ${setClause} WHERE id = $1 RETURNING *`,
      [req.params.id, ...fields.map(([, v]) => v)]
    )
    if (!produto) return res.status(404).json({ error: 'Produto não encontrado' })
    res.json(produto)
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors })
    res.status(500).json({ error: String(err) })
  }
})
