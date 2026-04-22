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
  encoding_detectado?: string
  separador_detectado?: string
}

export interface ResultadoImportacao {
  success: boolean
  total_linhas_csv: number
  emails_unicos_encontrados: number
  com_telefone: number
  sem_telefone_no_csv: number
  atualizados: number
  nao_encontrados: number
  erros: number
}

export const importarCsvApi = {
  template: () =>
    api.get('/api/clientes/importar-csv/template', { responseType: 'blob' }).then(r => r.data as Blob),

  preview: (arquivo: File) => {
    const form = new FormData()
    form.append('arquivo', arquivo)
    return api.post<PreviewCsv>('/api/clientes/importar-csv/preview', form).then(r => r.data)
  },

  importar: (arquivo: File, onUploadProgress?: (pct: number) => void) => {
    const form = new FormData()
    form.append('arquivo', arquivo)
    return api.post<ResultadoImportacao>('/api/clientes/importar-csv', form, {
      timeout: 120_000,
      onUploadProgress: e => {
        if (onUploadProgress && e.total) {
          onUploadProgress(Math.round((e.loaded / e.total) * 100))
        }
      },
    }).then(r => r.data)
  },
}

// ── Vendas ────────────────────────────────────────────────────────────────

export interface VendaItem {
  id: string
  transaction_id: string
  cliente_id: string
  cliente_nome: string
  cliente_email: string
  cliente_telefone: string | null
  produto_nome: string
  produto_tipo: string
  is_order_bump: boolean
  valor: number | null
  data_compra: string
  dias_atras: number
}

export interface ResumoVendas {
  total_vendas: number
  receita_total: number
  ticket_medio: number
  por_dia: { data: string; quantidade: number; receita: number }[]
}

export interface VendasListResponse {
  vendas: VendaItem[]
  total: number
  page: number
  limit: number
  total_pages: number
  resumo: ResumoVendas
}

export interface VendasHojeResponse {
  vendas: Omit<VendaItem, 'dias_atras'>[]
  total_hoje: number
  receita_hoje: number
  ticket_hoje: number
  top_produtos: { nome: string; quantidade: number; receita: number }[]
  comparacao_ontem: {
    total_ontem: number
    receita_ontem: number
    variacao_vendas_pct: number | null
    variacao_receita_pct: number | null
  }
}

export interface ResumoDiarioItem {
  data: string
  quantidade: number
  receita: number
  produtos: { nome: string; quantidade: number; receita: number }[]
}

export const syncApi = {
  manual: () =>
    api.post<{ success: boolean; message: string }>('/api/sync/manual').then(r => r.data),

  completo: (dias = 60) =>
    api.post<{ success: boolean; message: string; desde: string }>(
      '/api/sync/completo', { dias }
    ).then(r => r.data),

  status: () =>
    api.get<{ ultima_sync?: string | null; sync_em_andamento: boolean }>('/api/sync/status').then(r => r.data),

  recuperarPeriodo: (inicio: string, fim: string) =>
    api.post<{ success: boolean; message: string; periodo: { inicio: string; fim: string } }>(
      '/api/sync/recuperar-periodo', { inicio, fim }
    ).then(r => r.data),
}

// ── Tipos cadências ─────────────────────────────────────────────────────────

export interface ItemListaDiaCadencia {
  id: string
  cliente_id: string
  cliente_nome: string
  cliente_email: string
  cliente_telefone: string | null
  trilha_id: string
  trilha_nome: string
  trilha_cor: string
  produto_entrada: string
  etapa_atual: number
  total_etapas: number
  etapa_id: string
  nome_etapa: string
  dias_na_trilha: number
  mensagem_do_dia: string
  link_whatsapp: string | null
  status: string
}

export interface TrilhaCadencia {
  id: string
  nome: string
  descricao: string | null
  ativa: boolean
  cor: string
  produto_entrada: string | null
  produto_destino: string | null
  total_etapas: number
  clientes_ativos: number
  clientes_convertidos: number
  taxa_conversao: number
}

export interface EtapaCadencia {
  id: string
  trilha_id: string
  numero_etapa: number
  nome: string
  dia_envio: number
  mensagem_whatsapp: string
  objetivo: string | null
  ativa: boolean
  ordem: number
}

export const cadenciasApi = {
  listaDoDia: () =>
    api.get<{ success: boolean; total: number; itens: ItemListaDiaCadencia[] }>(
      '/api/cadencias/lista-do-dia'
    ).then(r => r.data),

  listaTrilhas: () =>
    api.get<{ success: boolean; trilhas: TrilhaCadencia[] }>('/api/cadencias/trilhas').then(r => r.data),

  getTrilha: (id: string) =>
    api.get<{ success: boolean; trilha: TrilhaCadencia; etapas: EtapaCadencia[] }>(
      `/api/cadencias/trilhas/${id}`
    ).then(r => r.data),

  atualizarEtapa: (id: string, dados: Partial<Pick<EtapaCadencia, 'nome' | 'mensagem_whatsapp' | 'objetivo'>>) =>
    api.put<{ success: boolean }>(`/api/cadencias/etapas/${id}`, dados).then(r => r.data),

  avancarEtapa: (clienteTrilhaId: string, statusContato: string, observacao?: string) =>
    api.patch<{ success: boolean; proximo_status: string; data_proxima_etapa: string | null }>(
      `/api/cadencias/clientes-trilha/${clienteTrilhaId}/avancar`,
      { status_contato: statusContato, observacao }
    ).then(r => r.data),

  inscrever: (cliente_id: string, trilha_id: string) =>
    api.post<{ success: boolean; id: string }>('/api/cadencias/clientes-trilha/inscrever', {
      cliente_id, trilha_id,
    }).then(r => r.data),

  metricas: () =>
    api.get<{
      success: boolean
      por_trilha: Array<{
        trilha_id: string; trilha_nome: string; trilha_cor: string
        total: number; ativos: number; convertidos: number; desistiram: number
        concluidos: number; taxa_conversao: number; tempo_medio_dias: number | null
      }>
      por_etapa: Array<{
        trilha_nome: string; etapa_numero: number; etapa_nome: string
        total_chegaram: number; convertidos: number; desistiram: number
      }>
    }>('/api/cadencias/metricas').then(r => r.data),
}

export const vendasApi = {
  list: (params?: {
    inicio?: string; fim?: string
    page?: number; limit?: number
    produto_id?: string; busca?: string
  }) =>
    api.get<VendasListResponse>('/api/vendas', { params }).then(r => r.data),

  hoje: () =>
    api.get<VendasHojeResponse>('/api/vendas/hoje').then(r => r.data),

  resumoDiario: (inicio: string, fim: string) =>
    api.get<ResumoDiarioItem[]>('/api/vendas/resumo-diario', { params: { inicio, fim } }).then(r => r.data),
}

export default api
