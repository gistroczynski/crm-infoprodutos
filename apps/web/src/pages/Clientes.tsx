import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { clientesApi, type ClienteListItem } from '../services/api'

// ── Helpers ────────────────────────────────────────────────────────────────

function tempoRelativo(dias: number | null): string {
  if (dias === null) return '—'
  if (dias === 0)   return 'Hoje'
  if (dias === 1)   return 'Ontem'
  if (dias < 7)     return `${dias} dias`
  if (dias < 14)    return '1 semana'
  if (dias < 30)    return `${Math.floor(dias / 7)} semanas`
  if (dias < 60)    return '1 mês'
  if (dias < 365)   return `${Math.floor(dias / 30)} meses`
  return `${Math.floor(dias / 365)} ano${Math.floor(dias / 365) > 1 ? 's' : ''}`
}

// ── Cores ──────────────────────────────────────────────────────────────────

const prioridadeColors: Record<string, string> = {
  alta:  'bg-red-100 text-red-700',
  media: 'bg-amber-100 text-amber-700',
  baixa: 'bg-gray-100 text-gray-600',
}

const statusColors: Record<string, string> = {
  novo:        'bg-blue-100 text-blue-700',
  nutricao:    'bg-purple-100 text-purple-700',
  pronto:      'bg-emerald-100 text-emerald-700',
  ascendido:   'bg-indigo-100 text-indigo-700',
  inativo:     'bg-gray-100 text-gray-500',
  sem_compras: 'bg-orange-100 text-orange-600',
}

const statusLabels: Record<string, string> = {
  novo: 'Novo', nutricao: 'Nutrição', pronto: 'Pronto',
  ascendido: 'Ascendido', inativo: 'Inativo', sem_compras: 'Sem compras',
}

// ── Score bar ──────────────────────────────────────────────────────────────

