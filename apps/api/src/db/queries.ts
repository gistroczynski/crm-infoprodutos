import { pool, query, queryOne } from './index'

// ── Tipos internos ─────────────────────────────────────────────────────────

export interface UpsertClienteData {
  hotmart_id: string
  nome: string
  email: string
  telefone_raw?: string | null
  telefone_formatado?: string | null
  telefone_valido?: boolean
}

export interface UpsertProdutoData {
  hotmart_id: string
  nome: string
  preco?: number | null
  tipo?: 'entrada' | 'order_bump' | 'upsell' | 'principal'
}

export interface UpsertCompraData {
  hotmart_transaction_id: string
  cliente_id: string
  produto_id: string
  valor?: number | null
  status: string
  data_compra: Date | string
  is_order_bump?: boolean
  motivo_classificacao?: string | null
  offer_code?: string | null
  purchase_type?: string | null
  payload_raw?: unknown
}

// ── Clientes ───────────────────────────────────────────────────────────────

export async function upsertCliente(dados: UpsertClienteData): Promise<{ id: string; novo: boolean }> {
  const resultado = await queryOne<{ id: string; xmax: string }>(`
    INSERT INTO clientes (hotmart_id, nome, email, telefone_raw, telefone_formatado, telefone_valido)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (email) DO UPDATE SET
      hotmart_id         = COALESCE(EXCLUDED.hotmart_id, clientes.hotmart_id),
      nome               = EXCLUDED.nome,
      telefone_raw       = COALESCE(EXCLUDED.telefone_raw, clientes.telefone_raw),
      telefone_formatado = COALESCE(EXCLUDED.telefone_formatado, clientes.telefone_formatado),
      telefone_valido    = COALESCE(EXCLUDED.telefone_valido, clientes.telefone_valido),
      updated_at         = NOW()
    RETURNING id, xmax::text
  `, [
    dados.hotmart_id,
    dados.nome,
    dados.email,
    dados.telefone_raw ?? null,
    dados.telefone_formatado ?? null,
    dados.telefone_valido ?? false,
  ])

  if (!resultado) throw new Error(`Falha ao upsert cliente: ${dados.email}`)
  return { id: resultado.id, novo: resultado.xmax === '0' }
}

export async function buscarTodosClientes() {
  return query(`
    SELECT
      c.*,
      COALESCE(ls.score, 0)            AS score,
      COALESCE(ls.prioridade, 'baixa') AS prioridade,
      COALESCE(sc.status, 'novo')      AS status,
      COUNT(co.id)::int                AS total_compras,
      MAX(co.data_compra)              AS ultima_compra
    FROM clientes c
    LEFT JOIN lead_scores ls   ON ls.cliente_id = c.id
    LEFT JOIN status_clientes sc ON sc.cliente_id = c.id
    LEFT JOIN compras co        ON co.cliente_id = c.id
    GROUP BY c.id, ls.score, ls.prioridade, sc.status
    ORDER BY c.created_at DESC
  `)
}

// ── Produtos ───────────────────────────────────────────────────────────────

export async function upsertProduto(dados: UpsertProdutoData): Promise<{ id: string; novo: boolean }> {
  const resultado = await queryOne<{ id: string; xmax: string }>(`
    INSERT INTO produtos (hotmart_id, nome, preco, tipo)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (hotmart_id) DO UPDATE SET
      nome  = EXCLUDED.nome,
      preco = COALESCE(EXCLUDED.preco, produtos.preco)
    RETURNING id, xmax::text
  `, [
    dados.hotmart_id,
    dados.nome,
    dados.preco ?? null,
    dados.tipo ?? 'entrada',
  ])

  if (!resultado) throw new Error(`Falha ao upsert produto: ${dados.hotmart_id}`)
  return { id: resultado.id, novo: resultado.xmax === '0' }
}

export async function buscarProdutoPorHotmartId(hotmartId: string) {
  return queryOne<{ id: string }>(`SELECT id FROM produtos WHERE hotmart_id = $1`, [hotmartId])
}

// ── Compras ────────────────────────────────────────────────────────────────

export async function upsertCompra(dados: UpsertCompraData): Promise<{ id: string; novo: boolean }> {
  const resultado = await queryOne<{ id: string; xmax: string }>(`
    INSERT INTO compras (
      hotmart_transaction_id, cliente_id, produto_id, valor, status, data_compra,
      is_order_bump, motivo_classificacao, offer_code, purchase_type, payload_raw
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    ON CONFLICT (hotmart_transaction_id) DO UPDATE SET
      status                = EXCLUDED.status,
      is_order_bump         = EXCLUDED.is_order_bump,
      motivo_classificacao  = COALESCE(EXCLUDED.motivo_classificacao, compras.motivo_classificacao),
      offer_code            = COALESCE(EXCLUDED.offer_code, compras.offer_code),
      purchase_type         = COALESCE(EXCLUDED.purchase_type, compras.purchase_type),
      payload_raw           = COALESCE(EXCLUDED.payload_raw, compras.payload_raw)
    RETURNING id, xmax::text
  `, [
    dados.hotmart_transaction_id,
    dados.cliente_id,
    dados.produto_id,
    dados.valor ?? null,
    dados.status,
    dados.data_compra,
    dados.is_order_bump ?? false,
    dados.motivo_classificacao ?? null,
    dados.offer_code ?? null,
    dados.purchase_type ?? null,
    dados.payload_raw ? JSON.stringify(dados.payload_raw) : null,
  ])

  if (!resultado) throw new Error(`Falha ao upsert compra: ${dados.hotmart_transaction_id}`)
  return { id: resultado.id, novo: resultado.xmax === '0' }
}

export async function buscarComprasDoCliente(clienteId: string) {
  return query(`
    SELECT co.*, p.nome AS produto_nome, p.tipo AS produto_tipo
    FROM compras co
    JOIN produtos p ON p.id = co.produto_id
    WHERE co.cliente_id = $1
    ORDER BY co.data_compra DESC
  `, [clienteId])
}

// ── Status de sincronização ────────────────────────────────────────────────

export async function buscarStatusSync() {
  const [clientes, compras, produtos] = await Promise.all([
    queryOne<{ total: number }>('SELECT COUNT(*)::int AS total FROM clientes'),
    queryOne<{ total: number }>('SELECT COUNT(*)::int AS total FROM compras'),
    queryOne<{ total: number }>('SELECT COUNT(*)::int AS total FROM produtos'),
  ])

  const ultima = await queryOne<{ valor: string }>(`
    SELECT valor FROM configuracoes WHERE chave = 'ultima_sync'
  `)

  return {
    ultima_sync: ultima?.valor ?? null,
    total_clientes: clientes?.total ?? 0,
    total_compras: compras?.total ?? 0,
    total_produtos: produtos?.total ?? 0,
  }
}

export async function buscarUltimaSync(): Promise<string | null> {
  const row = await queryOne<{ valor: string }>(
    `SELECT valor FROM configuracoes WHERE chave = 'ultima_sync'`
  )
  return row?.valor ?? null
}

export async function salvarUltimaSync(timestamp: string) {
  await pool.query(`
    INSERT INTO configuracoes (chave, valor, updated_at)
    VALUES ('ultima_sync', $1, NOW())
    ON CONFLICT (chave) DO UPDATE SET valor = $1, updated_at = NOW()
  `, [timestamp])
}
