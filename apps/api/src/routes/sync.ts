import { Router, Request, Response } from 'express'
import { executarSync } from '../jobs/sync'
import { buscarStatusSync } from '../db/queries'
import { hotmartService } from '../services/hotmart'

export const syncRouter = Router()

// Flag para evitar duas syncs simultâneas
let syncEmAndamento = false

// POST /api/sync/manual
// Body opcional: { "full": true } para forçar sync histórico completo desde 2023
syncRouter.post('/manual', async (req: Request, res: Response) => {
  if (syncEmAndamento) {
    return res.status(409).json({
      success: false,
      error: 'Sincronização já está em andamento. Tente novamente em instantes.',
    })
  }

  const forceFull = req.body?.full === true
  syncEmAndamento = true

  res.json({
    success: true,
    message: forceFull
      ? 'Sync COMPLETO iniciado — buscando histórico desde jan/2023.'
      : 'Sync incremental iniciado.',
  })

  try {
    const resultado = await executarSync(forceFull)
    console.log('[Sync] Resultado:', JSON.stringify(resultado, null, 2))
  } catch (err) {
    console.error('[Sync] Erro inesperado no job manual:', err)
  } finally {
    syncEmAndamento = false
  }
})

// GET /api/sync/status
syncRouter.get('/status', async (_req: Request, res: Response) => {
  try {
    const status = await buscarStatusSync()
    res.json({ success: true, ...status, sync_em_andamento: syncEmAndamento })
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) })
  }
})

// ── Debug endpoints ────────────────────────────────────────────────────────

// GET /api/sync/debug/token
// Testa autenticação OAuth2 e mostra o token obtido
syncRouter.get('/debug/token', async (_req: Request, res: Response) => {
  const result = await hotmartService.debugToken()
  res.status(result.success ? 200 : 401).json(result)
})

// GET /api/sync/debug/produtos
// Resposta bruta do endpoint de produtos
syncRouter.get('/debug/produtos', async (_req: Request, res: Response) => {
  try {
    const result = await hotmartService.rawRequest('/products/api/v1/products')
    res.json({ success: true, ...result })
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) })
  }
})

// GET /api/sync/debug/vendas?max_results=5&transaction_status=COMPLETE
// Resposta bruta do endpoint de vendas (página única, padrão 5 itens)
syncRouter.get('/debug/vendas', async (req: Request, res: Response) => {
  try {
    const max_results        = Number(req.query.max_results ?? 5)
    const transaction_status = (req.query.transaction_status as string) ?? 'COMPLETE'

    const params: Record<string, string | number> = { max_results, transaction_status }
    if (req.query.page_token) params['page_token'] = req.query.page_token as string

    const result = await hotmartService.rawRequest('/payments/api/v1/sales/history', params)
    res.json({ success: true, ...result })
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) })
  }
})

// GET /api/sync/debug/vendas/todos-status
// Testa os principais status para ver onde estão as vendas
syncRouter.get('/debug/vendas/todos-status', async (_req: Request, res: Response) => {
  const statuses = ['COMPLETE', 'APPROVED', 'CANCELLED', 'REFUNDED', 'CHARGEBACK']
  const resultado: Record<string, unknown> = {}

  for (const st of statuses) {
    try {
      const r = await hotmartService.rawRequest(
        '/payments/api/v1/sales/history',
        { max_results: 3, transaction_status: st }
      )
      const body = r.body as { page_info?: { total_results?: number }; items?: unknown[] }
      resultado[st] = {
        http_status: r.status,
        total_results: body?.page_info?.total_results ?? 0,
        items_retornados: Array.isArray(body?.items) ? body.items.length : 0,
      }
    } catch (err) {
      resultado[st] = { erro: String(err) }
    }
  }

  res.json({ success: true, resultado })
})
