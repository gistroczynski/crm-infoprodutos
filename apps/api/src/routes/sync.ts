import { Router, Request, Response } from 'express'
import { executarSync } from '../jobs/sync'
import { buscarStatusSync, buscarDataUltimaCompra } from '../db/queries'
import { hotmartService } from '../services/hotmart'
import { upsertCliente, upsertProduto, upsertCompra, buscarProdutoPorHotmartId } from '../db/queries'
import { reclassificarTodasCompras, lerValorMaximoOB } from '../services/classificarOrderBump'

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

// POST /api/sync/completo
// Força busca dos últimos 60 dias independente do que está no banco
// Útil para recuperar vendas perdidas por falha de sync
syncRouter.post('/completo', async (req: Request, res: Response) => {
  if (syncEmAndamento) {
    return res.status(409).json({
      success: false,
      error: 'Sincronização já está em andamento.',
    })
  }

  const dias = Math.min(Number(req.body?.dias ?? 60), 365)
  const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000)
  syncEmAndamento = true

  res.json({
    success: true,
    message: `Sync completo iniciado — buscando vendas dos últimos ${dias} dias (desde ${desde.toISOString().slice(0, 10)}).`,
    desde: desde.toISOString().slice(0, 10),
  })

  try {
    const resultado = await executarSync(false, desde)
    console.log('[Sync/Completo] Resultado:', JSON.stringify(resultado, null, 2))
  } catch (err) {
    console.error('[Sync/Completo] Erro inesperado:', err)
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

// POST /api/sync/recuperar-periodo
// Body: { inicio: "2026-04-13", fim: "2026-04-19" }
// Busca vendas de um período específico na Hotmart e faz upsert no banco.
// Útil para recuperar gaps manualmente sem refazer o sync completo.
syncRouter.post('/recuperar-periodo', async (req: Request, res: Response) => {
  if (syncEmAndamento) {
    return res.status(409).json({
      success: false,
      error: 'Sincronização já está em andamento. Tente novamente em instantes.',
    })
  }

  const { inicio, fim } = req.body ?? {}

  if (!inicio || !fim) {
    return res.status(400).json({
      success: false,
      error: 'Body deve conter { inicio: "YYYY-MM-DD", fim: "YYYY-MM-DD" }',
    })
  }

  const startMs = new Date(inicio + 'T00:00:00.000Z').getTime()
  const endMs   = new Date(fim   + 'T23:59:59.999Z').getTime()

  if (isNaN(startMs) || isNaN(endMs) || startMs > endMs) {
    return res.status(400).json({ success: false, error: 'Datas inválidas ou invertidas.' })
  }

  syncEmAndamento = true

  res.json({
    success: true,
    message: `Recuperação iniciada para o período ${inicio} → ${fim}. Aguarde alguns instantes.`,
    periodo: { inicio, fim },
  })

  try {
    console.log(`\n[Sync/Recuperar] ▶ Buscando vendas de ${inicio} → ${fim}`)
    const vendas = await hotmartService.buscarVendasPorPeriodo(startMs, endMs)
    console.log(`[Sync/Recuperar] ${vendas.length} vendas encontradas`)

    let novas = 0, atualizadas = 0, erros = 0

    for (const venda of vendas) {
      try {
        const { cliente: clienteDados, produto: produtoDados, compra: compraDados } =
          hotmartService.mapearVenda(venda)

        const { id: clienteId }  = await upsertCliente(clienteDados)

        let produtoId: string
        const produtoExistente = await buscarProdutoPorHotmartId(produtoDados.hotmart_id)
        if (produtoExistente) {
          produtoId = produtoExistente.id
        } else {
          const { id } = await upsertProduto(produtoDados)
          produtoId = id
        }

        const { novo } = await upsertCompra({ ...compraDados, cliente_id: clienteId, produto_id: produtoId })
        if (novo) novas++
        else atualizadas++
      } catch (err) {
        erros++
        console.error(`[Sync/Recuperar] Erro na venda ${venda.purchase.transaction}:`, err)
      }
    }

    // Reclassifica order bumps após upsert
    try {
      const valorMaximoOB = await lerValorMaximoOB()
      await reclassificarTodasCompras(valorMaximoOB)
    } catch (err) {
      console.error('[Sync/Recuperar] Erro ao reclassificar order bumps:', err)
    }

    console.log(
      `[Sync/Recuperar] ✔ Concluído — novas: ${novas} | atualizadas: ${atualizadas} | erros: ${erros}`
    )
  } catch (err) {
    console.error('[Sync/Recuperar] Erro inesperado:', err)
  } finally {
    syncEmAndamento = false
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
