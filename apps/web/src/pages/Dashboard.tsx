import { useEffect, useRef, useState, useCallback } from 'react'
import {
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart, Brush,
} from 'recharts'
import { dashboardApi, type DashboardResumo, type DashboardFunil, type EvolucaoDia } from '../services/api'

// ── Helpers ────────────────────────────────────────────────────────────────

function brl(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function hoje() {
  return new Date().toLocaleDateString('pt-BR', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).split('/').reverse().join('-')
}

function mesAtual(): { inicio: string; fim: string } {
  const parts = new Date().toLocaleDateString('pt-BR', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).split('/')
  const y = Number(parts[2])
  const m = Number(parts[1])
  const ld = new Date(y, m, 0).getDate()
  const ms = String(m).padStart(2, '0')
  return { inicio: `${y}-${ms}-01`, fim: `${y}-${ms}-${String(ld).padStart(2, '0')}` }
}

function fmt(iso: string) {
  return new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: 'short', year: 'numeric',
  })
}

function fmtPeriodo(inicio: string, fim: string) {
  const tz = { timeZone: 'America/Sao_Paulo' } as const
  if (inicio === fim) return fmt(inicio)
  const i = new Date(inicio + 'T12:00:00')
  const f = new Date(fim    + 'T12:00:00')
  if (i.getMonth() === f.getMonth() && i.getFullYear() === f.getFullYear()) {
    return i.toLocaleDateString('pt-BR', { ...tz, month: 'long', year: 'numeric' })
  }
  if (i.getFullYear() === f.getFullYear() && i.getMonth() === 0 && f.getMonth() === 11) {
    return String(i.getFullYear())
  }
  return `${fmt(inicio)} – ${fmt(fim)}`
}

// ── DateRangePicker ────────────────────────────────────────────────────────

type Modo = 'dia' | 'mes' | 'ano' | 'personalizado'

interface DateRange { inicio: string; fim: string }

const MODOS: { id: Modo; label: string }[] = [
  { id: 'dia',          label: 'Dia'          },
  { id: 'mes',          label: 'Mês'          },
  { id: 'ano',          label: 'Ano'          },
  { id: 'personalizado',label: 'Personalizado' },
]

const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
               'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']

