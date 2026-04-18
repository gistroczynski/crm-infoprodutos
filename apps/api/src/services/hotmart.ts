import dotenv from 'dotenv'
dotenv.config()

// ── Tipos da API Hotmart ───────────────────────────────────────────────────

interface HotmartToken {
  access_token: string
  expires_at: number // timestamp ms
}

interface HotmartProduct {
  id: string
  name: string
  price?: { value: number }
}

export interface HotmartSaleItem {
  buyer: {
    ucode: string
    name: string
    email: string
    phone?: string
  }
  product: {
    id: number
    name: string
    ucode?: string
  }
  producer?: {
    ucode?: string
    name?: string
  }
  affiliates?: Array<{ ucode?: string; name?: string }>
  purchase: {
    transaction: string
    status: string
    order_date: number        // epoch ms
    approved_date?: number
    price?: { value: number; currency_code: string }
    full_price?: { value: number; currency_code: string }
    original_offer_price?: { value: number; currency_code: string }
    // ── Order bump & oferta ────────────────────────────────────────────────
    is_order_bump?: boolean
    offer?: { code?: string; payment_mode?: string }
    payment?: { type?: string; installments_number?: number; refusal_reason?: string }
    hotmart_fee?: { total?: number; base?: number; percentage?: number; currency_code?: string }
    commission_as?: string
    purchase_subscription?: unknown
    recurrency_number?: number
    date_next_charge?: number
  }
}

interface HotmartSalesPage {
  items: HotmartSaleItem[]
  page_info?: {
    total_results?: number
    next_page_token?: string
    results_per_page?: number
  }
}

// ── Formatação de telefone ─────────────────────────────────────────────────

export function formatarTelefone(telefoneRaw: string): { formatado: string; valido: boolean } {
  // Remove tudo que não é dígito
  const digits = telefoneRaw.replace(/\D/g, '')

  let numero = digits

  if (digits.startsWith('55') && digits.length >= 12 && digits.length <= 13) {
    // Já está no formato correto com DDI 55
    numero = digits
  } else if (digits.length >= 10 && digits.length <= 11) {
    // Tem DDD + número, adiciona DDI Brasil
    numero = '55' + digits
  } else if (digits.length >= 8 && digits.length <= 9) {
    // Só o número, assume DDI 55 + DDD 11 (SP)
    numero = '5511' + digits
  }

  const valido = numero.length >= 12 && numero.length <= 13

  return { formatado: numero, valido }
}

// ── Cliente HTTP com retry ─────────────────────────────────────────────────

