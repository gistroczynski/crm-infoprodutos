// ── Enums ──────────────────────────────────────────────────────────────────

export type ProdutoTipo = 'entrada' | 'order_bump' | 'upsell' | 'principal'
export type Prioridade = 'alta' | 'media' | 'baixa'
export type StatusCliente = 'novo' | 'nutricao' | 'pronto' | 'inativo'
export type StatusContato = 'pendente' | 'contatado' | 'sem_resposta' | 'convertido'

// ── Entidades base ─────────────────────────────────────────────────────────

export interface Produto {
  id: string
  hotmart_id: string | null
  nome: string
  tipo: ProdutoTipo
  preco: number
  ativo: boolean
  created_at: string
}

export interface Cliente {
  id: string
  hotmart_id: string | null
  nome: string
  email: string
  telefone_raw: string | null
  telefone_formatado: string | null
  telefone_valido: boolean
  created_at: string
  updated_at: string
}

export interface Compra {
  id: string
  hotmart_transaction_id: string | null
  cliente_id: string
  produto_id: string
  valor: number
  status: string
  data_compra: string
  created_at: string
}

export interface LeadScore {
  id: string
  cliente_id: string
  score: number
  prioridade: Prioridade
  motivos: string[]
  updated_at: string
}

export interface StatusClienteRecord {
  id: string
  cliente_id: string
  status: StatusCliente
  updated_at: string
}

export interface RegrasPriorizacao {
  id: string
  nome: string
  descricao: string | null
  condicao_tipo: string
  condicao_valor: Record<string, unknown> | null
  pontos: number
  ativa: boolean
  ordem: number
}

export interface ListaDiaria {
  id: string
  data: string
  cliente_id: string
  prioridade: Prioridade
  score: number
  motivos: string[]
  status_contato: StatusContato
  contatado_em: string | null
  observacao: string | null
  created_at: string
}

export interface MensagemTemplate {
  id: string
  nome: string
  produto_id: string | null
  texto: string
  ativa: boolean
}

export interface Configuracao {
  chave: string
  valor: string | null
  updated_at: string
}

// ── DTOs de resposta enriquecida ───────────────────────────────────────────

export interface ClienteComScore extends Cliente {
  score: number
  prioridade: Prioridade
  motivos: string[]
  status: StatusCliente
  total_compras: number
  ultima_compra: string | null
}

export interface ListaDiariaComCliente extends ListaDiaria {
  cliente: Pick<Cliente, 'id' | 'nome' | 'email' | 'telefone_formatado'>
}

// ── Paginação ──────────────────────────────────────────────────────────────

export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  per_page: number
}

// ── API Response wrapper ───────────────────────────────────────────────────

export interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
}
