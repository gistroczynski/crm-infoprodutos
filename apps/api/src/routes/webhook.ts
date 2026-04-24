import { Router, Request, Response } from 'express'
import { pool, queryOne } from '../db'
import { formatarTelefone } from '../services/hotmart'
import { upsertCliente, upsertProduto, upsertCompra, buscarProdutoPorHotmartId } from '../db/queries'
import { reclassificarComprasCliente, lerValorMaximoOB } from '../services/classificarOrderBump'
import { inscreverClienteNaTrilhaAutomaticamente } from '../services/cadencia'

export const webhookRouter = Router()

// ── Tipos ──────────────────────────────────────────────────────────────────

interface HotmartPayload {
  event: string
  data: {
    buyer:    { name: string; email: string; phone?: string }
    product:  { id: string | number; name: string }
    purchase: {
      transaction:    string
      price?:         { value: number }
      order_date:     number
      status?:        string
      is_order_bump?: boolean
      offer?:         { code?: string }
      payment?:       { type?: string }
    }
  }
}

interface WebhookResult {
  cliente: { id: string; email: string; nome: string; novo: boolean; telefone: string | null; telefone_valido: boolean }
  produto: { id: string; nome: string; novo: boolean }
  compra:  { id: string; transaction: string; nova: boolean; valor: number | null }
  trilha:  { inscrito: boolean; trilha_id?: string }
}

const EVENTOS_COMPRA = ['PURCHASE_COMPLETE', 'PURCHASE_APPROVED', 'PURCHASE_BILLET_PRINTED']

// ── Lógica de processamento (compartilhada entre /hotmart e /test) ──────────

async function processarWebhookPayload(payload: HotmartPayload): Promise<WebhookResult> {
  const { buyer, product, purchase } = payload.data

  if (!buyer?.email) throw new Error('buyer.email ausente no payload')

  // ── Telefone ───────────────────────────────────────────────────────────
  const tel = buyer.phone
    ? formatarTelefone(buyer.phone)
    : { formatado: null as string | null, valido: false }

  // ── Cliente ────────────────────────────────────────────────────────────
  const { id: clienteId, novo: clienteNovo } = await upsertCliente({
    hotmart_id:         buyer.email,
    nome:               buyer.name,
    email:              buyer.email,
    telefone_raw:       buyer.phone ?? null,
    telefone_formatado: tel.formatado,
    telefone_valido:    tel.valido,
  })

  // ── Produto ────────────────────────────────────────────────────────────
  const hotmartProdutoId = String(product.id)
  let produtoId: string
  let produtoNovo = false
  const produtoExistente = await buscarProdutoPorHotmartId(hotmartProdutoId)

  if (produtoExistente) {
    produtoId = produtoExistente.id
  } else {
    const { id, novo } = await upsertProduto({ hotmart_id: hotmartProdutoId, nome: product.name })
    produtoId  = id
    produtoNovo = novo
  }

  // ── Compra ─────────────────────────────────────────────────────────────
  const { id: compraId, novo: compraNova } = await upsertCompra({
    hotmart_transaction_id: purchase.transaction,
    cliente_id:             clienteId,
    produto_id:             produtoId,
    valor:                  purchase.price?.value ?? null,
    status:                 purchase.status ?? payload.event.replace('PURCHASE_', ''),
    data_compra:            new Date(purchase.order_date),
    is_order_bump:          purchase.is_order_bump,
    offer_code:             purchase.offer?.code ?? null,
    purchase_type:          purchase.payment?.type ?? null,
    payload_raw:            payload.data,
  })

  // ── Order Bump ─────────────────────────────────────────────────────────
  const valorMaximoOB = await lerValorMaximoOB()
  await reclassificarComprasCliente(clienteId, valorMaximoOB)

  // ── Trilha de cadência ─────────────────────────────────────────────────
  await inscreverClienteNaTrilhaAutomaticamente(clienteId, produtoId)

  // Detecta se foi inscrito verificando existência na tabela
  const inscricaoTrilha = await queryOne<{ trilha_id: string }>(
    `SELECT trilha_id FROM clientes_trilha WHERE cliente_id = $1 AND trilha_id IN (
       SELECT id FROM trilhas_cadencia WHERE produto_entrada_id = $2
     ) LIMIT 1`,
    [clienteId, produtoId]
  )

  return {
    cliente: {
      id:              clienteId,
      email:           buyer.email,
      nome:            buyer.name,
      novo:            clienteNovo,
      telefone:        tel.formatado,
      telefone_valido: tel.valido,
    },
    produto: {
      id:   produtoId,
      nome: product.name,
      novo: produtoNovo,
    },
    compra: {
      id:          compraId,
      transaction: purchase.transaction,
      nova:        compraNova,
      valor:       purchase.price?.value ?? null,
    },
    trilha: {
      inscrito:  inscricaoTrilha !== null,
      trilha_id: inscricaoTrilha?.trilha_id,
    },
  }
}