const BASE_URL      = process.env.HOTMART_BASE_URL  ?? 'https://developers.hotmart.com'
const AUTH_BASE_URL = process.env.HOTMART_AUTH_URL  ?? 'https://api-sec-vlc.hotmart.com'

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  tentativas = 3
): Promise<Response> {
  for (let i = 0; i < tentativas; i++) {
    const res = await fetch(url, options)

    if (res.status === 429) {
      console.warn(`[Hotmart] Rate limit atingido. Aguardando 5s... (tentativa ${i + 1}/${tentativas})`)
      await sleep(5000)
      continue
    }

    return res
  }
  throw new Error(`[Hotmart] Rate limit persistente após ${tentativas} tentativas: ${url}`)
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ── Serviço Hotmart ────────────────────────────────────────────────────────

export class HotmartService {
  private token: HotmartToken | null = null
  private clientId: string
  private clientSecret: string

  constructor() {
    this.clientId = process.env.HOTMART_CLIENT_ID ?? ''
    this.clientSecret = process.env.HOTMART_CLIENT_SECRET ?? ''

    if (!this.clientId || !this.clientSecret) {
      console.warn('[Hotmart] HOTMART_CLIENT_ID ou HOTMART_CLIENT_SECRET não configurados.')
    }
  }

  // ── Autenticação OAuth2 ──────────────────────────────────────────────────

  private async autenticar(): Promise<string> {
    const agora = Date.now()

    // Usa token cacheado se ainda válido (com margem de 60s)
    if (this.token && this.token.expires_at > agora + 60_000) {
      return this.token.access_token
    }

    console.log('[Hotmart] Obtendo novo token OAuth2...')

    const credentials = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')

    const res = await fetchWithRetry(
      `${AUTH_BASE_URL}/security/oauth/token`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
      }
    )

    if (!res.ok) {
      const txt = await res.text()
      throw new Error(`[Hotmart] Falha na autenticação (${res.status}): ${txt}`)
    }

    const data = await res.json() as { access_token: string; expires_in: number }
    this.token = {
      access_token: data.access_token,
      expires_at: agora + data.expires_in * 1000,
    }

    console.log(`[Hotmart] Token obtido. Expira em ${data.expires_in}s.`)
    return this.token.access_token
  }

  // ── GET autenticado com retry em 401 ────────────────────────────────────

  private async get<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
    const token = await this.autenticar()

    const url = new URL(`${BASE_URL}${path}`)
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, String(v))
    }

    const fazerRequisicao = async (accessToken: string): Promise<Response> => {
      return fetchWithRetry(url.toString(), {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      })
    }

    let res = await fazerRequisicao(token)

    // Se 401, força renovação do token e tenta uma vez mais
    if (res.status === 401) {
      console.warn('[Hotmart] Token expirado (401). Renovando...')
      this.token = null
      const novoToken = await this.autenticar()
      res = await fazerRequisicao(novoToken)
    }

    const responseText = await res.text()

    if (!res.ok) {
      throw new Error(`[Hotmart] Erro na requisição GET ${path} (${res.status}): ${responseText}`)
    }

    return JSON.parse(responseText) as T
  }

  // ── Produtos ─────────────────────────────────────────────────────────────

  async buscarProdutos(): Promise<HotmartProduct[]> {
    console.log('[Hotmart] Buscando produtos...')

    try {
      const data = await this.get<{ items: HotmartProduct[] }>(
        '/products/api/v1/products'
      )
      return data.items ?? []
    } catch (err) {
      console.error('[Hotmart] Erro ao buscar produtos:', err)
      return []
    }
  }

  // ── Vendas paginadas ──────────────────────────────────────────────────────

  /**
   * Busca vendas de uma janela específica (paginado por page_token).
   * A API Hotmart exige start_date/end_date — sem eles retorna apenas ~30 dias.
   */
  async buscarVendasPorJanela(
    startMs: number,
    endMs: number,
    label: string
  ): Promise<HotmartSaleItem[]> {
    const itens: HotmartSaleItem[] = []
    let proximaPagina: string | undefined
    let pagina = 1

    do {
      const params: Record<string, string | number> = {
        max_results: 50,
        transaction_status: 'COMPLETE',
        start_date: startMs,
        end_date: endMs,
      }
      if (proximaPagina) params['page_token'] = proximaPagina

      const data = await this.get<HotmartSalesPage>(
        '/payments/api/v1/sales/history',
        params
      )

      const novos = data.items ?? []
      itens.push(...novos)
      proximaPagina = data.page_info?.next_page_token

      console.log(
        `[Hotmart] ${label} — pág ${pagina}: ${novos.length} itens | acumulado: ${itens.length}/${data.page_info?.total_results ?? '?'}`
      )

      pagina++
      if (proximaPagina) await sleep(300)
    } while (proximaPagina)

    return itens
  }

  /**
   * Busca TODAS as vendas desde startDate até hoje, quebrando em janelas mensais.
   * Necessário porque a API limita o período retornado por requisição.
   */
  async buscarVendas(desde?: Date): Promise<HotmartSaleItem[]> {
    // Por padrão, busca desde jan/2023 (início típico de operação)
    const inicio = desde ?? new Date('2023-01-01T00:00:00Z')
    const hoje   = new Date()

    // Gera janelas mensais
    const janelas: Array<{ start: number; end: number; label: string }> = []
    const cursor = new Date(inicio)
    cursor.setUTCDate(1)
    cursor.setUTCHours(0, 0, 0, 0)

    while (cursor <= hoje) {
      const start = cursor.getTime()
      const fim   = new Date(cursor)
      fim.setUTCMonth(fim.getUTCMonth() + 1)
      fim.setUTCDate(0)   // último dia do mês
      fim.setUTCHours(23, 59, 59, 999)
      const end  = Math.min(fim.getTime(), hoje.getTime())
      const label = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`

      janelas.push({ start, end, label })
      cursor.setUTCMonth(cursor.getUTCMonth() + 1)
    }

    console.log(`[Hotmart] Buscando vendas em ${janelas.length} janelas mensais (${janelas[0].label} → ${janelas[janelas.length - 1].label})`)

    const todas: HotmartSaleItem[] = []
    for (const janela of janelas) {
      try {
        const itens = await this.buscarVendasPorJanela(janela.start, janela.end, janela.label)
        todas.push(...itens)
        // Pausa entre janelas para não pressionar o rate limit
        await sleep(500)
      } catch (err) {
        console.error(`[Hotmart] Erro na janela ${janela.label}:`, err)
      }
    }

    console.log(`[Hotmart] Total geral de vendas obtidas: ${todas.length}`)
    return todas
  }

  // ── Busca transações RAW sem filtro de status (para inspeção de campos) ──

  async buscarTransacoesRaw(max_results = 5): Promise<{
    status: number; url: string; items: HotmartSaleItem[]; page_info: unknown
  }> {
    const token = await this.autenticar()
    const url = new URL(`${BASE_URL}/payments/api/v1/sales/history`)
    url.searchParams.set('max_results', String(max_results))
    // SEM transaction_status — para ver todos os campos em qualquer transação recente

    const res = await fetchWithRetry(url.toString(), {
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    })
    const text = await res.text()
    const body = JSON.parse(text) as { items?: HotmartSaleItem[]; page_info?: unknown }
    return {
      status:    res.status,
      url:       url.toString(),
      items:     body.items ?? [],
      page_info: body.page_info ?? null,
    }
  }

  // ── Busca detalhe de uma transação específica ───────────────────────────���──

  async buscarDetalheTransacao(transactionId: string): Promise<{
    status: number; url: string; body: unknown
  }> {
    // Tenta os dois path patterns conhecidos da Hotmart
    const caminhos = [
      '/payments/api/v1/sales/history',
      '/payments/rest/v1/sales/history',
    ]
    for (const path of caminhos) {
      try {
        const result = await this.rawRequest(path, { transaction: transactionId, max_results: 1 })
        const body = result.body as { items?: unknown[] }
        if (result.status < 400 && Array.isArray(body?.items) && body.items.length > 0) {
          return { status: result.status, url: result.url, body: result.body }
        }
        if (result.status < 400) {
          return { status: result.status, url: result.url, body: result.body }
        }
      } catch {
        // tenta próximo path
      }
    }
    return { status: 404, url: '', body: { error: 'Transação não encontrada em nenhum endpoint' } }
  }

  // ── Busca ofertas de um produto ────────────────────────────────────────────

  async buscarOfertasProduto(hotmartProductId: string): Promise<{
    status: number; url: string; body: unknown
  }> {
    const caminhos = [
      `/products/rest/v1/products/${hotmartProductId}/offers`,
      `/products/api/v1/products/${hotmartProductId}/offers`,
    ]
    for (const path of caminhos) {
      try {
        const result = await this.rawRequest(path)
        if (result.status < 500) {
          return { status: result.status, url: result.url, body: result.body }
        }
      } catch {
        // tenta próximo path
      }
    }
    return { status: 404, url: '', body: { error: 'Ofertas não encontradas' } }
  }

  // ── Debug: testa autenticação ─────────────────────────────────────────────

  async debugToken(): Promise<{ success: boolean; token_preview: string; expires_em_segundos?: number; erro?: string }> {
    try {
      this.token = null // força renovação
      const token = await this.autenticar()
      const t = this.token as HotmartToken | null
      const expires_em_segundos = t ? Math.floor((t.expires_at - Date.now()) / 1000) : null
      return {
        success: true,
        token_preview: token.slice(0, 30) + '...',
        ...(expires_em_segundos !== null ? { expires_em_segundos } : {}),
      }
    } catch (err) {
      return { success: false, token_preview: '', erro: String(err) }
    }
  }

  // ── Debug: requisição bruta ───────────────────────────────────────────────

  async rawRequest(path: string, params: Record<string, string | number> = {}): Promise<{
    status: number
    url: string
    body: unknown
    token_preview: string
  }> {
    const token = await this.autenticar()

    const url = new URL(`${BASE_URL}${path}`)
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, String(v))
    }

    const res = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    })

    const text = await res.text()
    let body: unknown
    try {
      body = JSON.parse(text)
    } catch {
      body = text
    }

    return {
      status: res.status,
      url: url.toString(),
      body,
      token_preview: token.slice(0, 20) + '...',
    }
  }

  // ── Mappers ───────────────────────────────────────────────────────────────

  mapearProduto(item: HotmartProduct) {
    return {
      hotmart_id: String(item.id),
      nome: item.name,
      preco: item.price?.value ?? null,
    }
  }

  mapearVenda(item: HotmartSaleItem) {
    const tel = item.buyer.phone
      ? formatarTelefone(item.buyer.phone)
      : { formatado: null, valido: false }

    return {
      cliente: {
        hotmart_id: item.buyer.ucode,
        nome: item.buyer.name,
        email: item.buyer.email,
        telefone_raw: item.buyer.phone ?? null,
        telefone_formatado: tel.formatado,
        telefone_valido: tel.valido,
      },
      produto: {
        hotmart_id: String(item.product.id),
        nome: item.product.name,
      },
      compra: {
        hotmart_transaction_id: item.purchase.transaction,
        valor:         item.purchase.price?.value ?? null,
        status:        item.purchase.status,
        data_compra:   new Date(item.purchase.order_date),
        is_order_bump: item.purchase.is_order_bump ?? false,
        offer_code:    item.purchase.offer?.code ?? null,
        purchase_type: item.purchase.payment?.type ?? null,
        payload_raw:   item,
      },
    }
  }
}

export const hotmartService = new HotmartService()
