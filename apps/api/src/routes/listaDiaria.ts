import { Router, Request, Response } from 'express'
import { query, queryOne } from '../db'
import { z } from 'zod'
import type { ListaDiariaComCliente } from '@crm/shared'

export const listaDiariaRouter = Router()

// GET /lista-diaria?data=YYYY-MM-DD
listaDiariaRouter.get('/', async (req: Request, res: Response) => {
  try {
    const data = (req.query.data as string) ?? new Date().toISOString().slice(0, 10)

    const rows = await query<ListaDiariaComCliente>(`
      SELECT
        ld.*,
        json_build_object(
          'id', c.id,
          'nome', c.nome,
          'email', c.email,
          'telefone_formatado', c.telefone_formatado
        ) AS cliente
      FROM lista_diaria ld
      JOIN clientes c ON c.id = ld.cliente_id
      WHERE ld.data = $1
      ORDER BY ld.score DESC
    `, [data])

    res.json(rows)
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})

// PATCH /lista-diaria/:id/contato
const contatoSchema = z.object({
  status_contato: z.enum(['pendente', 'contatado', 'sem_resposta', 'convertido']),
  observacao: z.string().optional(),
})

listaDiariaRouter.patch('/:id/contato', async (req: Request, res: Response) => {
  try {
    const body = contatoSchema.parse(req.body)
    const row = await queryOne(`
      UPDATE lista_diaria
      SET
        status_contato = $2,
        observacao     = COALESCE($3, observacao),
        contatado_em   = CASE WHEN $2 = 'contatado' THEN NOW() ELSE contatado_em END
      WHERE id = $1
      RETURNING *
    `, [req.params.id, body.status_contato, body.observacao ?? null])

    if (!row) return res.status(404).json({ error: 'Entrada não encontrada' })
    res.json(row)
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors })
    res.status(500).json({ error: String(err) })
  }
})

// POST /lista-diaria/gerar — gera a lista do dia com base nos scores
listaDiariaRouter.post('/gerar', async (req: Request, res: Response) => {
  try {
    const hoje = new Date().toISOString().slice(0, 10)
    const [{ limite }] = await query<{ limite: string }>(
      `SELECT valor AS limite FROM configuracoes WHERE chave = 'limite_lista_diaria'`
    )

    await query(`
      INSERT INTO lista_diaria (data, cliente_id, prioridade, score, motivos)
      SELECT
        $1::date,
        ls.cliente_id,
        ls.prioridade,
        ls.score,
        ls.motivos
      FROM lead_scores ls
      ORDER BY ls.score DESC
      LIMIT $2
      ON CONFLICT (data, cliente_id) DO NOTHING
    `, [hoje, Number(limite ?? 30)])

    const count = await queryOne<{ total: number }>(
      `SELECT COUNT(*)::int AS total FROM lista_diaria WHERE data = $1`, [hoje]
    )
    res.json({ message: 'Lista gerada com sucesso', data: hoje, total: count?.total ?? 0 })
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})
