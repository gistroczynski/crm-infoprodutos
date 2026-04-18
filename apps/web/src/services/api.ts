import axios from 'axios'
import { incrementLoading, decrementLoading } from '../lib/loadingState'
import type {
  ClienteComScore,
  ListaDiariaComCliente,
  Produto,
  Configuracao,
  PaginatedResponse,
} from '@crm/shared'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:3001',
})

api.interceptors.request.use(
  config  => { incrementLoading(); return config },
  error   => { decrementLoading(); return Promise.reject(error) },
)
api.interceptors.response.use(
  response => { decrementLoading(); return response },
  error    => { decrementLoading(); return Promise.reject(error) },
)

// ── Clientes ──────────────────────────────────────────────────────────────

export interface ClienteListItem {
  id: string; nome: string; email: string
  telefone_formatado: string | null; telefone_valido: boolean
  score: number; prioridade: string; status: string
  total_compras: number; total_gasto: number
  ultima_compra: string | null; dias_desde_ultima_compra: number | null
  ultimo_produto: string | null
}

export interface ClientesListResponse {
  clientes: ClienteListItem[]
  total: number; page: number; limit: number; total_pages: number
}

export interface ClienteCompra {
  id: string; produto_nome: string; produto_tipo: string
  is_order_bump: boolean; valor: number | null; data_compra: string; dias_atras: number
}

export interface ClientePerfil {
  cliente: {
    id: string; nome: string; email: string
    telefone_formatado: string | null; telefone_valido: boolean; created_at: string
  }
  score: { score: number; prioridade: string; motivos: string[]; updated_at: string | null }
  status: string
  compras: ClienteCompra[]
  resumo: {
    total_gasto: number
    quantidade_compras: number
    dias_desde_primeira_compra: number | null
    dias_desde_ultima_compra: number | null
    tem_produto_upsell: boolean
    proximo_passo_sugerido: string
  }
}

export const clientesApi = {
  list: (params?: { page?: number; limit?: number; search?: string; status?: string; prioridade?: string }) =>
    api.get<ClientesListResponse>('/api/clientes', { params }).then(r => r.data),

  getPerfil: (id: string) =>
    api.get<ClientePerfil>(`/api/clientes/${id}`).then(r => r.data),

  update: (id: string, data: Partial<ClienteComScore>) =>
    api.patch<ClienteComScore>(`/api/clientes/${id}`, data).then(r => r.data),
}

// ── Lista Diária ──────────────────────────────────────────────────────────
export const listaDiariaApi = {
  list: (data?: string) =>
    api.get<ListaDiariaComCliente[]>('/api/lista-diaria', { params: { data } }).then(r => r.data),

  gerar: () =>
    api.post<{ message: string; data: string; total: number }>('/api/lista-diaria/gerar').then(r => r.data),

  atualizarContato: (id: string, payload: { status_contato: string; observacao?: string }) =>
    api.patch(`/api/lista-diaria/${id}/contato`, payload).then(r => r.data),
}

// ── Produtos ──────────────────────────────────────────────────────────────
export const produtosApi = {
  list: () =>
    api.get<Produto[]>('/api/produtos').then(r => r.data),
}

// ── Dashboard ─────────────────────────────────────────────────────────────

export interface DashboardResumo {
  faturamento_total: number
  faturamento_mes_atual: number
  ticket_medio: number
  total_clientes: number
  clientes_com_principal: number
  taxa_ascensao: number
  total_compras: number
  receita_por_produto: { produto_id: string; nome: string; tipo: string; total_vendas: number; receita: number }[]
}

export interface DashboardFunil {
  entrada:    { total_clientes: number; receita: number }
  order_bump: { total_clientes: number; receita: number; taxa_conversao_de_entrada: number }
  upsell:     { total_clientes: number; receita: number; taxa_conversao_de_entrada: number }
}

export interface EvolucaoDia {
  data: string
  receita: number
  novas_compras: number
}

export const dashboardApi = {
  resumo:   (inicio: string, fim: string) =>
    api.get<DashboardResumo>('/api/dashboard/resumo', { params: { inicio, fim } }).then(r => r.data),
  funil:    (inicio: string, fim: string) =>
    api.get<DashboardFunil>('/api/dashboard/funil', { params: { inicio, fim } }).then(r => r.data),
  evolucao: (inicio: string, fim: string) =>
    api.get<EvolucaoDia[]>('/api/dashboard/evolucao', { params: { inicio, fim } }).then(r => r.data),
}

// ── Relatórios ────────────────────────────────────────────────────────────

export interface RelatorioAscensao {
  total_clientes_periodo: number
  novos_ascendidos: number
  taxa_ascensao: number
  tempo_medio_ascensao_dias: number
  ascensoes_por_semana: { semana: string; quantidade: number }[]
}

export interface RelatorioFunil {
  por_etapa: {
    etapa: string; total_clientes: number; receita: number; taxa_para_proxima: number | null
  }[]
}

export interface RelatorioPerformanceLista {
  total_contatos_realizados: number
  total_convertidos: number
  taxa_conversao: number
  por_prioridade: Record<string, { contatos: number; convertidos: number; taxa: number }>
  por_dia: { data: string; contatos: number; convertidos: number }[]
}

export interface RelatorioProdutos {
  produtos: {
    produto_id: string; nome: string; tipo: string
    total_vendas: number; receita: number; ticket_medio: number
    novos_clientes: number; percentual_receita: number
  }[]
}

export const relatoriosApi = {
  ascensao: (inicio: string, fim: string) =>
    api.get<RelatorioAscensao>('/api/relatorios/ascensao', { params: { inicio, fim } }).then(r => r.data),
  funil: (inicio: string, fim: string) =>
    api.get<RelatorioFunil>('/api/relatorios/funil', { params: { inicio, fim } }).then(r => r.data),
  performanceLista: (inicio: string, fim: string) =>
    api.get<RelatorioPerformanceLista>('/api/relatorios/performance-lista', { params: { inicio, fim } }).then(r => r.data),
  produtos: (inicio: string, fim: string) =>
    api.get<RelatorioProdutos>('/api/relatorios/produtos', { params: { inicio, fim } }).then(r => r.data),
}

// ── Configurações ─────────────────────────────────────────────────────────
export const configuracoesApi = {
  list: () =>
    api.get<Configuracao[]>('/api/configuracoes').then(r => r.data),

  save: (chave: string, valor: string) =>
    api.put<Configuracao>(`/api/configuracoes/${chave}`, { valor }).then(r => r.data),
}

// ── Importação CSV ────────────────────────────────────────────────────────
export interface PreviewCsv {
  total_linhas: number
  colunas_detectadas: { email: string | null; telefone: string | null }
  preview: Record<string, string>[]
  cabecalhos: string[]
}

export interface ResultadoImportacao {
  success: boolean
  total_linhas: number
  atualizados: number
  nao_encontrados: string[]
  erros: string[]
}

export const importarCsvApi = {
  template: () =>
    api.get('/api/clientes/importar-csv/template', { responseType: 'blob' }).then(r => r.data as Blob),

  preview: (arquivo: File) => {
    const form = new FormData()
    form.append('arquivo', arquivo)
    return api.post<PreviewCsv>('/api/clientes/importar-csv/preview', form).then(r => r.data)
  },

  importar: (arquivo: File) => {
    const form = new FormData()
    form.append('arquivo', arquivo)
    return api.post<ResultadoImportacao>('/api/clientes/importar-csv', form).then(r => r.data)
  },
}

export default api
