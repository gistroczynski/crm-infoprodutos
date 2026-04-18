import { hotmartService } from '../services/hotmart'
import {
  upsertCliente,
  upsertProduto,
  upsertCompra,
  buscarProdutoPorHotmartId,
  salvarUltimaSync,
  buscarUltimaSync,
} from '../db/queries'
import { reclassificarTodasCompras, lerValorMaximoOB } from '../services/classificarOrderBump'

export interface SyncResult {
  inicio: string
  fim: string
  duracao_ms: number
  modo: 'completo' | 'incremental'
  janela_desde: string
  produtos: { novos: number; atualizados: number }
  clientes: { novos: number; atualizados: number }
  compras: { novas: number; atualizadas: number }
  erros: string[]
}

// ── Processamento de vendas ────────────────────────────────────────────────

async function processarVendas(
  vendas: Awaited<ReturnType<typeof hotmartService.buscarVendas>>,
  resultado: SyncResult['produtos'] & { clientes: SyncResult['clientes']; compras: SyncResult['compras'] },
  erros: string[]
) {
  for (const venda of vendas) {
    try {
      const { cliente: clienteDados, produto: produtoDados, compra: compraDados } =
        hotmartService.mapearVenda(venda)

      // Upsert cliente
      const { id: clienteId, novo: clienteNovo } = await upsertCliente(clienteDados)
      if (clienteNovo) resultado.clientes.novos++
      else resultado.clientes.atualizados++

      // Resolve produto
      let produtoId: string
      const produtoExistente = await buscarProdutoPorHotmartId(produtoDados.hotmart_id)
      if (produtoExistente) {
        produtoId = produtoExistente.id
      } else {
        const { id, novo } = await upsertProduto(produtoDados)
        produtoId = id
        if (novo) resultado.novos++
        else resultado.atualizados++
      }

      // Upsert compra (inclui campos de order bump extraídos do payload)
      const { novo: compraNova } = await upsertCompra({
        ...compraDados,
        cliente_id: clienteId,
        produto_id: produtoId,
      })
      if (compraNova) resultado.compras.novas++
      else resultado.compras.atualizadas++

    } catch (err) {
      const msg = `Venda ${venda.purchase.transaction}: ${String(err)}`
      erros.push(msg)
      console.error('[Sync] Erro —', msg)
    }
  }
}

// ── Sync principal ─────────────────────────────────────────────────────────

export async function executarSync(forceFull = false): Promise<SyncResult> {
  const inicio = new Date()

  // Decide o modo: completo (histórico) ou incremental (desde última sync)
  const ultimaSync = await buscarUltimaSync()
  const modo: 'completo' | 'incremental' =
    forceFull || !ultimaSync ? 'completo' : 'incremental'

  // Para incremental, busca desde 2 dias antes da última sync (margem de segurança)
  // Para completo, busca desde jan/2023
  const desde = modo === 'incremental'
    ? new Date(new Date(ultimaSync!).getTime() - 2 * 24 * 60 * 60 * 1000)
    : new Date('2023-01-01T00:00:00Z')

  console.log(`\n[Sync] ▶ Iniciando sync ${modo.toUpperCase()} desde ${desde.toISOString().slice(0, 10)} — ${inicio.toISOString()}`)

  const erros: string[] = []
  const resultado = {
    novos: 0,
    atualizados: 0,
    clientes: { novos: 0, atualizados: 0 },
    compras: { novas: 0, atualizadas: 0 },
  }

  // ── 1. Produtos ────────────────────────────────────────────────────────

  console.log('[Sync] Sincronizando produtos...')
  try {
    const produtos = await hotmartService.buscarProdutos()
    for (const item of produtos) {
      try {
        const { novo } = await upsertProduto(hotmartService.mapearProduto(item))
        if (novo) resultado.novos++
        else resultado.atualizados++
      } catch (err) {
        const msg = `Produto ${item.id}: ${String(err)}`
        erros.push(msg)
        console.error('[Sync] Erro —', msg)
      }
    }
  } catch (err) {
    erros.push(`Falha ao buscar produtos: ${String(err)}`)
    console.error('[Sync] Erro —', erros[erros.length - 1])
  }

  console.log(`[Sync] Produtos — novos: ${resultado.novos}, atualizados: ${resultado.atualizados}`)

  // ── 2. Vendas (clientes + compras) por janelas mensais ─────────────────

  console.log(`[Sync] Sincronizando vendas (modo: ${modo})...`)
  try {
    const vendas = await hotmartService.buscarVendas(desde)
    await processarVendas(vendas, resultado, erros)
  } catch (err) {
    erros.push(`Falha ao buscar vendas: ${String(err)}`)
    console.error('[Sync] Erro —', erros[erros.length - 1])
  }

  console.log(`[Sync] Clientes — novos: ${resultado.clientes.novos}, atualizados: ${resultado.clientes.atualizados}`)
  console.log(`[Sync] Compras  — novas: ${resultado.compras.novas}, atualizadas: ${resultado.compras.atualizadas}`)

  // ── 3. Reclassifica order bumps ────────────────────────────────────────

  console.log('[Sync] Reclassificando order bumps...')
  try {
    const valorMaximoOB = await lerValorMaximoOB()
    const obResult = await reclassificarTodasCompras(valorMaximoOB)
    console.log(
      `[Sync] OB — marcadas: ${obResult.marcadas_ob}` +
      ` | offer_code: ${obResult.por_regra.offer_code}` +
      ` | co_compra: ${obResult.por_regra.co_compra}`
    )
  } catch (err) {
    erros.push(`Falha ao reclassificar order bumps: ${String(err)}`)
    console.error('[Sync] Erro —', erros[erros.length - 1])
  }

  // ── 4. Salva timestamp ─────────────────────────────────────────────────

  const fim = new Date()
  const duracao_ms = fim.getTime() - inicio.getTime()
  await salvarUltimaSync(fim.toISOString()).catch(console.error)

  const syncResult: SyncResult = {
    inicio: inicio.toISOString(),
    fim: fim.toISOString(),
    duracao_ms,
    modo,
    janela_desde: desde.toISOString().slice(0, 10),
    produtos: { novos: resultado.novos, atualizados: resultado.atualizados },
    clientes: resultado.clientes,
    compras: resultado.compras,
    erros,
  }

  console.log(
    `[Sync] ✔ Concluído em ${(duracao_ms / 1000).toFixed(1)}s` +
    ` | clientes: +${resultado.clientes.novos}` +
    ` | compras: +${resultado.compras.novas}` +
    (erros.length ? ` | ${erros.length} erro(s)` : '') + '\n'
  )

  return syncResult
}