// ── Helpers de log ─────────────────────────────────────────────────────────

async function salvarLog(evento: string, payload: unknown, processado: boolean, erro?: string): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO webhook_logs (evento, payload, processado, erro) VALUES ($1, $2, $3, $4)`,
      [evento, JSON.stringify(payload), processado, erro ?? null]
    )
  } catch (err) {
    console.error('[Webhook] Falha ao salvar log:', err)
  }
}

// ── POST /api/webhook/hotmart ──────────────────────────────────────────────

webhookRouter.post('/hotmart', async (req: Request, res: Response) => {
  // Responde 200 imediatamente — a Hotmart requer resposta rápida
  res.json({ success: true })

  const payload = req.body as HotmartPayload
  const event   = payload?.event

  if (!event || !payload?.data) {
    console.warn('[Webhook] Payload sem event ou data ignorado')
    await salvarLog('UNKNOWN', payload, false, 'Payload sem event ou data')
    return
  }

  console.log(`[Webhook] Evento recebido: ${event}`)

  if (!EVENTOS_COMPRA.includes(event)) {
    console.log(`[Webhook] Evento ${event} ignorado`)
    await salvarLog(event, payload, false, 'Evento não processado')
    return
  }

  try {
    const resultado = await processarWebhookPayload(payload)

    await salvarLog(event, payload, true)

    console.log(
      `[Webhook] Processado: ${resultado.cliente.email}` +
      ` | tel: ${resultado.cliente.telefone ?? 'sem tel'} (válido: ${resultado.cliente.telefone_valido})` +
      ` | produto: ${resultado.produto.nome}` +
      ` | tx: ${resultado.compra.transaction}` +
      ` | trilha: ${resultado.trilha.inscrito}`
    )
  } catch (err) {
    const mensagemErro = String(err)
    console.error('[Webhook] Erro ao processar payload:', err)
    await salvarLog(event, payload, false, mensagemErro)
  }
})

// ── POST /api/webhook/test ─────────────────────────────────────────────────
// Processa um payload simulado exatamente como o webhook real e retorna o resultado detalhado.
// Útil para validar a integração sem esperar um evento real da Hotmart.

webhookRouter.post('/test', async (req: Request, res: Response) => {
  try {
    const payload = req.body as HotmartPayload

    if (!payload?.event || !payload?.data) {
      return res.status(400).json({
        error: 'Payload inválido. Envie um objeto com "event" e "data".',
        exemplo: {
          event: 'PURCHASE_COMPLETE',
          data: {
            buyer:    { name: 'Fulano Teste', email: 'teste@exemplo.com', phone: '11999990000' },
            product:  { id: '12345', name: 'Produto Teste' },
            purchase: { transaction: 'TXN-TEST-001', price: { value: 97 }, order_date: Date.now(), status: 'COMPLETE' },
          },
        },
      })
    }

    if (!EVENTOS_COMPRA.includes(payload.event)) {
      return res.status(400).json({
        error: `Evento "${payload.event}" não é um evento de compra processável.`,
        eventos_validos: EVENTOS_COMPRA,
      })
    }

    const resultado = await processarWebhookPayload(payload)

    res.json({
      success: true,
      evento:  payload.event,
      resultado,
    })
  } catch (err) {
    console.error('[Webhook/test] Erro:', err)
    res.status(500).json({ error: String(err) })
  }
})

// ── GET /api/webhook/logs ──────────────────────────────────────────────────
// Retorna os últimos 20 eventos recebidos pelo webhook real.

webhookRouter.get('/logs', async (_req: Request, res: Response) => {
  try {
    const { rows } = await pool.query<{
      id:         string
      evento:     string
      payload:    unknown
      processado: boolean
      erro:       string | null
      created_at: string
    }>(
      `SELECT id, evento, payload, processado, erro, created_at
       FROM webhook_logs
       ORDER BY created_at DESC
       LIMIT 20`
    )
    res.json({ logs: rows })
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})