function ScoreBar({ score }: { score: number }) {
  const color = score >= 70 ? '#10b981' : score >= 40 ? '#f59e0b' : '#ef4444'
  return (
    <div className="flex items-center gap-2 min-w-[80px]">
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${score}%`, backgroundColor: color }} />
      </div>
      <span className="text-xs font-bold text-gray-700 w-6 text-right">{score}</span>
    </div>
  )
}

// ── Skeleton ───────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <tr>
      <td className="px-4 py-3.5">
        <div className="h-3.5 w-36 bg-gray-200 animate-pulse rounded-full mb-1.5" />
        <div className="h-3 w-48 bg-gray-100 animate-pulse rounded-full" />
      </td>
      <td className="px-4 py-3.5 hidden md:table-cell">
        <div className="h-3 w-40 bg-gray-200 animate-pulse rounded-full" />
      </td>
      <td className="px-4 py-3.5 hidden lg:table-cell">
        <div className="h-3 w-16 bg-gray-200 animate-pulse rounded-full" />
      </td>
      <td className="px-4 py-3.5">
        <div className="h-5 w-16 bg-gray-200 animate-pulse rounded-full" />
      </td>
      <td className="px-4 py-3.5 hidden sm:table-cell">
        <div className="h-5 w-14 bg-gray-200 animate-pulse rounded-full" />
      </td>
      <td className="px-4 py-3.5">
        <div className="h-3 w-20 bg-gray-200 animate-pulse rounded-full" />
      </td>
      <td className="px-4 py-3.5 hidden xl:table-cell">
        <div className="h-5 w-12 bg-gray-200 animate-pulse rounded-full" />
      </td>
    </tr>
  )
}

// ── Clientes ───────────────────────────────────────────────────────────────

const STATUS_OPTIONS   = ['', 'novo', 'nutricao', 'pronto', 'ascendido', 'inativo', 'sem_compras']
const PRIORIDADE_OPTIONS = ['', 'alta', 'media', 'baixa']

export default function Clientes() {
  const navigate = useNavigate()
  const [clientes,   setClientes]   = useState<ClienteListItem[]>([])
  const [total,      setTotal]      = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [page,       setPage]       = useState(1)
  const [search,     setSearch]     = useState('')
  const [status,     setStatus]     = useState('')
  const [prioridade, setPrioridade] = useState('')
  const [compras,    setCompras]    = useState('')
  const [loading,    setLoading]    = useState(true)
  const limit = 20

  useEffect(() => {
    let active = true
    setLoading(true)
    clientesApi
      .list({ page, limit, search: search || undefined, status: status || undefined, prioridade: prioridade || undefined, compras: compras || undefined })
      .then(res => {
        if (!active) return
        setClientes(res.clientes)
        setTotal(res.total)
        setTotalPages(res.total_pages)
      })
      .finally(() => active && setLoading(false))
    return () => { active = false }
  }, [page, search, status, prioridade, compras])

  function handleFilter<T>(setter: (v: T) => void) {
    return (v: T) => { setter(v); setPage(1) }
  }

  return (
    <div>
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
        <h1 className="text-2xl font-bold text-gray-900">
          Clientes
          {!loading && (
            <span className="ml-2 text-base font-normal text-gray-400">
              ({total.toLocaleString('pt-BR')})
            </span>
          )}
        </h1>

        <div className="flex flex-wrap gap-2">
          {/* Busca */}
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Buscar nome ou e-mail..."
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1) }}
              className="pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm w-56 focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>

          {/* Status */}
          <select
            value={status}
            onChange={e => handleFilter(setStatus)(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white text-gray-700"
          >
            <option value="">Todos os status</option>
            {STATUS_OPTIONS.filter(Boolean).map(o => (
              <option key={o} value={o}>{statusLabels[o] ?? o}</option>
            ))}
          </select>

          {/* Prioridade */}
          <select
            value={prioridade}
            onChange={e => handleFilter(setPrioridade)(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white text-gray-700"
          >
            <option value="">Todas as prioridades</option>
            {PRIORIDADE_OPTIONS.filter(Boolean).map(o => (
              <option key={o} value={o}>{o.charAt(0).toUpperCase() + o.slice(1)}</option>
            ))}
          </select>

          {/* Compras */}
          <select
            value={compras}
            onChange={e => handleFilter(setCompras)(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white text-gray-700"
          >
            <option value="">Com e sem compras</option>
            <option value="com">Com compras</option>
            <option value="sem">Sem compras</option>
          </select>
        </div>
      </div>

      {/* ── Tabela ── */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wide">
                Nome / Email
              </th>
              <th className="text-left px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wide hidden md:table-cell">
                Último produto
              </th>
              <th className="text-left px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wide hidden lg:table-cell">
                Comprou há
              </th>
              <th className="text-left px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wide">
                Status
              </th>
              <th className="text-left px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wide hidden sm:table-cell">
                Prioridade
              </th>
              <th className="text-left px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wide">
                Score
              </th>
              <th className="px-4 py-3 hidden xl:table-cell" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading
              ? Array.from({ length: 10 }).map((_, i) => <SkeletonRow key={i} />)
              : clientes.map(c => (
                  <tr
                    key={c.id}
                    onClick={() => navigate(`/clientes/${c.id}`)}
                    className="hover:bg-blue-50/40 cursor-pointer transition-colors group"
                  >
                    {/* Nome + email */}
                    <td className="px-4 py-3.5">
                      <p className="font-semibold text-gray-900 group-hover:text-primary-700 transition-colors leading-tight">
                        {c.nome}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">{c.email}</p>
                    </td>

                    {/* Último produto */}
                    <td className="px-4 py-3.5 text-gray-600 max-w-[200px] hidden md:table-cell">
                      {c.ultimo_produto ? (
                        <p className="truncate text-sm" title={c.ultimo_produto}>{c.ultimo_produto}</p>
                      ) : (
                        <span className="text-xs text-orange-500 italic">Sem compras registradas</span>
                      )}
                    </td>

                    {/* Comprou há */}
                    <td className="px-4 py-3.5 text-gray-500 whitespace-nowrap hidden lg:table-cell">
                      {tempoRelativo(c.dias_desde_ultima_compra)}
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3.5">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[c.status] ?? 'bg-gray-100 text-gray-500'}`}>
                        {statusLabels[c.status] ?? c.status}
                      </span>
                    </td>

                    {/* Prioridade */}
                    <td className="px-4 py-3.5 hidden sm:table-cell">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${prioridadeColors[c.prioridade] ?? 'bg-gray-100 text-gray-600'}`}>
                        {c.prioridade}
                      </span>
                    </td>

                    {/* Score como barra */}
                    <td className="px-4 py-3.5">
                      <ScoreBar score={c.score} />
                    </td>

                    {/* Ação */}
                    <td className="px-4 py-3.5 text-right hidden xl:table-cell">
                      <span className="text-xs text-primary-600 font-medium opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                        Ver perfil →
                      </span>
                    </td>
                  </tr>
                ))}
          </tbody>
        </table>

        {!loading && clientes.length === 0 && (
          <div className="text-center py-16 text-gray-400">
            <div className="text-4xl mb-3">👥</div>
            <p className="text-base font-medium text-gray-600">Nenhum cliente encontrado.</p>
            <p className="text-sm mt-1">Ajuste os filtros ou sincronize com a Hotmart.</p>
          </div>
        )}
      </div>

      {/* ── Paginação ── */}
      {!loading && totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 text-sm text-gray-600">
          <span>{total.toLocaleString('pt-BR')} clientes</span>
          <div className="flex gap-2 items-center">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1.5 border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50 transition-colors"
            >
              Anterior
            </button>
            <span className="px-2 text-gray-700 font-medium">
              Página {page} de {totalPages}
            </span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-3 py-1.5 border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50 transition-colors"
            >
              Próxima
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
