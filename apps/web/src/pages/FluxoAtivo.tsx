import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fluxoAtivoApi, type ItemFluxoAtivo } from '../services/api'
import { useToast } from '../hooks/useToast'


// ── Helpers ───────────────────────────────────────────────────────────────

type Resultado = 'enviado' | 'respondeu' | 'sem_resposta' | 'convertido' | 'nao_quer'

const RESULTADO_LABELS: Record<Resultado, string> = {
  enviado:      'Enviado',
  respondeu:    'Respondeu',
  sem_resposta: 'Sem resposta',
  convertido:   'Convertido!',
  nao_quer:     'Não quer',
}

const RESULTADO_COLORS: Record<Resultado, string> = {
  enviado:      'text-blue-600 bg-blue-50 border-blue-200',
  respondeu:    'text-emerald-600 bg-emerald-50 border-emerald-200',
  sem_resposta: 'text-gray-500 bg-gray-50 border-gray-200',
  convertido:   'text-emerald-700 bg-emerald-100 border-emerald-300',
  nao_quer:     'text-red-500 bg-red-50 border-red-200',
}

// ── Componente de card ────────────────────────────────────────────────────

function CardFluxoAtivo({
  item,
  onAvancar,
}: {
  item: ItemFluxoAtivo
  onAvancar: (id: string, resultado: Resultado, obs?: string) => Promise<void>
}) {
  const navigate  = useNavigate()
  const [resultado, setResultado]   = useState<Resultado | ''>('')
  const [salvando, setSalvando]     = useState(false)
  const [concluido, setConcluido]   = useState(false)
  const [confetti, setConfetti]     = useState(false)
  const [obs, setObs]               = useState('')
  const [mostrarObs, setMostrarObs] = useState(false)

  async function confirmar() {
    if (!resultado) return
    setSalvando(true)
    try {
      await onAvancar(item.id, resultado, obs || undefined)
      setConcluido(true)
      if (resultado === 'convertido') setConfetti(true)
    } finally {
      setSalvando(false)
    }
  }

  if (concluido) {
    return (
      <div className={[
        'relative rounded-xl border-2 p-4 transition-all',
        confetti
          ? 'border-emerald-400 bg-emerald-50'
          : 'border-gray-200 bg-gray-50 opacity-50',
      ].join(' ')}>
        {confetti && (
          <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-xl">
            {['🎉','✨','🏆','💥','🎊'].map((e, i) => (
              <span
                key={i}
                className="absolute text-2xl animate-bounce"
                style={{ left: `${10 + i * 18}%`, top: `${20 + (i % 2) * 30}%`, animationDelay: `${i * 0.1}s` }}
              >{e}</span>
            ))}
          </div>
        )}
        <p className="text-center font-semibold text-gray-600">
          {resultado === 'convertido' ? '🏆 Convertido! Parabéns!' : `Registrado: ${RESULTADO_LABELS[resultado as Resultado]}`}
        </p>
      </div>
    )
  }

  return (
    <div
      className="rounded-xl border border-gray-200 bg-white shadow-sm hover:shadow-md transition-shadow"
      style={{ borderLeftWidth: 4, borderLeftColor: item.trilha_cor }}
    >
      <div className="p-4">
        {/* Header: nome + etapa */}
        <div className="flex items-start justify-between gap-2 mb-3">
          <div>
            <button
              onClick={() => navigate(`/clientes/${item.cliente_id}`)}
              className="font-semibold text-gray-900 hover:text-primary-600 text-left transition-colors"
            >
              {item.cliente_nome}
            </button>
            <p className="text-xs text-gray-400">{item.cliente_email}</p>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold text-white"
              style={{ backgroundColor: item.trilha_cor }}
            >
              E{item.etapa_atual}/{item.total_etapas}
            </span>
            <span className="text-xs text-gray-400">{item.nome_etapa}</span>
          </div>
        </div>

        {/* Produto + dias na trilha */}
        <div className="flex items-center gap-3 mb-3 text-xs text-gray-500">
          <span className="truncate max-w-[200px]" title={item.produto_entrada}>
            📦 {item.produto_entrada || '—'}
          </span>
          <span className="flex-shrink-0">🕐 {item.dias_na_trilha}d na trilha</span>
        </div>

        {/* Mensagem */}
        <div className="bg-gray-50 rounded-lg p-3 mb-3">
          <p className="text-xs text-gray-400 mb-1 font-medium">Mensagem do dia:</p>
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{item.mensagem_do_dia}</p>
        </div>

        {/* Ações */}
        <div className="flex items-center gap-2 flex-wrap">
          {item.link_whatsapp && (
            <a
              href={item.link_whatsapp}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-green-500 hover:bg-green-600 text-white text-xs font-semibold rounded-lg transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
              </svg>
              Abrir WhatsApp
            </a>
          )}

          <select
            value={resultado}
            onChange={e => {
              setResultado(e.target.value as Resultado)
              setMostrarObs(e.target.value === 'respondeu' || e.target.value === 'convertido')
            }}
            className="flex-1 min-w-[140px] border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <option value="">Selecionar resultado...</option>
            {(Object.keys(RESULTADO_LABELS) as Resultado[]).map(r => (
              <option key={r} value={r}>{RESULTADO_LABELS[r]}</option>
            ))}
          </select>

          <button
            onClick={confirmar}
            disabled={!resultado || salvando}
            className="px-3 py-1.5 bg-primary-600 hover:bg-primary-700 disabled:opacity-40 text-white text-xs font-semibold rounded-lg transition-colors"
          >
            {salvando ? '...' : 'Confirmar'}
          </button>
        </div>

        {mostrarObs && (
          <textarea
            placeholder="Observação (opcional)..."
            value={obs}
            onChange={e => setObs(e.target.value)}
            rows={2}
            className="mt-2 w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-gray-700 resize-none focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        )}

        {resultado && (
          <div className={`mt-2 inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold border ${RESULTADO_COLORS[resultado as Resultado]}`}>
            Preview: {RESULTADO_LABELS[resultado as Resultado]}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Página principal ──────────────────────────────────────────────────────

type TabEtapa = 'todos' | '1' | '2' | '3+'

export default function FluxoAtivo() {
  const navigate  = useNavigate()
  const toast     = useToast()
  const [itens,              setItens]              = useState<ItemFluxoAtivo[]>([])
  const [totalReal,          setTotalReal]          = useState(0)
  const [limite,             setLimite]             = useState(30)
  const [loading,            setLoading]            = useState(true)
  const [error,              setError]              = useState<string | null>(null)
  const [tabEtapa,           setTabEtapa]           = useState<TabEtapa>('todos')
  const [busca,              setBusca]              = useState('')
  const [modalPrioridades,   setModalPrioridades]   = useState(false)
  const [atualizandoPrior,   setAtualizandoPrior]   = useState(false)
  const toastRef = useRef(toast)
  toastRef.current = toast

  const carregar = useCallback(async (semLimite = false) => {
    setLoading(true)
    setError(null)
    try {
      const data = await fluxoAtivoApi.listaDia(semLimite)
      setItens(data.itens)
      setTotalReal(data.total_real)
      setLimite(data.limite)
    } catch {
      setError('Erro ao carregar lista do fluxo ativo.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { carregar(false) }, [carregar])

  async function avancar(id: string, resultado: string, obs?: string) {
    await fluxoAtivoApi.avancar(id, resultado, obs)
    if (resultado === 'convertido') {
      toastRef.current.success('Convertido! Excelente trabalho!')
    } else {
      toastRef.current.success('Resultado registrado.')
    }
  }

  async function atualizarPrioridades() {
    setAtualizandoPrior(true)
    setModalPrioridades(false)
    try {
      const r = await fluxoAtivoApi.atualizarPrioridades()
      toastRef.current.success(r.mensagem)
      await carregar(false)
    } catch {
      toastRef.current.error('Erro ao atualizar prioridades.')
    } finally {
      setAtualizandoPrior(false)
    }
  }

  const itensFiltrados = itens.filter(item => {
    const etapaOk = tabEtapa === 'todos'
      ? true
      : tabEtapa === '3+'
        ? item.etapa_atual >= 3
        : item.etapa_atual === Number(tabEtapa)

    const buscaOk = busca.trim() === '' || [item.cliente_nome, item.cliente_email, item.produto_entrada]
      .join(' ').toLowerCase().includes(busca.toLowerCase())

    return etapaOk && buscaOk
  })

  const countPorEtapa = (etapa: TabEtapa) => {
    if (etapa === 'todos') return itens.length
    if (etapa === '3+')   return itens.filter(i => i.etapa_atual >= 3).length
    return itens.filter(i => i.etapa_atual === Number(etapa)).length
  }

  const TABS: { value: TabEtapa; label: string; cor: string }[] = [
    { value: 'todos', label: 'Todos',   cor: 'border-gray-800 text-gray-900' },
    { value: '1',     label: 'Etapa 1', cor: 'border-blue-500 text-blue-600' },
    { value: '2',     label: 'Etapa 2', cor: 'border-violet-500 text-violet-600' },
    { value: '3+',    label: 'Etapa 3+',cor: 'border-amber-500 text-amber-600' },
  ]

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="mb-5">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">Fluxo Ativo</h1>
              {!loading && totalReal > 0 && (
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-primary-600 text-white">
                  {Math.min(limite, totalReal)} de {totalReal} hoje
                </span>
              )}
            </div>
            <p className="text-sm text-gray-500 mt-0.5">Leads recentes em cadência de ascensão</p>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Buscar por nome ou produto..."
              value={busca}
              onChange={e => setBusca(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 w-56"
            />
            <button
              onClick={() => setModalPrioridades(true)}
              disabled={atualizandoPrior || loading}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-red-300 text-red-600 text-sm font-medium rounded-lg hover:bg-red-50 disabled:opacity-50 transition-colors"
            >
              {atualizandoPrior ? (
                <span className="inline-block w-3.5 h-3.5 border-2 border-red-400 border-t-transparent rounded-full animate-spin" />
              ) : (
                <span>↻</span>
              )}
              Atualizar prioridades
            </button>
            <button
              onClick={() => carregar(false)}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors"
            >
              <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Atualizar
            </button>
          </div>
        </div>
      </div>

      {/* Erro */}
      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
      )}

      {/* Tabs por etapa */}
      <div className="flex border-b border-gray-200 mb-4">
        {TABS.map(tab => (
          <button
            key={tab.value}
            onClick={() => setTabEtapa(tab.value)}
            className={[
              'px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
              tabEtapa === tab.value
                ? `${tab.cor} border-current`
                : 'text-gray-500 border-transparent hover:text-gray-700',
            ].join(' ')}
          >
            {tab.label}
            <span className="ml-1.5 text-xs opacity-60">({countPorEtapa(tab.value)})</span>
          </button>
        ))}
      </div>

      {/* Cards */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-gray-200 bg-white p-4 animate-pulse">
                <div className="h-4 bg-gray-200 rounded w-2/3 mb-2" />
                <div className="h-3 bg-gray-100 rounded w-1/2 mb-4" />
                <div className="h-16 bg-gray-100 rounded mb-3" />
                <div className="h-8 bg-gray-100 rounded" />
              </div>
            ))}
          </div>
        )}

        {!loading && itensFiltrados.length === 0 && (
          <div className="text-center py-20 text-gray-400">
            <div className="text-5xl mb-4">⚡</div>
            <p className="text-base font-medium text-gray-600">
              {itens.length === 0 ? 'Nenhum lead ativo para hoje.' : 'Nenhum resultado para o filtro atual.'}
            </p>
            {itens.length === 0 && (
              <p className="text-sm mt-1">Os contatos aparecerão aqui quando chegar o dia da etapa.</p>
            )}
          </div>
        )}

        {!loading && itensFiltrados.length > 0 && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {itensFiltrados.map(item => (
                <CardFluxoAtivo key={item.id} item={item} onAvancar={avancar} />
              ))}
            </div>
            {totalReal > limite && tabEtapa === 'todos' && busca.trim() === '' && (
              <div className="mt-4 flex items-center justify-center gap-3">
                <span className="text-sm text-gray-400">
                  Exibindo {Math.min(limite, totalReal)} de {totalReal} contatos disponíveis hoje
                </span>
                <button
                  onClick={() => carregar(true)}
                  className="text-sm text-primary-600 font-medium hover:text-primary-700 hover:underline transition-colors"
                >
                  Ver todos os {totalReal} →
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Modal: confirmar atualização de prioridades */}
      {modalPrioridades && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md mx-4">
            <h3 className="text-lg font-bold text-gray-900 mb-2">Atualizar prioridades?</h3>
            <p className="text-sm text-gray-600 mb-5">
              Isso vai <strong>remover</strong> todos os contatos que ainda não foram abordados (etapa 1)
              e <strong>reinserir</strong> os clientes com compras nos últimos 30 dias,
              reordenando por prioridade. Quem já foi contatado não é afetado.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setModalPrioridades(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={atualizarPrioridades}
                className="px-4 py-2 text-sm font-medium text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors"
              >
                Sim, atualizar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
