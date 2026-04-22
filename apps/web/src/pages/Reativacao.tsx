import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { reativacaoApi, type ItemReativacao, type StatsReativacao } from '../services/api'
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

function scoreColor(score: number) {
  if (score >= 100) return 'bg-emerald-500'
  if (score >= 60)  return 'bg-amber-400'
  return 'bg-red-400'
}

function tipoProdutoBadge(tipo: string) {
  const map: Record<string, { label: string; cls: string }> = {
    multiplos:  { label: 'Múltiplos',  cls: 'bg-violet-100 text-violet-700' },
    workshop:   { label: 'Workshop',   cls: 'bg-blue-100 text-blue-700' },
    livro:      { label: 'Livro',      cls: 'bg-amber-100 text-amber-700' },
    order_bump: { label: 'Order Bump', cls: 'bg-gray-100 text-gray-500' },
  }
  const info = map[tipo] ?? { label: tipo, cls: 'bg-gray-100 text-gray-500' }
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${info.cls}`}>
      {info.label}
    </span>
  )
}

// ── Stats panel ───────────────────────────────────────────────────────────

function StatsPanel({ stats, onPopular }: { stats: StatsReativacao | null; onPopular: () => void; populando: boolean }) {
  if (!stats) return null

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <p className="text-xs text-gray-500 uppercase tracking-wide">Total na fila</p>
        <p className="text-2xl font-bold text-gray-900">{stats.aguardando.toLocaleString('pt-BR')}</p>
        <p className="text-xs text-gray-400 mt-0.5">aguardando contato</p>
      </div>
      <div className="bg-white rounded-xl border border-orange-200 bg-orange-50 p-4">
        <p className="text-xs text-orange-600 uppercase tracking-wide">Em cadência</p>
        <p className="text-2xl font-bold text-orange-700">{stats.em_cadencia.toLocaleString('pt-BR')}</p>
        <p className="text-xs text-orange-400 mt-0.5">{stats.limite_diario}/dia limite</p>
      </div>
      <div className="bg-white rounded-xl border border-emerald-200 bg-emerald-50 p-4">
        <p className="text-xs text-emerald-600 uppercase tracking-wide">Convertidos</p>
        <p className="text-2xl font-bold text-emerald-700">{stats.convertidos.toLocaleString('pt-BR')}</p>
        <p className="text-xs text-emerald-400 mt-0.5">ascenderam ao CM</p>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <p className="text-xs text-gray-500 uppercase tracking-wide">Projeção</p>
        <p className="text-2xl font-bold text-gray-900">
          {stats.projecao_dias_para_zerar !== null ? `${stats.projecao_dias_para_zerar}d` : '—'}
        </p>
        <p className="text-xs text-gray-400 mt-0.5">para zerar fila</p>
      </div>
    </div>
  )
}

// ── Card de reativação ────────────────────────────────────────────────────

function CardReativacao({
  item,
  onAvancar,
}: {
  item: ItemReativacao
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
        confetti ? 'border-emerald-400 bg-emerald-50' : 'border-gray-200 bg-gray-50 opacity-50',
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
    <div className="rounded-xl border-2 border-orange-200 bg-white shadow-sm hover:shadow-md transition-shadow">
      <div className="p-4">
        {/* Header */}
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
          <div className="flex flex-col items-end gap-1 flex-shrink-0">
            {tipoProdutoBadge(item.tipo_produto)}
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold text-white"
              style={{ backgroundColor: item.trilha_cor || '#F97316' }}
            >
              E{item.etapa_atual}/{item.total_etapas}
            </span>
          </div>
        </div>

        {/* Produto + Score */}
        <div className="flex items-center gap-3 mb-3">
          <p className="text-xs text-gray-500 truncate flex-1" title={item.produto_comprado}>
            📦 {item.produto_comprado}
          </p>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <div className="w-12 h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${scoreColor(item.score_prioridade)}`}
                style={{ width: `${Math.min(item.score_prioridade, 100)}%` }}
              />
            </div>
            <span className="text-xs text-gray-400 tabular-nums">{item.score_prioridade}</span>
          </div>
        </div>

        {/* Dias desde compra */}
        <p className="text-xs text-orange-500 mb-3">
          🕐 Comprou há <strong>{item.dias_desde_compra}</strong> dias
        </p>

        {/* Mensagem */}
        <div className="bg-orange-50 rounded-lg p-3 mb-3 border border-orange-100">
          <p className="text-xs text-orange-400 mb-1 font-medium">{item.nome_etapa}</p>
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
            className="flex-1 min-w-[140px] border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-orange-400"
          >
            <option value="">Selecionar resultado...</option>
            {(Object.keys(RESULTADO_LABELS) as Resultado[]).map(r => (
              <option key={r} value={r}>{RESULTADO_LABELS[r]}</option>
            ))}
          </select>

          <button
            onClick={confirmar}
            disabled={!resultado || salvando}
            className="px-3 py-1.5 bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white text-xs font-semibold rounded-lg transition-colors"
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
            className="mt-2 w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-gray-700 resize-none focus:outline-none focus:ring-2 focus:ring-orange-400"
          />
        )}
      </div>
    </div>
  )
}

