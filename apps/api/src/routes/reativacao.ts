import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { pool, queryOne } from '../db'
import {
  popularFilaReativacao,
  buscarListaReativacaoDia,
  buscarStatsReativacao,
} from '../services/reativacao'
import { avancarEtapa } from '../services/cadencia'

export const reativacaoRouter = Router()

// ── POST /api/reativacao/popular-fila ─────────────────────────────────────

reativacaoRouter.post('/popular-fila', async (_req: Request, res: Response) => {
  try {
    const resultado = await popularFilaReativacao()
    res.json({ success: true, ...resultado })
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) })
  }
})

// ── GET /api/reativacao/stats ─────────────────────────────────────────────

reativacaoRouter.get('/stats', async (_req: Request, res: Response) => {
  try {
    const stats = await buscarStatsReativacao()
    res.json({ success: true, ...stats })
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) })
  }
})

// ── GET /api/reativacao/lista-do-dia ─────────────────────────────────────

reativacaoRouter.get('/lista-do-dia', async (_req: Request, res: Response) => {
  try {
    const [itens, totalRealRow, cfgLimite] = await Promise.all([
      buscarListaReativacaoDia(),
      queryOne<{ total: number }>(`
        SELECT (
          (SELECT COUNT(*)::int FROM clientes_trilha ct
           JOIN trilhas_cadencia t ON t.id = ct.trilha_id AND t.tipo_pipeline = 'reativacao'
           WHERE ct.status = 'ativo') +
          (SELECT COUNT(*)::int FROM fila_reativacao WHERE status = 'aguardando')
        ) AS total
      `),
      queryOne<{ valor: string }>(
        `SELECT valor FROM configuracoes WHERE chave = 'limite_reativacao_diaria'`
      ),
    ])
    const totalReal = totalRealRow?.total ?? 0
    const limite = Number(cfgLimite?.valor ?? 15)
    res.json({ success: true, total: itens.length, total_real: totalReal, limite, itens })
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) })
  }
})

// ── PATCH /api/reativacao/clientes-trilha/:id/avancar ────────────────────

const avancarSchema = z.object({
  status_contato: z.enum(['enviado', 'respondeu', 'sem_resposta', 'convertido', 'nao_quer']),
  observacao:     z.string().optional(),
})

reativacaoRouter.patch('/clientes-trilha/:id/avancar', async (req: Request, res: Response) => {
  try {
    const body      = avancarSchema.parse(req.body)
    const resultado = await avancarEtapa(req.params.id, body.status_contato, body.observacao)

    // Espelha resultado na fila_reativacao
    if (body.status_contato === 'convertido') {
      await pool.query(`
        UPDATE fila_reativacao fr
        SET status = 'convertido'
        FROM clientes_trilha ct
        WHERE fr.cliente_id = ct.cliente_id AND ct.id = $1
      `, [req.params.id])
    } else if (body.status_contato === 'nao_quer') {
      await pool.query(`
        UPDATE fila_reativacao fr
        SET status = 'descartado'
        FROM clientes_trilha ct
        WHERE fr.cliente_id = ct.cliente_id AND ct.id = $1
      `, [req.params.id])
    }

    res.json({ success: true, ...resultado })
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors })
    res.status(500).json({ success: false, error: String(err) })
  }
})
