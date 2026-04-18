import { Router, Request, Response } from 'express'
import { query, queryOne } from '../db'
import { z } from 'zod'
import type { Configuracao } from '@crm/shared'

export const configuracoesRouter = Router()

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
