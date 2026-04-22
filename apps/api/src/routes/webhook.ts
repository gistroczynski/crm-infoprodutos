import { Router, Request, Response } from 'express'
import { pool } from '../db'
import { formatarTelefone } from '../services/hotmart'
import { upsertCliente, upsertProduto, upsertCompra, buscarProdutoPorHotmartId } from '../db/queries'
import { reclassificarComprasCliente, lerValorMaximoOB } from '../services/classificarOrderBump'
import { inscreverClienteNaTrilhaAutomaticamente } from '../services/cadencia'

export const webhookRouter = Router()

// ── POST /api/webhook/hotmart ──────────────────────────────────────────────
webhookRouter.post('/hotmart', async (req: Request, res: Response) => {
  // Responde 200 imediatamente — a Hotmart requer resposta rápida
  res.json({ success: true })

  try {
    const payload = req.body
    const event   = payload?.event as string | undefined

    if (!event || !payload?.data) {
      console.warn('[Webhook] Payload sem event ou data ignorado')
      return
    }

    console.log(`[Webhook] Evento recebido: ${event}`)

    // Só processa eventos de compra
    const eventosCompra = [
      'PURCHASE_COMPLETE',
      'PURCHASE_APPROVED',
      'PURCHASE_BILLET_PRINTED',
    ]
    if (!eventosCompra.includes(event)) {
      console.log(`[Webhook] Evento ${event} ignorado`)
      return
    }

    const { buyer, product, purchase } = payload.data as {
      buyer:    { name: string; email: string; phone?: string }
      product:  { id: string | number; name: string }
      purchase: {
        transaction: string
        price?: { value: number }
        order_date: number
        status?: string
        is_order_bump?: boolean
        offer?: { code?: string }
        payment?: { type?: string }
      }
    }

    if (!buyer?.email) {
      console.warn('[Webhook] buyer.email ausente — ignorado')
      return
    }

    // ── Telefone ─────────────────────────────────────────────────────────
    const tel = buyer.phone
      ? formatarTelefone(buyer.phone)
      : { formatado: null, valido: false }

    // ── Upsert cliente (chave: email) ─────────────────────────────────────
    const { id: clienteId } = await upsertCliente({
      hotmart_id:         buyer.email,
      nome:               buyer.name,
      email:              buyer.email,
      telefone_raw:       buyer.phone ?? null,
      telefone_formatado: tel.formatado,
      telefone_valido:    tel.valido,
    })

    // ── Produto ───────────────────────────────────────────────────────────
    const hotmartProdutoId = String(product.id)
    let produtoId: string
    const produtoExistente = await buscarProdutoPorHotmartId(hotmartProdutoId)

    if (produtoExistente) {
      produtoId = produtoExistente.id
    } else {
      const { id } = await upsertProduto({ hotmart_id: hotmartProdutoId, nome: product.name })
      produtoId = id
    }

    // ── Compra ────────────────────────────────────────────────────────────
    await upsertCompra({
      hotmart_transaction_id: purchase.transaction,
      cliente_id:             clienteId,
      produto_id:             produtoId,
      valor:                  purchase.price?.value ?? null,
      status:                 purchase.status ?? event.replace('PURCHASE_', ''),
      data_compra:            new Date(purchase.order_date),
      is_order_bump:          purchase.is_order_bump,
      offer_code:             purchase.offer?.code ?? null,
      purchase_type:          purchase.payment?.type ?? null,
      payload_raw:            payload.data,
    })

    // Reclassifica compras recentes do cliente para atualizar co-compras
    try {
      const valorMaximoOB = await lerValorMaximoOB()
      await reclassificarComprasCliente(clienteId, valorMaximoOB)
    } catch (err) {
      console.error('[Webhook] Erro ao reclassificar order bumps:', err)
    }

    // Inscreve na trilha de cadência correspondente ao produto
    try {
      await inscreverClienteNaTrilhaAutomaticamente(clienteId, produtoId)
    } catch (err) {
      console.error('[Webhook] Erro ao inscrever cliente na trilha:', err)
    }

    console.log(
      `[Webhook] Processado: ${buyer.email}` +
      ` | tel: ${tel.formatado ?? 'sem tel'} (válido: ${tel.valido})` +
      ` | produto: ${product.name}` +
      ` | tx: ${purchase.transaction}` +
      ` | is_ob: ${purchase.is_order_bump ?? 'n/a'}`
    )
  } catch (err) {
    console.error('[Webhook] Erro ao processar payload:', err)
  }
})
