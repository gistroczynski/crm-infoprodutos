import { Router, Request, Response } from 'express'
import { gerarListaDiaria, buscarListaHoje } from '../services/lista'
import { pool } from '../db'
import { z } from 'zod'

export const listaRouter = Router()

// ── GET /api/lista/hoje ────────────────────────────────────────────────────
listaRouter.get('/hoje', async (req: Request, res: Response) => {
  try {
    const prioridade = req.query.prioridade as string | undefined
    const data       = req.query.data as string | undefined

    if (prioridade && !['alta', 'media', 'baixa'].includes(prioridade)) {
      return res.status(400).json({ error: 'prioridade inválida. Use: alta, media, baixa' })
    }

    const resultado = await buscarListaHoje({ prioridade, data })
    res.json(resultado)
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})

// ── POST /api/lista/gerar ──────────────────────────────────────────────────
listaRouter.post('/gerar', async (_req: Request, res: Response) => {
  try {
    const resultado = await gerarListaDiaria()
    res.json({ success: true, ...resultado })
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) })
  }
})

// ── PATCH /api/lista/:id/contato ───────────────────────────────────────────
const contatoSchema = z.object({
  status_contato: z.enum(['contatado', 'sem_resposta', 'nao_pertence', 'convertido', 'pendente']),
  observacao: z.string().optional(),
})

listaRouter.patch('/:id/contato', async (req: Request, res: Response) => {
  try {
    const body = contatoSchema.parse(req.body)

    const result = await pool.query(`
      UPDATE lista_diaria SET
        status_contato = $2,
        observacao     = COALESCE($3, observacao),
        contatado_em   = CASE
          WHEN $2 IN ('contatado', 'convertido') AND contatado_em IS NULL
          THEN NOW()
          ELSE contatado_em
        END
      WHERE id = $1
      RETURNING *
    `, [req.params.id, body.status_contato, body.observacao ?? null])

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Item não encontrado' })
    }

    res.json({ success: true, item: result.rows[0] })
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors })
    res.status(500).json({ error: String(err) })
  }
})
