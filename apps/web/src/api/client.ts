import axios from 'axios'
import { incrementLoading, decrementLoading } from '../lib/loadingState'

const client = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:3001',
  headers: { 'Content-Type': 'application/json' },
})

client.interceptors.request.use(
  config  => { incrementLoading(); return config },
  error   => { decrementLoading(); return Promise.reject(error) },
)
client.interceptors.response.use(
  response => { decrementLoading(); return response },
  error    => { decrementLoading(); return Promise.reject(error) },
)

// ── Tipos do endpoint /api/lista/hoje ──────────────────────────────────────

export type Prioridade    = 'alta' | 'media' | 'baixa'
export type StatusCliente = 'novo' | 'nutricao' | 'pronto' | 'inativo'
export type StatusContato = 'pendente' | 'contatado' | 'sem_resposta' | 'nao_pertence' | 'convertido'

export interface ItemLista {
  id: string
  cliente_id: string
  nome: string
  email: string
  telefone_formatado: string | null
  produto_comprado: string | null
  data_compra: string | null
  dias_desde_compra: number | null
  status: StatusCliente
  prioridade: Prioridade
  score: number
  motivos: string[]
  link_whatsapp: string | null
  status_contato: StatusContato
  observacao: string | null
  contatado_em: string | null
  trilha_nome: string | null
  trilha_cor: string | null
  trilha_etapa: number | null
}

export interface ListaHojeResponse {
  data: string
  total: number
  alta: number
  media: number
  baixa: number
  itens: ItemLista[]
}

// ── Chamadas ───────────────────────────────────────────────────────────────

export const listaApi = {
  hoje: (prioridade?: Prioridade) =>
    client
      .get<ListaHojeResponse>('/api/lista/hoje', {
        params: prioridade ? { prioridade } : {},
      })
      .then(r => r.data),

  gerar: () =>
    client
      .post<{ success: boolean; total: number; alta: number; media: number; baixa: number }>(
        '/api/lista/gerar'
      )
      .then(r => r.data),

  atualizarContato: (id: string, status_contato: StatusContato, observacao?: string) =>
    client
      .patch(`/api/lista/${id}/contato`, { status_contato, observacao })
      .then(r => r.data),
}

export default client
