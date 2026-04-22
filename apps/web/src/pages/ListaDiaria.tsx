import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useListaDiaria } from '../hooks/useListaDiaria'
import { useToast } from '../hooks/useToast'
import PrioridadeBadge from '../components/PrioridadeBadge'
import StatusBadge from '../components/StatusBadge'
import WhatsAppButton from '../components/WhatsAppButton'
import SkeletonRow from '../components/SkeletonRow'
import ModalConfirmacao from '../components/ModalConfirmacao'
import type { Prioridade, StatusContato } from '../api/client'

// ── Utilitários ───────────────────────────────────────────────────────────

function formatarDataPtBR(iso: string): string {
  return new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function tempoRelativo(dias: number | null): string {
  if (dias === null) return '—'
  if (dias === 0) return 'Hoje'
  if (dias === 1) return 'Ontem'
  if (dias < 7)   return `${dias} dias`
  if (dias < 14)  return '1 semana'
  if (dias < 30)  return `${Math.floor(dias / 7)} semanas`
  if (dias < 60)  return '1 mês'
  if (dias < 365) return `${Math.floor(dias / 30)} meses`
  return `${Math.floor(dias / 365)} ano${Math.floor(dias / 365) > 1 ? 's' : ''}`
}

function scoreColor(score: number): string {
  if (score >= 70) return 'bg-emerald-500'
  if (score >= 40) return 'bg-amber-400'
  return 'bg-red-400'
}

const CONCLUIDOS: StatusContato[] = ['contatado', 'convertido', 'nao_pertence']

// ── Tabs de filtro ────────────────────────────────────────────────────────

const TABS: { label: string; value: Prioridade | 'todos'; cor: string; corAtiva: string }[] = [
  { value: 'todos', label: 'Todos',  cor: 'text-gray-600',  corAtiva: 'border-gray-800 text-gray-900' },
  { value: 'alta',  label: 'Alta',   cor: 'text-red-400',   corAtiva: 'border-red-500 text-red-600'   },
  { value: 'media', label: 'Média',  cor: 'text-amber-500', corAtiva: 'border-amber-500 text-amber-600'},
  { value: 'baixa', label: 'Baixa',  cor: 'text-gray-400',  corAtiva: 'border-gray-400 text-gray-600' },
]

// ── Componente principal ──────────────────────────────────────────────────

export default function ListaDiaria() {
  const navigate = useNavigate()
  const toast    = useToast()
  const {
    dados,
    itens,
    loading,
    gerando,
    error,
    filtro,
    setFiltro,
    pendentes,
    atualizarStatus,
    gerarLista,
  } = useListaDiaria()

  const [modalAberto, setModalAberto] = useState(false)

  const dataFormatada = dados?.data
    ? formatarDataPtBR(dados.data)
    : formatarDataPtBR(new Date().toISOString().slice(0, 10))

  async function copiarTelefone(tel: string) {
    try {
      await navigator.clipboard.writeText(tel)
      toast.success('Telefone copiado!')
    } catch {
      toast.error('Não foi possível copiar o telefone.')
    }
  }

  async function confirmarGerar() {
    setModalAberto(false)
    await gerarLista()
    toast.success('Lista regenerada com sucesso!')
  }

  return (
    <div className="flex flex-col h-full">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="mb-5">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          {/* Título + badge */}
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">Lista de hoje</h1>
              {pendentes > 0 && (
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-red-500 text-white">
                  {pendentes} pendente{pendentes !== 1 ? 's' : ''}
                </span>
              )}
            </div>
            <p className="text-sm text-gray-500 mt-0.5 capitalize">{dataFormatada}</p>
          </div>

          {/* Botão atualizar */}
          <button
            onClick={() => setModalAberto(true)}
            disabled={gerando || loading}
            className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors self-start"
          >
            {gerando ? (
              <>
                <span className="inline-block w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Gerando...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Atualizar lista
              </>
            )}
          </button>
        </div>

        {/* Contador em tempo real */}
        {!loading && dados && (
          <div className="mt-3 flex items-center gap-4">
            <p className="text-sm text-gray-600">
              <span className="font-semibold text-gray-900">{pendentes}</span> contatos restantes hoje
            </p>
            <div className="flex items-center gap-3 text-xs text-gray-400">
              <span>
                <span className="inline-block w-2 h-2 rounded-full bg-red-400 mr-1" />
                {dados.alta} alta
              </span>
              <span>
                <span className="inline-block w-2 h-2 rounded-full bg-amber-400 mr-1" />
                {dados.media} média
              </span>
              <span>
                <span className="inline-block w-2 h-2 rounded-full bg-gray-300 mr-1" />
                {dados.baixa} baixa
              </span>
            </div>
          </div>
        )}
      </div>

      {/* ── Erro ───────────────────────────────────────────────────────── */}
      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      {/* ── Tabs ───────────────────────────────────────────────────────── */}
      <div className="flex border-b border-gray-200 mb-0">
        {TABS.map(tab => (
          <button
            key={tab.value}
            onClick={() => setFiltro(tab.value)}
            className={[
              'px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
              filtro === tab.value
                ? `${tab.corAtiva} border-current`
                : `${tab.cor} border-transparent hover:text-gray-700`,
            ].join(' ')}
          >
            {tab.label}
            {!loading && dados && tab.value !== 'todos' && (
              <span className="ml-1.5 text-xs opacity-60">
                ({dados[tab.value as Prioridade]})
              </span>
            )}
            {!loading && dados && tab.value === 'todos' && (
              <span className="ml-1.5 text-xs opacity-60">({dados.total})</span>
            )}
          </button>
        ))}
      </div>

      {/* ── Tabela ─────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-x-auto bg-white rounded-b-xl border border-t-0 border-gray-200">
        <table className="w-full text-sm min-w-[780px]">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="text-left px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wide">Nome</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wide">Produto</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wide">Trilha</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wide">Comprou há</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wide">Status</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wide">Prioridade</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wide w-24">Score</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wide">Ação</th>
            </tr>
          </thead>

          <tbody>
            {/* Skeleton */}
            {loading && Array.from({ length: 8 }).map((_, i) => (
              <SkeletonRow key={i} />
            ))}

            {/* Dados */}
            {!loading && itens.map((item, idx) => {
              const concluido = CONCLUIDOS.includes(item.status_contato)

              return (
                <tr
                  key={item.id}
                  onClick={() => navigate(`/clientes/${item.cliente_id}`)}
                  className={[
                    'border-b border-gray-50 transition-colors group cursor-pointer',
                    idx % 2 === 1 ? 'bg-gray-50/50' : 'bg-white',
                    concluido ? 'opacity-40' : 'hover:bg-blue-50/40',
                  ].join(' ')}
                >
                  {/* Nome */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="min-w-0">
                        <p className={`font-semibold text-gray-900 ${concluido ? 'line-through' : ''}`}>
                          {item.nome}
                        </p>
                        <p className="text-xs text-gray-400 mt-0.5">{item.email}</p>
                        {item.motivos.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {item.motivos.slice(0, 2).map(m => (
                              <span key={m} className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">
                                {m}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Botão copiar telefone */}
                      {item.telefone_formatado && (
                        <button
                          title={item.telefone_formatado}
                          onClick={e => { e.stopPropagation(); copiarTelefone(item.telefone_formatado!) }}
                          className="flex-shrink-0 p-1 rounded text-gray-300 hover:text-primary-500 hover:bg-primary-50 transition-colors opacity-0 group-hover:opacity-100"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </td>

                  {/* Produto */}
                  <td className="px-4 py-3">
                    <p className="text-gray-700 max-w-[180px] truncate" title={item.produto_comprado ?? ''}>
                      {item.produto_comprado ?? '—'}
                    </p>
                  </td>

                  {/* Trilha de cadência */}
                  <td className="px-4 py-3">
                    {item.trilha_nome ? (
                      <span
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold text-white whitespace-nowrap"
                        style={{ backgroundColor: item.trilha_cor ?? '#6B7280' }}
                        title={item.trilha_nome}
                      >
                        E{item.trilha_etapa}
                      </span>
                    ) : (
                      <span className="text-gray-300 text-xs">—</span>
                    )}
                  </td>

                  {/* Tempo */}
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                    {tempoRelativo(item.dias_desde_compra)}
                  </td>

                  {/* Status */}
                  <td className="px-4 py-3">
                    <StatusBadge status={item.status} />
                  </td>

                  {/* Prioridade */}
                  <td className="px-4 py-3">
                    <PrioridadeBadge prioridade={item.prioridade} />
                  </td>

                  {/* Score */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-12 h-1.5 bg-gray-100 rounded-full overflow-hidden flex-shrink-0">
                        <div
                          className={`h-full rounded-full ${scoreColor(item.score)}`}
                          style={{ width: `${item.score}%` }}
                        />
                      </div>
                      <span className="text-xs text-gray-500 w-6 text-right tabular-nums">{item.score}</span>
                    </div>
                  </td>

                  {/* Ação */}
                  <td className="px-4 py-3">
                    <WhatsAppButton
                      link={item.link_whatsapp}
                      desabilitado={concluido}
                      onAcao={status => atualizarStatus(item.id, status)}
                    />
                    {concluido && (
                      item.status_contato === 'convertido' ? (
                        <span className="inline-flex items-center gap-1 text-xs bg-emerald-100 text-emerald-700 font-semibold px-2 py-0.5 rounded-full mt-1">
                          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                          Convertido!
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400 mt-1 block capitalize">
                          {item.status_contato.replace('_', ' ')}
                        </span>
                      )
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        {/* Estado vazio */}
        {!loading && itens.length === 0 && (
          <div className="text-center py-20 text-gray-400">
            <div className="text-5xl mb-4">📋</div>
            <p className="text-base font-medium text-gray-600">Nenhum contato para hoje.</p>
            <p className="text-sm mt-1">Clique em <strong>Atualizar lista</strong> para gerar.</p>
          </div>
        )}
      </div>

      {/* ── Modal de confirmação ────────────────────────────────────────── */}
      <ModalConfirmacao
        aberto={modalAberto}
        titulo="Atualizar lista de hoje?"
        mensagem="A lista será regenerada com base nos scores atuais. Contatos já marcados como concluídos serão mantidos."
        labelConfirmar="Sim, atualizar"
        carregando={gerando}
        onConfirmar={confirmarGerar}
        onCancelar={() => setModalAberto(false)}
      />
    </div>
  )
}
