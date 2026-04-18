import { useCallback, useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { useToast } from '../../hooks/useToast'
import api from '../../services/api'
import {
  ClipboardListIcon,
  UsersIcon,
  LayoutDashboardIcon,
  BarChart3Icon,
  SettingsIcon,
} from './icons'

// ── Hooks internos ─────────────────────────────────────────────────────────

function usePendingCount() {
  const [count, setCount] = useState(0)

  useEffect(() => {
    const fetch = () => {
      api.get<{ itens: { status_contato: string }[] }>('/api/lista/hoje')
        .then(r => setCount(r.data.itens.filter(i => i.status_contato === 'pendente').length))
        .catch(() => {})
    }
    fetch()
    const interval = setInterval(fetch, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [])

  return count
}

function useSyncStatus() {
  const [ultimaSync, setUltimaSync] = useState<string | null>(null)
  const [emAndamento, setEmAndamento] = useState(false)

  const fetch = useCallback(() => {
    api.get<{ ultima_sync?: string | null; sync_em_andamento: boolean }>('/api/sync/status')
      .then(r => {
        setUltimaSync(r.data.ultima_sync ?? null)
        setEmAndamento(r.data.sync_em_andamento)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetch()
    const interval = setInterval(fetch, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [fetch])

  return { ultimaSync, emAndamento, refetch: fetch }
}

function tempoPassado(iso: string | null): string {
  if (!iso) return 'nunca'
  const diffMs = Date.now() - new Date(iso).getTime()
  const min    = Math.floor(diffMs / 60_000)
  if (min < 1)   return 'agora'
  if (min < 60)  return `${min} min atrás`
  const h = Math.floor(min / 60)
  if (h < 24)    return `${h}h atrás`
  return `${Math.floor(h / 24)}d atrás`
}

// ── Componente ─────────────────────────────────────────────────────────────

export default function Sidebar() {
  const toast       = useToast()
  const pending     = usePendingCount()
  const { ultimaSync, emAndamento, refetch } = useSyncStatus()
  const [syncing, setSyncing] = useState(false)

  async function triggerSync() {
    setSyncing(true)
    try {
      await api.post('/api/sync/manual')
      toast.info('Sincronização iniciada. Pode levar alguns minutos.')
      setTimeout(refetch, 3000)
    } catch {
      toast.error('Falha ao iniciar sincronização.')
    } finally {
      setSyncing(false)
    }
  }

  const navItems = [
    { to: '/lista-diaria', label: 'Lista Diária', Icon: ClipboardListIcon, badge: pending > 0 ? pending : 0 },
    { to: '/clientes',     label: 'Clientes',     Icon: UsersIcon,          badge: 0 },
    { to: '/dashboard',    label: 'Dashboard',    Icon: LayoutDashboardIcon,badge: 0 },
    { to: '/relatorios',   label: 'Relatórios',   Icon: BarChart3Icon,      badge: 0 },
    { to: '/configuracoes',label: 'Configurações',Icon: SettingsIcon,       badge: 0 },
  ]

  return (
    <aside className="w-60 bg-white border-r border-gray-200 flex flex-col">
      {/* Logo */}
      <div className="h-16 flex items-center px-6 border-b border-gray-200">
        <span className="text-lg font-bold text-primary-600">CRM Infoprodutos</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems.map(({ to, label, Icon, badge }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              [
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary-50 text-primary-700'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
              ].join(' ')
            }
          >
            <Icon className="h-5 w-5 flex-shrink-0" />
            <span className="flex-1">{label}</span>
            {badge > 0 && (
              <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold bg-red-500 text-white">
                {badge > 99 ? '99+' : badge}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Footer — última sync */}
      <div className="px-4 py-3 border-t border-gray-200 space-y-1.5">
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Última sync</p>
            <p className="text-xs text-gray-500 truncate">
              {emAndamento ? (
                <span className="text-primary-500 font-medium">Em andamento...</span>
              ) : (
                tempoPassado(ultimaSync)
              )}
            </p>
          </div>
          <button
            onClick={triggerSync}
            disabled={syncing || emAndamento}
            title="Sincronizar com Hotmart"
            className="p-1.5 rounded-lg text-gray-400 hover:text-primary-600 hover:bg-primary-50 disabled:opacity-40 transition-colors flex-shrink-0"
          >
            <svg
              className={`w-3.5 h-3.5 ${(syncing || emAndamento) ? 'animate-spin' : ''}`}
              fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
        <p className="text-[10px] text-gray-300">v1.0.0</p>
      </div>
    </aside>
  )
}
