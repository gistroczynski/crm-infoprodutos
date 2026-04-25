import { useEffect, useRef, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartTooltip,
  ResponsiveContainer, Legend,
} from 'recharts'
import {
  vendasApi, produtosApi,
  type VendaItem, type VendasHojeResponse,
} from '../services/api'
import type { Produto } from '@crm/shared'
import { useToast } from '../hooks/useToast'
import { syncApi } from '../services/api'

// ── Helpers ─────────────────────────────────────────────────────────────────

const brl = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

function fmtDataHora(iso: string, diasAtras?: number): string {
  const d = new Date(iso)
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  if (diasAtras === 0) return `Hoje ${hora}`
  if (diasAtras === 1) return `Ontem ${hora}`
  return `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })} ${hora}`
}

function fmtEixoX(data: string): string {
  const d = new Date(data + 'T12:00:00')
  return d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit' })
    .replace('.', '')
    .replace('-feira', '')
    .trim()
}

type Periodo = 'hoje' | 'semana' | 'mes' | 'personalizado'

function calcRange(periodo: Periodo): { inicio: string; fim: string } {
  const hoje = new Date()
  const fmt  = (d: Date) => d.toISOString().split('T')[0]
  if (periodo === 'hoje') {
    return { inicio: fmt(hoje), fim: fmt(hoje) }
  }
  if (periodo === 'semana') {
    const ini = new Date(hoje)
    ini.setDate(hoje.getDate() - 6)
    return { inicio: fmt(ini), fim: fmt(hoje) }
  }
  if (periodo === 'mes') {
    const y = hoje.getFullYear()
    const m = String(hoje.getMonth() + 1).padStart(2, '0')
    return { inicio: `${y}-${m}-01`, fim: fmt(hoje) }
  }
  return { inicio: fmt(hoje), fim: fmt(hoje) }
}

// ── Badge tipo produto ───────────────────────────────────────────────────────

function TipoBadge({ tipo, isOrderBump }: { tipo: string; isOrderBump: boolean }) {
  if (isOrderBump || tipo === 'order_bump') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-purple-100 text-purple-700">
        Order Bump
      </span>
    )
  }
  if (tipo === 'upsell') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-green-100 text-green-700">
        Upsell
      </span>
    )
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-100 text-blue-700">
      Entrada
    </span>
  )
}

// ── Variação % ───────────────────────────────────────────────────────────────