// ── Página principal ──────────────────────────────────────────────────────

export default function Reativacao() {
  const toast = useToast()
  const [itens,     setItens]     = useState<ItemReativacao[]>([])
  const [stats,     setStats]     = useState<StatsReativacao | null>(null)
  const [loading,   setLoading]   = useState(true)
  const [populando, setPopulando] = useState(false)
  const [error,     setError]     = useState<string | null>(null)
  const toastRef = useRef(toast)
  toastRef.current = toast

  const carregar = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [statsData, listaData] = await Promise.all([
        reativacaoApi.stats(),
        reativacaoApi.listaDia(),
      ])
      setStats(statsData)
      setItens(listaData.itens)
    } catch {
      setError('Erro ao carregar lista de reativação.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { carregar() }, [carregar])

  async function popularFila() {
    setPopulando(true)
    try {
      const resultado = await reativacaoApi.popularFila()
      toastRef.current.success(
        `Fila atualizada! ${resultado.adicionados} leads adicionados.`
      )
      await carregar()
    } catch {
      toastRef.current.error('Erro ao popular a fila de reativação.')
    } finally {
      setPopulando(false)
    }
  }

  async function avancar(id: string, resultado: string, obs?: string) {
    await reativacaoApi.avancar(id, resultado, obs)
    if (resultado === 'convertido') {
      toastRef.current.success('Convertido! Excelente!')
      setStats(s => s ? { ...s, convertidos: s.convertidos + 1, em_cadencia: Math.max(0, s.em_cadencia - 1) } : s)
    } else {
      toastRef.current.success('Resultado registrado.')
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="mb-5">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">Reativação</h1>
              {!loading && itens.length > 0 && (
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-orange-500 text-white">
                  {itens.length} hoje
                </span>
              )}
            </div>
            <p className="text-sm text-gray-500 mt-0.5">Leads antigos prontos para reativar</p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={popularFila}
              disabled={populando || loading}
              className="flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
            >
              {populando ? (
                <>
                  <span className="inline-block w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Populando...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 2v6h6M3 13a9 9 0 1 0 3-7.7L3 8" />
                  </svg>
                  Popular fila
                </>
              )}
            </button>
            <button
              onClick={carregar}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
            >
              <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Atualizar
            </button>
          </div>
        </div>
      </div>

      {/* Stats */}
      {!loading && <StatsPanel stats={stats} onPopular={popularFila} populando={populando} />}

      {/* Erro */}
      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
      )}

      {/* Cards */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-xl border-2 border-orange-100 bg-white p-4 animate-pulse">
                <div className="h-4 bg-gray-200 rounded w-2/3 mb-2" />
                <div className="h-3 bg-gray-100 rounded w-1/2 mb-4" />
                <div className="h-16 bg-orange-50 rounded mb-3" />
                <div className="h-8 bg-gray-100 rounded" />
              </div>
            ))}
          </div>
        )}

        {!loading && itens.length === 0 && (
          <div className="text-center py-20 text-gray-400">
            <div className="text-5xl mb-4">🔄</div>
            <p className="text-base font-medium text-gray-600">Nenhum lead de reativação para hoje.</p>
            <p className="text-sm mt-1">
              Clique em <strong>Popular fila</strong> para buscar leads elegíveis,
              ou aguarde o cron de domingo às 23h.
            </p>
          </div>
        )}

        {!loading && itens.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {itens.map(item => (
              <CardReativacao key={item.id} item={item} onAvancar={avancar} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
