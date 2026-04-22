import { useCallback, useEffect, useRef, useState } from 'react'
import { useToast } from '../hooks/useToast'
import {
  cadenciasApi,
  type ItemListaDiaCadencia,
  type TrilhaCadencia,
  type EtapaCadencia,
} from '../services/api'

// ── Helpers ──────────────────────────────────────────────────────────────────

function iniciais(nome: string) {
  return nome.split(' ').slice(0, 2).map(p => p[0]).join('').toUpperCase()
}

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-gray-100 rounded ${className ?? ''}`} />
}

const STATUS_OPCOES = [
  { value: 'enviado',      label: 'Enviado ✓',      cor: 'text-blue-600'   },
  { value: 'respondeu',    label: 'Respondeu 💬',    cor: 'text-green-600'  },
  { value: 'sem_resposta', label: 'Sem resposta',    cor: 'text-gray-500'   },
  { value: 'convertido',   label: 'Convertido ⭐',   cor: 'text-yellow-600' },
  { value: 'nao_quer',     label: 'Não quer ✗',      cor: 'text-red-500'    },
] as const

type StatusContato = typeof STATUS_OPCOES[number]['value']

// ── Sub-tab: Lista do Dia ────────────────────────────────────────────────────

function ListaDoDia() {
  const toast = useToast()
  const [itens,    setItens]    = useState<ItemListaDiaCadencia[] | null>(null)
  const [loading,  setLoading]  = useState(true)
  const [avancando, setAvancando] = useState<Record<string, boolean>>({})
  const [msgs, setMsgs] = useState<Record<string, string>>({})
  const toastRef = useRef(toast)
  useEffect(() => { toastRef.current = toast })

  const carregar = useCallback(async () => {
    setLoading(true)
    try {
      const data = await cadenciasApi.listaDoDia()
      setItens(data.itens)
      // Inicializa mensagens editáveis com o valor do servidor
      setMsgs(prev => {
        const next = { ...prev }
        for (const item of data.itens) {
          if (!(item.id in next)) next[item.id] = item.mensagem_do_dia
        }
        return next
      })
    } catch {
      toastRef.current.error('Erro ao carregar lista do dia.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { carregar() }, [carregar])

  async function avancar(id: string, status: StatusContato) {
    setAvancando(prev => ({ ...prev, [id]: true }))
    try {
      const res = await cadenciasApi.avancarEtapa(id, status)
      const labelStatus = STATUS_OPCOES.find(o => o.value === status)?.label ?? status
      if (res.proximo_status === 'convertido') {
        toastRef.current.success('Cliente convertido! Trilha concluída com sucesso.')
      } else if (res.proximo_status === 'desistiu') {
        toastRef.current.info('Trilha pausada para este cliente.')
      } else if (res.proximo_status === 'concluido') {
        toastRef.current.success('Última etapa concluída!')
      } else {
        toastRef.current.success(`${labelStatus} — próxima etapa agendada.`)
      }
      // Remove da lista local
      setItens(prev => prev?.filter(i => i.id !== id) ?? null)
    } catch {
      toastRef.current.error('Erro ao avançar etapa.')
    } finally {
      setAvancando(prev => ({ ...prev, [id]: false }))
    }
  }

  function linkWhatsApp(item: ItemListaDiaCadencia) {
    const msg = msgs[item.id] ?? item.mensagem_do_dia
    if (!item.cliente_telefone) return null
    return `https://wa.me/${item.cliente_telefone}?text=${encodeURIComponent(msg)}`
  }

  if (loading) {
    return (
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-3">
              <Skeleton className="w-10 h-10 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ))}
      </div>
    )
  }

  if (!itens?.length) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <svg className="w-12 h-12 text-gray-300 mb-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p className="text-gray-500 font-medium">Nenhum contato pendente hoje</p>
        <p className="text-gray-400 text-sm mt-1">Todos os clientes estão em dia com suas cadências.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">{itens.length} contato{itens.length !== 1 ? 's' : ''} pendente{itens.length !== 1 ? 's' : ''} hoje</p>

      {itens.map(item => {
        const msg = msgs[item.id] ?? item.mensagem_do_dia
        const wa  = linkWhatsApp(item)
        const ocupado = avancando[item.id]

        return (
          <div key={item.id} className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
            {/* Header */}
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
                style={{ backgroundColor: item.trilha_cor }}>
                {iniciais(item.cliente_nome)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-gray-900 text-sm">{item.cliente_nome}</span>
                  <span
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold text-white"
                    style={{ backgroundColor: item.trilha_cor }}
                  >
                    {item.trilha_nome.split('→')[0].trim()}
                  </span>
                </div>
                <p className="text-xs text-gray-400">{item.cliente_email}</p>
              </div>
              <div className="flex-shrink-0 text-right">
                <p className="text-xs font-medium text-gray-700">Etapa {item.etapa_atual} de {item.total_etapas}</p>
                <p className="text-[10px] text-gray-400">{item.nome_etapa}</p>
                <p className="text-[10px] text-gray-400">{item.dias_na_trilha}d na trilha</p>
              </div>
            </div>

            {/* Mensagem editável */}
            <div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Mensagem do dia</p>
              <textarea
                value={msg}
                onChange={e => setMsgs(prev => ({ ...prev, [item.id]: e.target.value }))}
                rows={4}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none bg-gray-50"
              />
            </div>

            {/* Ações */}
            <div className="flex items-center gap-2 flex-wrap">
              {wa ? (
                <a
                  href={wa}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-green-500 hover:bg-green-600 text-white text-xs font-medium rounded-lg transition-colors"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                  </svg>
                  WhatsApp
                </a>
              ) : (
                <span className="text-xs text-gray-400 italic">Sem telefone</span>
              )}

              <div className="flex-1" />

              <select
                disabled={ocupado}
                defaultValue=""
                onChange={e => {
                  if (e.target.value) avancar(item.id, e.target.value as StatusContato)
                }}
                className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50"
              >
                <option value="" disabled>Registrar resultado...</option>
                {STATUS_OPCOES.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>

              {ocupado && (
                <span className="inline-block w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Sub-tab: Trilhas ─────────────────────────────────────────────────────────

function ModalEdicaoTrilha({
  trilhaId,
  onClose,
}: { trilhaId: string; onClose: () => void }) {
  const toast = useToast()
  const [dados,    setDados]    = useState<{ trilha: TrilhaCadencia; etapas: EtapaCadencia[] } | null>(null)
  const [loading,  setLoading]  = useState(true)
  const [salvando, setSalvando] = useState<Record<string, boolean>>({})
  const [msgs, setMsgs] = useState<Record<string, string>>({})

  useEffect(() => {
    cadenciasApi.getTrilha(trilhaId).then(data => {
      setDados(data)
      const m: Record<string, string> = {}
      for (const e of data.etapas) m[e.id] = e.mensagem_whatsapp
      setMsgs(m)
    }).catch(() => toast.error('Erro ao carregar trilha.')).finally(() => setLoading(false))
  }, [trilhaId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function salvarEtapa(etapa: EtapaCadencia) {
    setSalvando(prev => ({ ...prev, [etapa.id]: true }))
    try {
      await cadenciasApi.atualizarEtapa(etapa.id, { mensagem_whatsapp: msgs[etapa.id] })
      toast.success(`Etapa "${etapa.nome}" salva.`)
    } catch {
      toast.error('Erro ao salvar etapa.')
    } finally {
      setSalvando(prev => ({ ...prev, [etapa.id]: false }))
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">
            {loading ? 'Carregando...' : dados?.trilha.nome}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-5">
          {loading ? (
            [...Array(3)].map((_, i) => <Skeleton key={i} className="h-32 w-full" />)
          ) : dados?.etapas.map(etapa => (
            <div key={etapa.id} className="border border-gray-100 rounded-lg p-4 space-y-2">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary-100 text-primary-700 text-xs font-bold">
                  {etapa.numero_etapa}
                </span>
                <span className="text-sm font-medium text-gray-800">{etapa.nome}</span>
                <span className="text-xs text-gray-400 ml-auto">Dia {etapa.dia_envio}</span>
              </div>
              <p className="text-[10px] text-gray-400">Variáveis: <code className="bg-gray-100 px-1 rounded">{'{nome}'}</code></p>
              <textarea
                value={msgs[etapa.id] ?? etapa.mensagem_whatsapp}
                onChange={e => setMsgs(prev => ({ ...prev, [etapa.id]: e.target.value }))}
                rows={4}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
              />
              {/* Preview */}
              <div className="bg-green-50 border border-green-100 rounded-lg px-3 py-2">
                <p className="text-[10px] text-green-700 font-medium mb-1">Preview (exemplo: João)</p>
                <p className="text-xs text-green-800 whitespace-pre-wrap">
                  {(msgs[etapa.id] ?? etapa.mensagem_whatsapp).replace(/\{nome\}/g, 'João')}
                </p>
              </div>
              <div className="flex justify-end">
                <button
                  onClick={() => salvarEtapa(etapa)}
                  disabled={salvando[etapa.id]}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors"
                >
                  {salvando[etapa.id] && (
                    <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  )}
                  Salvar etapa
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function Trilhas() {
  const toast = useToast()
  const [trilhas,  setTrilhas]  = useState<TrilhaCadencia[] | null>(null)
  const [loading,  setLoading]  = useState(true)
  const [editando, setEditando] = useState<string | null>(null)

  useEffect(() => {
    cadenciasApi.listaTrilhas()
      .then(data => setTrilhas(data.trilhas))
      .catch(() => toast.error('Erro ao carregar trilhas.'))
      .finally(() => setLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <div className="space-y-3">
        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}
      </div>
    )
  }

  if (!trilhas?.length) {
    return (
      <div className="text-center py-16 text-gray-400">
        <p>Nenhuma trilha cadastrada.</p>
        <p className="text-sm mt-1">Execute o seed-trilhas.ts para criar as trilhas base.</p>
      </div>
    )
  }

  return (
    <>
      <div className="space-y-3">
        {trilhas.map(trilha => (
          <div key={trilha.id} className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="flex items-start gap-3">
              <div className="w-3 h-3 rounded-full flex-shrink-0 mt-1.5" style={{ backgroundColor: trilha.cor }} />
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-gray-900 text-sm">{trilha.nome}</p>
                    {trilha.produto_entrada && (
                      <p className="text-xs text-gray-400 mt-0.5">
                        {trilha.produto_entrada} → {trilha.produto_destino ?? 'Conduta Masculina'}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => setEditando(trilha.id)}
                    className="flex-shrink-0 text-xs text-primary-600 hover:text-primary-800 border border-primary-200 hover:border-primary-400 px-2.5 py-1 rounded-lg transition-colors"
                  >
                    Editar mensagens
                  </button>
                </div>

                <div className="flex items-center gap-4 mt-3 flex-wrap">
                  <div className="text-center">
                    <p className="text-lg font-bold text-gray-900">{trilha.clientes_ativos}</p>
                    <p className="text-[10px] text-gray-400 uppercase tracking-wide">Ativos</p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-bold text-green-600">{trilha.clientes_convertidos}</p>
                    <p className="text-[10px] text-gray-400 uppercase tracking-wide">Convertidos</p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-bold text-primary-600">{trilha.taxa_conversao}%</p>
                    <p className="text-[10px] text-gray-400 uppercase tracking-wide">Taxa</p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-bold text-gray-600">{trilha.total_etapas}</p>
                    <p className="text-[10px] text-gray-400 uppercase tracking-wide">Etapas</p>
                  </div>

                  {/* Barra de progresso taxa conversão */}
                  <div className="flex-1 min-w-[80px]">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] text-gray-400">Conversão</span>
                      <span className="text-[10px] font-medium text-gray-600">{trilha.taxa_conversao}%</span>
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${trilha.taxa_conversao}%`, backgroundColor: trilha.cor }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {editando && (
        <ModalEdicaoTrilha trilhaId={editando} onClose={() => setEditando(null)} />
      )}
    </>
  )
}

// ── Sub-tab: Métricas ────────────────────────────────────────────────────────

function Metricas() {
  const toast = useToast()
  const [dados,   setDados]   = useState<Awaited<ReturnType<typeof cadenciasApi.metricas>> | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    cadenciasApi.metricas()
      .then(setDados)
      .catch(() => toast.error('Erro ao carregar métricas.'))
      .finally(() => setLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (!dados) return null

  const { por_trilha, por_etapa } = dados

  const totalAtivos      = por_trilha.reduce((s, t) => s + t.ativos, 0)
  const totalConvertidos = por_trilha.reduce((s, t) => s + t.convertidos, 0)
  const totalGeral       = por_trilha.reduce((s, t) => s + t.total, 0)
  const taxaGeral        = totalGeral > 0 ? Math.round((totalConvertidos / totalGeral) * 100) : 0

  // Agrupa por_etapa por trilha
  const etapasPorTrilha: Record<string, typeof por_etapa> = {}
  for (const e of por_etapa) {
    if (!etapasPorTrilha[e.trilha_nome]) etapasPorTrilha[e.trilha_nome] = []
    etapasPorTrilha[e.trilha_nome].push(e)
  }

  return (
    <div className="space-y-6">
      {/* Cards resumo */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Total inscritos', valor: totalGeral,       cor: 'text-gray-900' },
          { label: 'Ativos',          valor: totalAtivos,      cor: 'text-blue-600' },
          { label: 'Convertidos',     valor: totalConvertidos, cor: 'text-green-600' },
          { label: 'Taxa geral',      valor: `${taxaGeral}%`,  cor: 'text-primary-600' },
        ].map(({ label, valor, cor }) => (
          <div key={label} className="bg-white border border-gray-200 rounded-xl p-4">
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">{label}</p>
            <p className={`text-2xl font-bold ${cor}`}>{valor}</p>
          </div>
        ))}
      </div>

      {/* Ranking de trilhas */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <p className="text-sm font-semibold text-gray-800 mb-4">Conversão por trilha</p>
        <div className="space-y-3">
          {[...por_trilha].sort((a, b) => b.taxa_conversao - a.taxa_conversao).map(t => (
            <div key={t.trilha_id}>
              <div className="flex items-center justify-between text-xs mb-1">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: t.trilha_cor }} />
                  <span className="text-gray-700 font-medium truncate">{t.trilha_nome.split('→')[0].trim()}</span>
                </div>
                <span className="text-gray-500 flex-shrink-0 ml-2">
                  {t.convertidos}/{t.total} — {t.taxa_conversao}%
                  {t.tempo_medio_dias ? ` · ${t.tempo_medio_dias}d` : ''}
                </span>
              </div>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${t.taxa_conversao}%`, backgroundColor: t.trilha_cor }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Funil por etapa de cada trilha */}
      {Object.entries(etapasPorTrilha).map(([trilhaNome, etapas]) => {
        const maxEtapa = Math.max(...etapas.map(e => e.total_chegaram), 1)
        const trilha   = por_trilha.find(t => t.trilha_nome === trilhaNome)
        return (
          <div key={trilhaNome} className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-4">
              {trilha && <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: trilha.trilha_cor }} />}
              <p className="text-sm font-semibold text-gray-800">{trilhaNome.split('→')[0].trim()}</p>
            </div>
            <div className="space-y-2">
              {etapas.map(e => (
                <div key={`${trilhaNome}-${e.etapa_numero}`} className="flex items-center gap-3 text-xs">
                  <span className="w-5 h-5 rounded-full bg-gray-100 flex items-center justify-center text-[10px] font-bold text-gray-600 flex-shrink-0">
                    {e.etapa_numero}
                  </span>
                  <span className="w-28 text-gray-600 truncate flex-shrink-0">{e.etapa_nome}</span>
                  <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary-400 rounded-full"
                      style={{ width: `${Math.round((e.total_chegaram / maxEtapa) * 100)}%` }}
                    />
                  </div>
                  <span className="text-gray-400 flex-shrink-0 w-16 text-right">
                    {e.total_chegaram} chegaram
                  </span>
                  {e.convertidos > 0 && (
                    <span className="text-green-600 font-medium flex-shrink-0">+{e.convertidos}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Página principal ─────────────────────────────────────────────────────────

type Aba = 'lista' | 'trilhas' | 'metricas'

const ABAS: { value: Aba; label: string }[] = [
  { value: 'lista',    label: 'Lista do Dia' },
  { value: 'trilhas',  label: 'Trilhas'      },
  { value: 'metricas', label: 'Métricas'     },
]

export default function Cadencias() {
  const [aba, setAba] = useState<Aba>('lista')

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Cadências</h1>
          <p className="text-sm text-gray-400 mt-0.5">Trilhas de ascensão ao Conduta Masculina</p>
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-1">
          {ABAS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setAba(value)}
              className={[
                'px-4 py-2.5 text-sm font-medium border-b-2 transition-colors',
                aba === value
                  ? 'border-primary-600 text-primary-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300',
              ].join(' ')}
            >
              {label}
            </button>
          ))}
        </nav>
      </div>

      {/* Conteúdo */}
      {aba === 'lista'    && <ListaDoDia />}
      {aba === 'trilhas'  && <Trilhas    />}
      {aba === 'metricas' && <Metricas   />}
    </div>
  )
}