function DateRangePicker({ value, onChange }: { value: DateRange; onChange: (r: DateRange) => void }) {
  const now = new Date()
  const [modo, setModo] = useState<Modo>('mes')

  // Estado interno para cada modo
  const [dia,        setDia]        = useState(hoje())
  const [mes,        setMes]        = useState(now.getMonth())
  const [anoMes,     setAnoMes]     = useState(now.getFullYear())
  const [ano,        setAno]        = useState(now.getFullYear())
  const [inicio,     setInicio]     = useState(value.inicio)
  const [fim,        setFim]        = useState(value.fim)

  function emitMes(m: number, a: number) {
    const ini = `${a}-${String(m + 1).padStart(2, '0')}-01`
    const ld  = new Date(a, m + 1, 0).getDate()
    const f   = `${a}-${String(m + 1).padStart(2, '0')}-${String(ld).padStart(2, '0')}`
    onChange({ inicio: ini, fim: f })
  }

  function emitAno(a: number) {
    onChange({ inicio: `${a}-01-01`, fim: `${a}-12-31` })
  }

  function handleModoChange(m: Modo) {
    setModo(m)
    if (m === 'dia')  onChange({ inicio: dia,  fim: dia  })
    if (m === 'mes')  emitMes(mes, anoMes)
    if (m === 'ano')  emitAno(ano)
    if (m === 'personalizado') onChange({ inicio, fim })
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Seletores de modo */}
      <div className="flex rounded-lg border border-gray-200 overflow-hidden bg-white shrink-0">
        {MODOS.map(m => (
          <button
            key={m.id}
            onClick={() => handleModoChange(m.id)}
            className={[
              'px-3.5 py-1.5 text-sm font-medium transition-colors border-r border-gray-200 last:border-r-0',
              modo === m.id
                ? 'bg-primary-600 text-white'
                : 'text-gray-600 hover:bg-gray-50',
            ].join(' ')}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Inputs por modo */}
      {modo === 'dia' && (
        <input
          type="date"
          value={dia}
          max={hoje()}
          onChange={e => { setDia(e.target.value); onChange({ inicio: e.target.value, fim: e.target.value }) }}
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
      )}

      {modo === 'mes' && (
        <div className="flex items-center gap-2">
          <select
            value={mes}
            onChange={e => { const nm = Number(e.target.value); setMes(nm); emitMes(nm, anoMes) }}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            {MESES.map((n, i) => <option key={i} value={i}>{n}</option>)}
          </select>
          <input
            type="number"
            value={anoMes}
            min={2020}
            max={now.getFullYear()}
            onChange={e => { const na = Number(e.target.value); setAnoMes(na); emitMes(mes, na) }}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm w-20 focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>
      )}

      {modo === 'ano' && (
        <input
          type="number"
          value={ano}
          min={2020}
          max={now.getFullYear()}
          onChange={e => { const na = Number(e.target.value); setAno(na); emitAno(na) }}
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm w-24 focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
      )}

      {modo === 'personalizado' && (
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={inicio}
            max={fim}
            onChange={e => { setInicio(e.target.value); onChange({ inicio: e.target.value, fim }) }}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          <span className="text-gray-400 text-sm">até</span>
          <input
            type="date"
            value={fim}
            min={inicio}
            max={hoje()}
            onChange={e => { setFim(e.target.value); onChange({ inicio, fim: e.target.value }) }}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>
      )}

      {/* Resumo textual */}
      <span className="text-sm text-gray-500 shrink-0">
        {fmtPeriodo(value.inicio, value.fim)}
      </span>
    </div>
  )
}

// ── Count-up hook ──────────────────────────────────────────────────────────

function useCountUp(target: number, duration = 900): number {
  const [current, setCurrent] = useState(0)
  const prevTarget = useRef<number>(0)

  useEffect(() => {
    if (target === prevTarget.current) return
    prevTarget.current = target
    if (target === 0) { setCurrent(0); return }

    const start = performance.now()
    const from  = 0

    function step(now: number) {
      const elapsed  = now - start
      const t        = Math.min(elapsed / duration, 1)
      const eased    = 1 - Math.pow(1 - t, 3)          // easeOutCubic
      setCurrent(Math.round(from + (target - from) * eased))
      if (t < 1) requestAnimationFrame(step)
    }

    requestAnimationFrame(step)
  }, [target, duration])

  return current
}

// ── MetricCard ─────────────────────────────────────────────────────────────

function MetricCard({
  label, value, sub, icon, color = 'text-primary-600', rawValue, format,
}: {
  label: string; value: string; sub?: string; icon: React.ReactNode; color?: string
  rawValue?: number; format?: (n: number) => string
}) {
  const animated = useCountUp(rawValue ?? 0)
  const displayed = rawValue !== undefined && format ? format(animated) : value

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{label}</span>
        <span className={`${color} opacity-80`}>{icon}</span>
      </div>
      <div>
        <p className="text-3xl font-bold text-gray-900 leading-none">{displayed}</p>
        {sub && <p className="text-xs text-gray-400 mt-1.5">{sub}</p>}
      </div>
    </div>
  )
}

// ── Funil ──────────────────────────────────────────────────────────────────

function FunilBlock({ label, clientes, receita, taxa, color }: {
  label: string; clientes: number; receita: number; taxa?: number; color: string
}) {
  return (
    <div className={`flex-1 rounded-xl border-2 ${color} p-4 min-w-0`}>
      <p className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-1">{label}</p>
      <p className="text-2xl font-bold text-gray-900">{clientes.toLocaleString('pt-BR')}</p>
      <p className="text-xs text-gray-500 mt-0.5">clientes</p>
      <p className="text-sm font-semibold text-gray-700 mt-2">{brl(receita)}</p>
      {taxa !== undefined && (
        <span className="mt-2 inline-block text-xs bg-white border border-gray-200 rounded-full px-2 py-0.5 font-semibold text-gray-600">
          {taxa}% de conversão
        </span>
      )}
    </div>
  )
}

// ── Tooltip do gráfico ─────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  const dateStr = new Date(label + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 text-sm">
      <p className="text-gray-500 mb-1">{dateStr}</p>
      <p className="font-semibold text-gray-900">{brl(payload[0]?.value ?? 0)}</p>
      <p className="text-gray-500">{payload[1]?.value ?? 0} compras</p>
    </div>
  )
}

function Sk({ cls }: { cls: string }) {
  return <div className={`bg-gray-200 animate-pulse rounded ${cls}`} />
}

// ── Dashboard ──────────────────────────────────────────────────────────────

