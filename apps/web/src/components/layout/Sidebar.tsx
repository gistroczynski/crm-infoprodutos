import { useCallback, useEffect, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useToast } from '../../hooks/useToast'
import { useAuth } from '../../contexts/AuthContext'
import api from '../../services/api'
import logoOgc from '../../assets/logo-ogc.svg'
import {
  UsersIcon,
  ShoppingCartIcon,
  LayoutDashboardIcon,
  BarChart3Icon,
  SettingsIcon,
  ZapIcon,
  RotateCcwIcon,
} from './icons'

// ── Hooks internos ─────────────────────────────────────────────────────────

function useFluxoAtivoCount() {
  const [count, setCount] = useState(0)
  useEffect(() => {
    const fetch = () => {
      api.get<{ total: number }>('/api/cadencias/fluxo-ativo')
        .then(r => setCount(r.data.total))
        .catch(() => {})
    }
    fetch()
    const interval = setInterval(fetch, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [])
  return count
}

function useReativacaoCount() {
  const [count, setCount] = useState(0)
  useEffect(() => {
    const fetch = () => {
      api.get<{ aguardando: number }>('/api/reativacao/stats')
        .then(r => setCount(r.data.aguardando))
        .catch(() => {})
    }
    fetch()
    const interval = setInterval(fetch, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [])
  return count
}

function useVendasHojeCount() {
  const [count, setCount] = useState(0)
  useEffect(() => {
    const fetch = () => {
      api.get<{ total_hoje: number }>('/api/vendas/hoje')
        .then(r => setCount(r.data.total_hoje))
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
  const toast            = useToast()
  const { usuario, logout } = useAuth()
  const navigate         = useNavigate()
  const fluxoAtivo       = useFluxoAtivoCount()
  const reativacao       = useReativacaoCount()
  const vendasHoje       = useVendasHojeCount()
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

  function handleLogout() {
    logout()
    navigate('/login', { replace: true })
  }

  const navItems = [
    { to: '/fluxo-ativo',   label: 'Fluxo Ativo',   Icon: ZapIcon,             badge: fluxoAtivo  > 0 ? fluxoAtivo  : 0 },
    { to: '/reativacao',    label: 'Reativação',    Icon: RotateCcwIcon,       badge: reativacao  > 0 ? Math.min(reativacao, 9999) : 0 },
    { to: '/clientes',      label: 'Clientes',      Icon: UsersIcon,           badge: 0 },
    { to: '/vendas',        label: 'Vendas',        Icon: ShoppingCartIcon,    badge: vendasHoje  > 0 ? vendasHoje  : 0 },
    { to: '/dashboard',     label: 'Dashboard',     Icon: LayoutDashboardIcon, badge: 0 },
    ...(usuario?.perfil === 'admin'
      ? [{ to: '/relatorios', label: 'Relatórios', Icon: BarChart3Icon, badge: 0 }]
      : []),
    { to: '/configuracoes', label: 'Configurações', Icon: SettingsIcon,        badge: 0 },
  ]

  return (
    <aside className="w-60 bg-[#111111] flex flex-col">
      {/* Logo */}
      <div className="h-16 flex items-center gap-3 px-5 border-b border-white/10">
        <img src={logoOgc} alt="OGC" className="w-8 h-8 flex-shrink-0" />
        <span className="text-white font-bold text-base tracking-wide">CRM OGC</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {navItems.map(({ to, label, Icon, badge }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              [
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                isActive
                  ? 'bg-[#D2191F] text-white'
                  : 'text-gray-400 hover:bg-white/8 hover:text-white',
              ].join(' ')
            }
          >
            <Icon className="h-4.5 w-4.5 flex-shrink-0" />
            <span className="flex-1">{label}</span>
            {badge > 0 && (
              <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold bg-white/20 text-white">
                {badge > 99 ? '99+' : badge}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Sync + usuário */}
      <div className="px-4 py-3 border-t border-white/10 space-y-3">
        {/* Última sync */}
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold text-gray-600 uppercase tracking-wide">Última sync</p>
            <p className="text-xs text-gray-500 truncate">
              {emAndamento ? (
                <span className="text-[#D2191F] font-medium">Em andamento...</span>
              ) : (
                tempoPassado(ultimaSync)
              )}
            </p>
          </div>
          <button
            onClick={triggerSync}
            disabled={syncing || emAndamento}
            title="Sincronizar com Hotmart"
            className="p-1.5 rounded-lg text-gray-500 hover:text-white hover:bg-white/10 disabled:opacity-40 transition-colors flex-shrink-0"
          >
            <svg
              className={`w-3.5 h-3.5 ${(syncing || emAndamento) ? 'animate-spin' : ''}`}
              fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>

        {/* Usuário + logout */}
        {usuario && (
          <div className="flex items-center gap-2 pt-1 border-t border-white/10">
            <div className="w-7 h-7 rounded-full bg-[#D2191F] flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
              {usuario.nome.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-white font-medium truncate">{usuario.nome}</p>
              <span className={`text-[10px] font-semibold uppercase tracking-wide ${usuario.perfil === 'admin' ? 'text-[#D2191F]' : 'text-gray-500'}`}>
                {usuario.perfil}
              </span>
            </div>
            <button
              onClick={handleLogout}
              title="Sair"
              className="p-1.5 rounded-lg text-gray-500 hover:text-white hover:bg-white/10 transition-colors flex-shrink-0"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </aside>
  )
}