function Variacao({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-gray-400 text-xs">—</span>
  const up = pct >= 0
  return (
    <span className={`text-xs font-medium ${up ? 'text-green-600' : 'text-red-500'}`}>
      {up ? '↑' : '↓'} {Math.abs(pct)}%
    </span>
  )
}

// ── Skeleton ─────────────────────────────────────────────────────────────────

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-gray-100 rounded ${className ?? ''}`} />
}

// ── Tooltip customizado do gráfico ───────────────────────────────────────────

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-gray-200 rounded-lg px-3 py-2 shadow text-xs">
      <p className="font-semibold text-gray-700 mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.name} style={{ color: p.color }}>
          {p.name === 'Vendas' ? `${p.value} vendas` : brl(p.value)}
        </p>
      ))}
    </div>
  )
}

// ── Componente principal ────────────────────────────────────────────────────

export default function Vendas() {
  const toast    = useToast()
  const navigate = useNavigate()

  // Período
  const [periodo,    setPeriodo]    = useState<Periodo>('mes')
  const [dataInicio, setDataInicio] = useState(() => calcRange('mes').inicio)
  const [dataFim,    setDataFim]    = useState(() => calcRange('mes').fim)

  // Filtros da tabela
  const [busca,      setBusca]      = useState('')
  const [produtoId,  setProdutoId]  = useState('')
  const [page,       setPage]       = useState(1)

  // Dados
  const [vendas,      setVendas]      = useState<VendaItem[] | null>(null)
  const [totalVendas, setTotalVendas] = useState(0)
  const [totalPages,  setTotalPages]  = useState(1)
  const [porDia,      setPorDia]      = useState<{ data: string; quantidade: number; receita: number }[]>([])
  const [hoje,        setHoje]        = useState<VendasHojeResponse | null>(null)
  const [produtos,    setProdutos]    = useState<Produto[]>([])
  const [loading,       setLoading]       = useState(true)
  const [syncing,           setSyncing]           = useState(false)
  const [syncingFull,       setSyncingFull]       = useState(false)
  const [avisoConexao,      setAvisoConexao]      = useState(false)
  const [modalRecuperacao,  setModalRecuperacao]  = useState(false)
  const [recuperandoPeriodo, setRecuperandoPeriodo] = useState(false)
  const [recInicio,         setRecInicio]         = useState('')
  const [recFim,            setRecFim]            = useState('')

  // Ref estável para toast (evita que toast no dep array cause loop de re-renders)
  const toastRef = useRef(toast)
  useEffect(() => { toastRef.current = toast })

  // Controla se o toast de erro já foi exibido (só mostra 1x por sessão de erro)
  const erroJaMostradoRef = useRef(false)

  // Refs para detecção de nova venda
  const prevTotalHojeRef = useRef<number | null>(null)
  const prevLastVendaRef = useRef<string | null>(null)

  // ── Buscar vendas de hoje (polling silencioso — sem toast em erro) ─────────

  const fetchHoje = useCallback(async (notificar = false) => {
    try {
      const data = await vendasApi.hoje()
      setHoje(data)

      if (notificar && prevTotalHojeRef.current !== null) {
        if (data.total_hoje > prevTotalHojeRef.current) {
          const nova = data.vendas[0]
          if (nova && nova.id !== prevLastVendaRef.current) {
            toastRef.current.success(
              `Nova venda! ${nova.produto_nome} — ${nova.valor ? brl(nova.valor) : ''}`
            )
            prevLastVendaRef.current = nova.id
          }
        }
      }
      prevTotalHojeRef.current = data.total_hoje
    } catch {
      // Polling silencioso — não interrompe o usuário com toast
    }
  }, []) // sem toast no dep array — usa toastRef

  // ── Buscar lista de vendas ────────────────────────────────────────────────

  const fetchVendas = useCallback(async () => {
    setLoading(true)
    try {
      const data = await vendasApi.list({
        inicio:     dataInicio,
        fim:        dataFim,
        page,
        limit:      50,
        produto_id: produtoId || undefined,
        busca:      busca    || undefined,
      })
      setVendas(data.vendas)
      setTotalVendas(data.total)
      setTotalPages(data.total_pages)
      setPorDia(data.resumo.por_dia)
      erroJaMostradoRef.current = false
      setAvisoConexao(false)
    } catch {
      // Mostra toast apenas na primeira falha; polling subsequente apenas ativa o ícone de aviso
      if (!erroJaMostradoRef.current) {
        erroJaMostradoRef.current = true
        toastRef.current.error('Erro ao carregar vendas. Verifique a conexão.')
      }
      setAvisoConexao(true)
    } finally {
      setLoading(false)
    }
  }, [dataInicio, dataFim, page, produtoId, busca]) // sem toast — usa toastRef

  // ── Montar ────────────────────────────────────────────────────────────────

  useEffect(() => {
    produtosApi.list().then(setProdutos).catch(() => {})
    fetchHoje(false)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchVendas()
  }, [fetchVendas])

  // Polling de hoje a cada 2 min
  useEffect(() => {
    const id = setInterval(() => fetchHoje(true), 2 * 60 * 1000)
    return () => clearInterval(id)
  }, [fetchHoje])

  // ── Mudar período ─────────────────────────────────────────────────────────

  function selecionarPeriodo(p: Periodo) {
    setPeriodo(p)
    if (p !== 'personalizado') {
      const { inicio, fim } = calcRange(p)
      setDataInicio(inicio)
      setDataFim(fim)
    }
    setPage(1)
  }

  // ── Helpers de sync ───────────────────────────────────────────────────────

  async function recarregarAposSyncMs(ms: number) {
    await new Promise(r => setTimeout(r, ms))
    const totalAntes = totalVendas
    const [dados] = await Promise.all([
      vendasApi.list({
        inicio: dataInicio, fim: dataFim, page, limit: 50,
        produto_id: produtoId || undefined,
        busca:      busca    || undefined,
      }),
      vendasApi.hoje().then(setHoje).catch(() => {}),
    ])
    setVendas(dados.vendas)
    setTotalVendas(dados.total)
    setTotalPages(dados.total_pages)
    setPorDia(dados.resumo.por_dia)
    erroJaMostradoRef.current = false
    setAvisoConexao(false)
    return dados.total - totalAntes
  }

  // ── Sync incremental ──────────────────────────────────────────────────────

  async function sincronizar() {
    setSyncing(true)
    try {
      await syncApi.manual()
      toastRef.current.info('Sincronizando com Hotmart...')
      const novas = await recarregarAposSyncMs(8000)
      if (novas > 0) {
        toastRef.current.success(
          `Sincronizado! ${novas} nova${novas !== 1 ? 's vendas encontradas' : ' venda encontrada'}.`
        )
      } else {
        toastRef.current.success('Sincronizado! Nenhuma venda nova no período.')
      }
    } catch {
      toastRef.current.error('Falha ao iniciar sincronização.')
    } finally {
      setSyncing(false)
    }
  }

  // ── Sync completo (60 dias) ───────────────────────────────────────────────

  async function sincronizarCompleto() {
    setSyncingFull(true)
    try {
      const resp = await syncApi.completo(60)
      toastRef.current.info(`Sync completo iniciado — buscando desde ${resp.desde}. Pode levar alguns minutos...`)
      // Aguarda mais tempo pois é uma operação mais demorada
      const novas = await recarregarAposSyncMs(20000)
      if (novas > 0) {
        toastRef.current.success(
          `Sync completo! ${novas} nova${novas !== 1 ? 's vendas recuperadas' : ' venda recuperada'}.`
        )
      } else {
        toastRef.current.success('Sync completo! Dados atualizados (nenhuma venda nova no período exibido).')
      }
    } catch {
      toastRef.current.error('Falha ao iniciar sync completo.')
    } finally {
      setSyncingFull(false)
    }
  }

  // ── Recuperar período específico ──────────────────────────────────────────

  async function recuperarPeriodo() {
    if (!recInicio || !recFim) {
      toastRef.current.error('Selecione as datas de início e fim.')
      return
    }
    setRecuperandoPeriodo(true)
    try {
      await syncApi.recuperarPeriodo(recInicio, recFim)
      toastRef.current.info(`Recuperando ${recInicio} → ${recFim}. Pode levar alguns minutos...`)
      setModalRecuperacao(false)
      const novas = await recarregarAposSyncMs(25000)
      if (novas > 0) {
        toastRef.current.success(
          `Recuperado! ${novas} nova${novas !== 1 ? 's vendas encontradas' : ' venda encontrada'}.`
        )
      } else {
        toastRef.current.success('Recuperação concluída. Nenhuma venda nova no período exibido.')
      }
    } catch {
      toastRef.current.error('Falha ao iniciar recuperação.')
    } finally {
      setRecuperandoPeriodo(false)
    }
  }

  function onBuscaChange(v: string) {
    setBusca(v)
    setPage(1)
  }

  // Máximo para barra de progresso do ranking
  const topProdMax = Math.max(...(hoje?.top_produtos.map(t => t.quantidade) ?? [1]), 1)
  const vendasPeriodo = totalVendas

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold text-gray-900">Vendas</h1>
          {avisoConexao && (
            <span
              title="Erro ao carregar dados — tente sincronizar"
              className="flex items-center gap-1 text-xs text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
              Sem dados
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {/* Seletor de período */}
          <div className="flex items-center bg-gray-100 rounded-lg p-0.5 text-sm">
            {(['hoje', 'semana', 'mes'] as Periodo[]).map(p => (
              <button
                key={p}
                onClick={() => selecionarPeriodo(p)}
                className={[
                  'px-3 py-1.5 rounded-md font-medium transition-colors',
                  periodo === p
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700',
                ].join(' ')}
              >
                {p === 'hoje' ? 'Hoje' : p === 'semana' ? 'Esta semana' : 'Este mês'}
              </button>
            ))}
          </div>

          {/* Personalizado */}
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={dataInicio}
              onChange={e => { setDataInicio(e.target.value); setPeriodo('personalizado'); setPage(1) }}
              className="text-xs border border-gray-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            <span className="text-gray-400 text-xs">até</span>
            <input
              type="date"
              value={dataFim}
              onChange={e => { setDataFim(e.target.value); setPeriodo('personalizado'); setPage(1) }}
              className="text-xs border border-gray-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>

          <button
            onClick={sincronizar}
            disabled={syncing || syncingFull}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            <svg
              className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`}
              fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Sincronizar
          </button>

          <button
            onClick={sincronizarCompleto}
            disabled={syncing || syncingFull || recuperandoPeriodo}
            title="Busca vendas dos últimos 60 dias — use quando há gap no histórico"
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-orange-300 text-orange-700 rounded-lg hover:bg-orange-50 disabled:opacity-50 transition-colors"
          >
            <svg
              className={`w-3.5 h-3.5 ${syncingFull ? 'animate-spin' : ''}`}
              fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {syncingFull ? 'Buscando...' : 'Sync 60 dias'}
          </button>

          <button
            onClick={() => setModalRecuperacao(true)}
            disabled={syncing || syncingFull || recuperandoPeriodo}
            title="Recupera vendas de um período específico — use para preencher gaps pontuais"
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-red-300 text-red-700 rounded-lg hover:bg-red-50 disabled:opacity-50 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M9 12h6m-3-3v6m9-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Recuperar período
          </button>
        </div>
      </div>

      {/* ── Modal de recuperação de período ──────────────────────────────────── */}
      {modalRecuperacao && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm mx-4">
            <h2 className="text-base font-semibold text-gray-900 mb-1">Recuperar período específico</h2>
            <p className="text-xs text-gray-500 mb-4">
              Busca todas as vendas da Hotmart no intervalo selecionado e atualiza o banco.
              Útil para preencher gaps de dias faltantes.
            </p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Data início</label>
                <input
                  type="date"
                  value={recInicio}
                  onChange={e => setRecInicio(e.target.value)}
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Data fim</label>
                <input
                  type="date"
                  value={recFim}
                  onChange={e => setRecFim(e.target.value)}
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button
                onClick={() => setModalRecuperacao(false)}
                disabled={recuperandoPeriodo}
                className="flex-1 px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={recuperarPeriodo}
                disabled={recuperandoPeriodo || !recInicio || !recFim}
                className="flex-1 px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                {recuperandoPeriodo ? 'Recuperando...' : 'Recuperar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── SEÇÃO 1: Cards do dia (sempre Hoje) ────────────────────────────── */}
      <div className="grid grid-cols-4 gap-4">

        {/* Vendas hoje */}
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">Vendas hoje</p>
          {hoje === null ? (
            <Skeleton className="h-8 w-16 mb-1" />
          ) : (
            <p className="text-3xl font-bold text-gray-900">{hoje.total_hoje}</p>
          )}
          <div className="mt-1">
            <Variacao pct={hoje?.comparacao_ontem.variacao_vendas_pct ?? null} />
            <span className="text-[10px] text-gray-400 ml-1">vs ontem ({hoje?.comparacao_ontem.total_ontem ?? '—'})</span>
          </div>
        </div>

        {/* Receita hoje */}
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">Receita hoje</p>
          {hoje === null ? (
            <Skeleton className="h-8 w-28 mb-1" />
          ) : (
            <p className="text-2xl font-bold text-gray-900">{brl(hoje.receita_hoje)}</p>
          )}
          <div className="mt-1">
            <Variacao pct={hoje?.comparacao_ontem.variacao_receita_pct ?? null} />
            <span className="text-[10px] text-gray-400 ml-1">vs ontem</span>
          </div>
        </div>

        {/* Ticket médio hoje */}
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">Ticket médio hoje</p>
          {hoje === null ? (
            <Skeleton className="h-8 w-24 mb-1" />
          ) : (
            <p className="text-2xl font-bold text-gray-900">{brl(hoje.ticket_hoje)}</p>
          )}
          <p className="text-[10px] text-gray-400 mt-1">por venda</p>
        </div>

        {/* Vendas no período */}
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">
            Vendas no período
          </p>
          {loading && vendas === null ? (
            <Skeleton className="h-8 w-16 mb-1" />
          ) : (
            <p className="text-3xl font-bold text-gray-900">{vendasPeriodo}</p>
          )}
          <p className="text-[10px] text-gray-400 mt-1">
            {periodo === 'hoje' ? 'hoje' : periodo === 'semana' ? 'últimos 7 dias' : periodo === 'mes' ? 'este mês' : `${dataInicio} → ${dataFim}`}
          </p>
        </div>
      </div>

      {/* ── SEÇÃO 2 + 4: Gráfico + Mini ranking lado a lado ─────────────────── */}
      <div className="grid grid-cols-3 gap-4">

        {/* Gráfico (2/3) */}
        <div className="col-span-2 bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-sm font-semibold text-gray-800 mb-4">Vendas por dia</p>
          {loading && porDia.length === 0 ? (
            <Skeleton className="h-48 w-full" />
          ) : porDia.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-sm text-gray-400">
              Nenhuma venda neste período.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={porDia} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barGap={4}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                <XAxis
                  dataKey="data"
                  tickFormatter={fmtEixoX}
                  tick={{ fontSize: 10, fill: '#9ca3af' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  yAxisId="qty"
                  orientation="left"
                  tick={{ fontSize: 10, fill: '#9ca3af' }}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                />
                <YAxis
                  yAxisId="rec"
                  orientation="right"
                  tickFormatter={v => `R$${(v / 1000).toFixed(0)}k`}
                  tick={{ fontSize: 10, fill: '#9ca3af' }}
                  axisLine={false}
                  tickLine={false}
                />
                <RechartTooltip content={<ChartTooltip />} />
                <Legend
                  iconType="circle"
                  iconSize={8}
                  wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
                />
                <Bar yAxisId="qty" dataKey="quantidade" name="Vendas"  fill="#3b82f6" radius={[3, 3, 0, 0]} maxBarSize={32} />
                <Bar yAxisId="rec" dataKey="receita"    name="Receita" fill="#10b981" radius={[3, 3, 0, 0]} maxBarSize={32} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Mini ranking (1/3) */}
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-sm font-semibold text-gray-800 mb-3">Top produtos hoje</p>
          {hoje === null ? (
            <div className="space-y-3">
              {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : hoje.top_produtos.length === 0 ? (
            <p className="text-sm text-gray-400 mt-4 text-center">Nenhuma venda hoje ainda.</p>
          ) : (
            <div className="space-y-3">
              {hoje.top_produtos.map((p, i) => (
                <div key={p.nome}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-gray-700 font-medium truncate max-w-[130px]" title={p.nome}>
                      {i + 1}. {p.nome}
                    </span>
                    <span className="text-gray-500 flex-shrink-0 ml-1">{p.quantidade}x</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary-500 rounded-full"
                        style={{ width: `${Math.round((p.quantidade / topProdMax) * 100)}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-gray-500 flex-shrink-0 w-16 text-right">
                      {brl(p.receita)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── SEÇÃO 3: Tabela de vendas ────────────────────────────────────────── */}
      <div className="bg-white border border-gray-200 rounded-xl">
        {/* Filtros */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
          <div className="relative flex-1 max-w-xs">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400"
              fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
            </svg>
            <input
              type="text"
              placeholder="Buscar por nome ou e-mail..."
              value={busca}
              onChange={e => onBuscaChange(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>

          <select
            value={produtoId}
            onChange={e => { setProdutoId(e.target.value); setPage(1) }}
            className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <option value="">Todos os produtos</option>
            {produtos.map(p => (
              <option key={p.id} value={p.id}>{p.nome}</option>
            ))}
          </select>

          <span className="ml-auto text-xs text-gray-400">{totalVendas} vendas</span>
        </div>

        {/* Tabela */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Data/Hora</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Cliente</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Produto</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Tipo</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Valor</th>
                <th className="px-4 py-2.5 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading && vendas === null ? (
                [...Array(8)].map((_, i) => (
                  <tr key={i}>
                    {[...Array(6)].map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <Skeleton className="h-4 w-full" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : vendas?.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-gray-400">
                    Nenhuma venda encontrada para este período.
                  </td>
                </tr>
              ) : (
                vendas?.map(v => (
                  <tr key={v.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                      {fmtDataHora(v.data_compra, v.dias_atras)}
                    </td>
                    <td className="px-4 py-3 max-w-[200px]">
                      <p className="font-medium text-gray-900 truncate">{v.cliente_nome}</p>
                      <p className="text-xs text-gray-400 truncate">{v.cliente_email}</p>
                    </td>
                    <td className="px-4 py-3 max-w-[180px]">
                      <p className="text-gray-700 truncate" title={v.produto_nome}>{v.produto_nome}</p>
                    </td>
                    <td className="px-4 py-3">
                      <TipoBadge tipo={v.produto_tipo} isOrderBump={v.is_order_bump} />
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-gray-900 whitespace-nowrap">
                      {v.valor !== null ? brl(v.valor) : '—'}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => navigate(`/clientes/${v.cliente_id}`)}
                        className="text-xs text-primary-600 hover:text-primary-800 hover:underline"
                      >
                        Ver perfil
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Paginação */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
            <p className="text-xs text-gray-400">
              Página {page} de {totalPages}
            </p>
            <div className="flex gap-1">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1 text-xs border border-gray-200 rounded hover:bg-gray-50 disabled:opacity-40"
              >
                Anterior
              </button>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1 text-xs border border-gray-200 rounded hover:bg-gray-50 disabled:opacity-40"
              >
                Próxima
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