export default function Dashboard() {
  const defaultRange = mesAtual()
  const [range,   setRange]   = useState<DateRange>(defaultRange)
  const [resumo,  setResumo]  = useState<DashboardResumo | null>(null)
  const [funil,   setFunil]   = useState<DashboardFunil  | null>(null)
  const [evolucao,setEvolucao]= useState<EvolucaoDia[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  const carregar = useCallback((r: DateRange) => {
    setLoading(true)
    setError(null)
    Promise.all([
      dashboardApi.resumo(r.inicio, r.fim),
      dashboardApi.funil(r.inicio, r.fim),
      dashboardApi.evolucao(r.inicio, r.fim),
    ])
      .then(([res, fun, evo]) => { setResumo(res); setFunil(fun); setEvolucao(evo) })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { carregar(range) }, [range, carregar])

  const totalReceita = resumo?.faturamento_total ?? 1

  return (
    <div className="space-y-5">

      {/* ── Header + Filtro de data ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <DateRangePicker value={range} onChange={setRange} />
      </div>

      {error && (
        <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          Erro ao carregar dados: {error}
        </div>
      )}

      {/* ── Linha 1: 4 Metric Cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {loading
          ? Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
                <Sk cls="h-3 w-24" /><Sk cls="h-8 w-32" /><Sk cls="h-3 w-20" />
              </div>
            ))
          : <>
              {/* ── Card Faturamento BRL + USD ── */}
              <div className="bg-white rounded-xl border border-gray-200 p-5 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Faturamento no Período</span>
                  <span className="text-emerald-600 opacity-80">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-2.21 0-4 .895-4 2s1.79 2 4 2 4 .895 4 2-1.79 2-4 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  </span>
                </div>
                <div className="flex items-stretch gap-0 min-w-0">
                  {/* BRL */}
                  <div className="flex-1 min-w-0">
                    <p className="text-2xl font-bold text-gray-900 leading-none truncate">
                      {brl(resumo?.faturamento_brl ?? resumo?.faturamento_total ?? 0)}
                    </p>
                    <p className="text-xs text-gray-400 mt-1.5">Receita Líquida BRL</p>
                  </div>
                  {/* Divisória + USD — só exibe se USD > 0 */}
                  {(resumo?.faturamento_usd ?? 0) > 0 && (
                    <>
                      <div className="w-px bg-gray-200 mx-3 self-stretch" />
                      <div className="shrink-0">
                        <p className="text-base font-semibold text-gray-700 leading-none">
                          {(resumo?.faturamento_usd ?? 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
                        </p>
                        <p className="text-xs text-gray-400 mt-1.5">Receita Líquida USD</p>
                      </div>
                    </>
                  )}
                </div>
                <p className="text-xs text-gray-400">{resumo?.total_compras ?? 0} compras no período</p>
              </div>
              <MetricCard
                label="Ticket Médio"
                value={brl(resumo?.ticket_medio ?? 0)}
                rawValue={resumo?.ticket_medio ?? 0}
                format={n => brl(n)}
                sub="por compra no período"
                color="text-blue-600"
                icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 11h.01M12 11h.01M15 11h.01M4 19h16a2 2 0 002-2V7a2 2 0 00-2-2H4a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>}
              />
              <MetricCard
                label="Taxa de Ascensão"
                value={`${resumo?.taxa_ascensao ?? 0}%`}
                rawValue={resumo?.taxa_ascensao ?? 0}
                format={n => `${n}%`}
                sub={`${resumo?.clientes_com_principal ?? 0} clientes com principal`}
                color="text-violet-600"
                icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>}
              />
              <MetricCard
                label="Clientes na Base"
                value={(resumo?.total_clientes ?? 0).toLocaleString('pt-BR')}
                rawValue={resumo?.total_clientes ?? 0}
                format={n => n.toLocaleString('pt-BR')}
                sub="total acumulado"
                color="text-amber-600"
                icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>}
              />
            </>
        }
      </div>

      {/* ── Linha 2: Funil ── */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-4">Funil de Conversão</h2>
        {loading
          ? <div className="flex gap-3">{Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex-1 rounded-xl border-2 border-gray-100 p-4 space-y-2">
                <Sk cls="h-3 w-16" /><Sk cls="h-8 w-12" /><Sk cls="h-3 w-24" />
              </div>
            ))}</div>
          : funil && (
            <div className="flex items-center gap-2 min-w-0">
              <FunilBlock label="Entrada"    clientes={funil.entrada.total_clientes}    receita={funil.entrada.receita}    color="border-blue-200 bg-blue-50" />
              <div className="text-gray-300 text-2xl shrink-0">→</div>
              <FunilBlock label="Order Bump" clientes={funil.order_bump.total_clientes} receita={funil.order_bump.receita} taxa={funil.order_bump.taxa_conversao_de_entrada} color="border-amber-200 bg-amber-50" />
              <div className="text-gray-300 text-2xl shrink-0">→</div>
              <FunilBlock label="Upsell"     clientes={funil.upsell.total_clientes}     receita={funil.upsell.receita}     taxa={funil.upsell.taxa_conversao_de_entrada}     color="border-emerald-200 bg-emerald-50" />
            </div>
          )
        }
      </div>

      {/* ── Linha 3: Gráfico ── */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-4">Receita por Dia</h2>
        {loading
          ? <Sk cls="h-52 w-full" />
          : <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={evolucao} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="receitaGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#6366f1" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0}    />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis
                  dataKey="data"
                  tick={{ fontSize: 10, fill: '#9ca3af' }}
                  tickFormatter={d => new Date(d + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
                  interval={Math.max(0, Math.floor(evolucao.length / 7) - 1)}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: '#9ca3af' }}
                  tickFormatter={v => v >= 1000 ? `R$${(v/1000).toFixed(0)}k` : `R$${v}`}
                  width={56}
                />
                <Tooltip content={<ChartTooltip />} />
                <Area type="monotone" dataKey="receita" stroke="#6366f1" strokeWidth={2}
                  fill="url(#receitaGrad)" dot={false} activeDot={{ r: 4 }} />
                {evolucao.length > 14 && (
                  <Brush
                    dataKey="data"
                    height={20}
                    stroke="#e5e7eb"
                    travellerWidth={6}
                    tickFormatter={d => new Date(d + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
                  />
                )}
              </AreaChart>
            </ResponsiveContainer>
        }
      </div>

      {/* ── Linha 4: Top Produtos ── */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Top Produtos</h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="text-left px-5 py-2.5 text-xs font-medium text-gray-500 uppercase">Produto</th>
              <th className="text-left px-5 py-2.5 text-xs font-medium text-gray-500 uppercase">Tipo</th>
              <th className="text-right px-5 py-2.5 text-xs font-medium text-gray-500 uppercase">Vendas</th>
              <th className="text-right px-5 py-2.5 text-xs font-medium text-gray-500 uppercase">Receita</th>
              <th className="text-right px-5 py-2.5 text-xs font-medium text-gray-500 uppercase">% total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>{Array.from({ length: 5 }).map((__, j) => (
                    <td key={j} className="px-5 py-3"><Sk cls="h-3 w-full" /></td>
                  ))}</tr>
                ))
              : (resumo?.receita_por_produto ?? []).map(p => {
                  const pctVal = totalReceita > 0 ? Math.round((p.receita / totalReceita) * 100) : 0
                  const tipoColor: Record<string, string> = {
                    entrada:    'bg-blue-100 text-blue-700',
                    order_bump: 'bg-amber-100 text-amber-700',
                    upsell:     'bg-violet-100 text-violet-700',
                    principal:  'bg-emerald-100 text-emerald-700',
                  }
                  return (
                    <tr key={p.produto_id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-5 py-3 font-medium text-gray-900 max-w-[220px] truncate" title={p.nome}>{p.nome}</td>
                      <td className="px-5 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${tipoColor[p.tipo] ?? 'bg-gray-100 text-gray-600'}`}>
                          {p.tipo}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right text-gray-700">{p.total_vendas}</td>
                      <td className="px-5 py-3 text-right font-semibold text-gray-900">{brl(p.receita)}</td>
                      <td className="px-5 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full bg-primary-500 rounded-full" style={{ width: `${pctVal}%` }} />
                          </div>
                          <span className="text-xs text-gray-500 w-7 text-right">{pctVal}%</span>
                        </div>
                      </td>
                    </tr>
                  )
                })
            }
          </tbody>
        </table>
        {!loading && (resumo?.receita_por_produto ?? []).length === 0 && (
          <p className="text-center py-10 text-gray-400 text-sm">Sem vendas no período selecionado.</p>
        )}
      </div>
    </div>
  )
}
