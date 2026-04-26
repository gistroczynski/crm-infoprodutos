import { useCallback, useEffect, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useToast } from '../../hooks/useToast'
import { useAuth } from '../../contexts/AuthContext'
import { useDarkMode } from '../../hooks/useDarkMode'
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
  SunIcon,
  MoonIcon,
  LogOutIcon,
  RefreshCwIcon,
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
      api.get<{ limite_diario: number }>('/api/reativacao/stats')
        .then(r => setCount(r.data.limite_diario))
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
  const [ultimaSync,  setUltimaSync]  = useState<string | null>(null)
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
  if (min < 1)  return 'agora'
  if (min < 60) return `${min} min atrás`
  const h = Math.floor(min / 60)
  if (h < 24)   return `${h}h atrás`
  return `${Math.floor(h / 24)}d atrás`
}

// ── Botão de ação no rodapé ─────────────────────────────────────────────────

function FooterBtn({
  onClick, disabled = false, title, children,
}: {
  onClick: () => void; disabled?: boolean; title: string; children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-500
                 hover:text-white hover:bg-white/10 disabled:opacity-40 transition-colors flex-shrink-0"
    >
      {children}
    </button>
  )
}

// ── Componente principal ────────────────────────────────────────────────────

export default function Sidebar() {
  const toast              = useToast()
  const { usuario, logout } = useAuth()
  const navigate            = useNavigate()
  const { dark, toggle }    = useDarkMode()
  const fluxoAtivo          = useFluxoAtivoCount()
  const reativacao          = useReativacaoCount()
  const vendasHoje          = useVendasHojeCount()
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
    { to: '/fluxo-ativo',   label: 'Fluxo Ativo',   Icon: ZapIcon,             badge: fluxoAtivo > 0 ? fluxoAtivo : 0 },
    { to: '/reativacao',    label: 'Reativação',    Icon: RotateCcwIcon,       badge: reativacao > 0 ? Math.min(reativacao, 9999) : 0 },
    { to: '/clientes',      label: 'Clientes',      Icon: UsersIcon,           badge: 0 },
    { to: '/vendas',        label: 'Vendas',        Icon: ShoppingCartIcon,    badge: vendasHoje > 0 ? vendasHoje : 0 },
    { to: '/dashboard',     label: 'Dashboard',     Icon: LayoutDashboardIcon, badge: 0 },
    ...(usuario?.perfil === 'admin'
      ? [{ to: '/relatorios', label: 'Relatórios', Icon: BarChart3Icon, badge: 0 }]
      : []),
    { to: '/configuracoes', label: 'Configurações', Icon: SettingsIcon, badge: 0 },
  ]

  return (
    <aside
      className="flex flex-col bg-[#111111] flex-shrink-0"
      style={{ width: 240 }}
    >
      {/* ── Logo ── */}
      <div className="flex items-center gap-3 px-4 border-b border-white/10 flex-shrink-0" style={{ height: 56 }}>
        <img src={logoOgc} alt="OGC" style={{ width: 32, height: 32, flexShrink: 0 }} />
        <span className="text-white font-bold text-sm tracking-wide leading-none">CRM OGC</span>
      </div>

      {/* ── Navegação ── */}
      <nav className="flex-1 overflow-y-auto px-2 py-3" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {navItems.map(({ to, label, Icon, badge }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              [
                'flex items-center gap-3 rounded-lg font-medium transition-colors',
                isActive
                  ? 'bg-[#D2191F] text-white'
                  : 'text-gray-400 hover:bg-white/10 hover:text-white',
              ].join(' ')
            }
            style={{ height: 44, paddingLeft: 16, paddingRight: 12, fontSize: 14 }}
          >
            <Icon style={{ width: 20, height: 20, flexShrink: 0 }} />
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {label}
            </span>
            {badge > 0 && (
              <span
                className="inline-flex items-center justify-center rounded-full font-bold bg-white/20 text-white flex-shrink-0"
                style={{ minWidth: 18, height: 18, padding: '0 4px', fontSize: 10 }}
              >
                {badge > 99 ? '99+' : badge}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      {/* ── Rodapé ── */}
      <div className="border-t border-white/10 flex-shrink-0 px-3 py-3 space-y-2">

        {/* Linha: última sync */}
        <div className="flex items-center justify-between">
          <div className="min-w-0 flex-1">
            <p className="text-gray-600 font-semibold uppercase tracking-wide" style={{ fontSize: 10 }}>
              Última sync
            </p>
            <p className="text-gray-500 truncate" style={{ fontSize: 11 }}>
              {emAndamento
                ? <span className="text-[#D2191F] font-medium">Em andamento...</span>
                : tempoPassado(ultimaSync)
              }
            </p>
          </div>
          <FooterBtn
            onClick={triggerSync}
            disabled={syncing || emAndamento}
            title="Sincronizar com Hotmart"
          >
            <RefreshCwIcon
              style={{ width: 14, height: 14 }}
              className={syncing || emAndamento ? 'animate-spin' : ''}
            />
          </FooterBtn>
        </div>

        {/* Linha: usuário + dark mode + logout */}
        {usuario && (
          <div className="flex items-center gap-2 pt-2 border-t border-white/10">
            {/* Avatar */}
            <div
              className="rounded-full bg-[#D2191F] flex items-center justify-center text-white font-bold flex-shrink-0"
              style={{ width: 28, height: 28, fontSize: 12 }}
            >
              {usuario.nome.charAt(0).toUpperCase()}
            </div>

            {/* Nome + badge perfil */}
            <div className="flex-1 min-w-0">
              <p className="text-white font-medium truncate" style={{ fontSize: 12 }}>
                {usuario.nome}
              </p>
              <span
                className={[
                  'inline-block rounded font-semibold uppercase tracking-wide px-1',
                  usuario.perfil === 'admin'
                    ? 'bg-[#D2191F]/20 text-[#D2191F]'
                    : 'bg-white/10 text-gray-400',
                ].join(' ')}
                style={{ fontSize: 9, lineHeight: '14px' }}
              >
                {usuario.perfil}
              </span>
            </div>

            {/* Toggle dark mode */}
            <FooterBtn onClick={toggle} title={dark ? 'Modo claro' : 'Modo escuro'}>
              {dark
                ? <SunIcon  style={{ width: 14, height: 14 }} />
                : <MoonIcon style={{ width: 14, height: 14 }} />
              }
            </FooterBtn>

            {/* Logout */}
            <FooterBtn onClick={handleLogout} title="Sair">
              <LogOutIcon style={{ width: 14, height: 14 }} />
            </FooterBtn>
          </div>
        )}
      </div>
    </aside>
  )
}
