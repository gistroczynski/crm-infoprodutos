import { useEffect, useState, useCallback } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, Legend,
} from 'recharts'
import {
  relatoriosApi,
  type RelatorioAscensao,
  type RelatorioFunil,
  type RelatorioPerformanceLista,
  type RelatorioProdutos,
} from '../services/api'

// ── Helpers ────────────────────────────────────────────────────────────────

function brl(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function hoje() { return new Date().toISOString().slice(0, 10) }

function mesAtual(): DateRange {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const ld = new Date(y, now.getMonth() + 1, 0).getDate()
  return { inicio: `${y}-${m}-01`, fim: `${y}-${m}-${String(ld).padStart(2, '0')}` }
}

function semanaAtual(): DateRange {
  const now = new Date()
  const dow = now.getDay() === 0 ? 6 : now.getDay() - 1 // Monday = 0
  const mon = new Date(now); mon.setDate(now.getDate() - dow)
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6)
  return {
    inicio: mon.toISOString().slice(0, 10),
    fim:    sun.toISOString().slice(0, 10),
  }
}

function anoAtual(): DateRange {
  const y = new Date().getFullYear()
  return { inicio: `${y}-01-01`, fim: `${y}-12-31` }
}

function fmtPeriodo(inicio: string, fim: string) {
  const fmt = (s: string) => new Date(s + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
  if (inicio === fim) return fmt(inicio)
  const i = new Date(inicio + 'T12:00:00')
  const f = new Date(fim    + 'T12:00:00')
  if (i.getMonth() === f.getMonth() && i.getFullYear() === f.getFullYear())
    return i.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
  if (i.getMonth() === 0 && f.getMonth() === 11 && i.getFullYear() === f.getFullYear())
    return String(i.getFullYear())
  return `${fmt(inicio)} – ${fmt(fim)}`
}

// CSV export (sem dependências externas)
function exportarCsv(rows: Record<string, unknown>[], filename: string) {
  if (!rows.length) return
  const escapar = (v: unknown) => {
    const s = String(v ?? '')
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"` : s
  }
  const headers = Object.keys(rows[0])
  const linhas  = [
    headers.join(','),
    ...rows.map(r => headers.map(h => escapar(r[h])).join(',')),
  ].join('\n')
  const blob = new Blob(['\uFEFF' + linhas], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

// ── Skeleton ───────────────────────────────────────────────────────────────

function Sk({ cls }: { cls: string }) {
  return <div className={`bg-gray-200 animate-pulse rounded ${cls}`} />
}

// ── DateRangePicker ────────────────────────────────────────────────────────

type Modo = 'hoje' | 'semana' | 'mes' | 'ano' | 'personalizado'
interface DateRange { inicio: string; fim: string }

const MODOS: { id: Modo; label: string }[] = [
  { id: 'hoje',         label: 'Hoje'           },
  { id: 'semana',       label: 'Esta semana'     },
  { id: 'mes',          label: 'Este mês'        },
  { id: 'ano',          label: 'Este ano'        },
  { id: 'personalizado',label: 'Personalizado'   },
]

function DateRangePicker({ value, onChange }: { value: DateRange; onChange: (r: DateRange) => void }) {
  const [modo, setModo]     = useState<Modo>('mes')
  const [inicio, setInicio] = useState(value.inicio)
  const [fim,    setFim]    = useState(value.fim)

  function handleModo(m: Modo) {
    setModo(m)
    if (m === 'hoje')    onChange({ inicio: hoje(), fim: hoje() })
    if (m === 'semana')  onChange(semanaAtual())
    if (m === 'mes')     onChange(mesAtual())
    if (m === 'ano')     onChange(anoAtual())
    if (m === 'personalizado') onChange({ inicio, fim })
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex rounded-lg border border-gray-200 overflow-hidden bg-white shrink-0">
        {MODOS.map(m => (
          <button
            key={m.id}
            onClick={() => handleModo(m.id)}
            className={[
              'px-3 py-1.5 text-sm font-medium transition-colors border-r border-gray-200 last:border-r-0',
              modo === m.id ? 'bg-primary-600 text-white' : 'text-gray-600 hover:bg-gray-50',
            ].join(' ')}
          >
            {m.label}
          </button>
        ))}
      </div>

      {modo === 'personalizado' && (
        <div className="flex items-center gap-2">
          <input type="date" value={inicio} max={fim}
            onChange={e => { setInicio(e.target.value); onChange({ inicio: e.target.value, fim }) }}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          <span className="text-gray-400 text-sm">até</span>
          <input type="date" value={fim} min={inicio} max={hoje()}
            onChange={e => { setFim(e.target.value); onChange({ inicio, fim: e.target.value }) }}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>
      )}

      <span className="text-sm text-gray-500 shrink-0">{fmtPeriodo(value.inicio, value.fim)}</span>
    </div>
  )
}

// ── MetricCard ─────────────────────────────────────────────────────────────

function MetricCard({ label, value, sub, color = 'text-primary-600', icon }: {
  label: string; value: string | number; sub?: string; color?: string; icon?: React.ReactNode
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{label}</span>
        {icon && <span className={`${color} opacity-70`}>{icon}</span>}
      </div>
      <p className={`text-3xl font-bold ${color}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400">{sub}</p>}
    </div>
  )
}

// ── Tipo badge ─────────────────────────────────────────────────────────────

const tipoColors: Record<string, string> = {
  entrada:    'bg-blue-100 text-blue-700',
  order_bump: 'bg-amber-100 text-amber-700',
  upsell:     'bg-violet-100 text-violet-700',
  principal:  'bg-emerald-100 text-emerald-700',
}

const tipoLabel: Record<string, string> = {
  entrada: 'Entrada', order_bump: 'Order Bump', upsell: 'Upsell', principal: 'Upsell',
}

const prioColors: Record<string, string> = {
  alta:  'bg-red-100 text-red-700',
  media: 'bg-amber-100 text-amber-700',
  baixa: 'bg-gray-100 text-gray-600',
}

// ── Aba Ascensão ───────────────────────────────────────────────────────────

function AbaAscensao({ range }: { range: DateRange }) {
  const [data, setData]     = useState<RelatorioAscensao | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    relatoriosApi.ascensao(range.inicio, range.fim)
      .then(setData).finally(() => setLoading(false))
  }, [range.inicio, range.fim])

  function exportar() {
    if (!data) return
    exportarCsv(data.ascensoes_por_semana, `relatorio_ascensao_${range.inicio}_${range.fim}.csv`)
  }

  return (
    <div className="space-y-5">
      {/* 4 métricas */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {loading ? Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
            <Sk cls="h-3 w-24" /><Sk cls="h-8 w-20" /><Sk cls="h-3 w-16" />
          </div>
        )) : <>
          <MetricCard label="Taxa de Ascensão" value={`${data?.taxa_ascensao ?? 0}%`}
            color="text-emerald-600"
            sub="dos clientes do período"
            icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>}
          />
          <MetricCard label="Novos Ascendidos" value={data?.novos_ascendidos ?? 0}
            color="text-primary-600"
            sub="compraram o produto upsell"
            icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>}
          />
          <MetricCard label="Tempo Médio de Ascensão" value={`${data?.tempo_medio_ascensao_dias ?? 0} dias`}
            color="text-amber-600"
            sub="entrada → upsell"
            icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
          />
          <MetricCard label="Clientes no Período" value={data?.total_clientes_periodo ?? 0}
            color="text-violet-600"
            sub="com ao menos 1 compra"
            icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>}
          />
        </>}
      </div>

      {/* Gráfico de barras por semana */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Ascensões por Semana</h2>
          <button onClick={exportar} className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800 border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50 transition-colors">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
            Exportar CSV
          </button>
        </div>
        {loading ? <Sk cls="h-52 w-full" /> : (
          data && data.ascensoes_por_semana.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={data.ascensoes_por_semana} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="semana" tick={{ fontSize: 11, fill: '#9ca3af' }} />
                <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} allowDecimals={false} width={32} />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
                  formatter={(v) => [Number(v), 'Ascensões']}
                />
                <Bar dataKey="quantidade" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={48} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-52 flex items-center justify-center text-sm text-gray-400">
              Nenhuma ascensão no período selecionado.
            </div>
          )
        )}
      </div>
    </div>
  )
}

// ── Aba Funil ──────────────────────────────────────────────────────────────

function AbaFunil({ range }: { range: DateRange }) {
  const [data,    setData]    = useState<RelatorioFunil | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    relatoriosApi.funil(range.inicio, range.fim)
      .then(setData).finally(() => setLoading(false))
  }, [range.inicio, range.fim])

  function exportar() {
    if (!data) return
    exportarCsv(
      data.por_etapa.map(e => ({
        Etapa: e.etapa,
        Clientes: e.total_clientes,
        Receita: e.receita,
        'Taxa para próxima (%)': e.taxa_para_proxima ?? '—',
      })),
      `relatorio_funil_${range.inicio}_${range.fim}.csv`
    )
  }

  const etapaColors: Record<string, string> = {
    'Entrada':    'bg-blue-500',
    'Order Bump': 'bg-amber-500',
    'Upsell':     'bg-emerald-500',
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Performance do Funil</h2>
        <button onClick={exportar} className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800 border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50 transition-colors">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
          Exportar CSV
        </button>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b border-gray-100">
          <tr>
            <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase">Etapa</th>
            <th className="text-right px-5 py-3 text-xs font-medium text-gray-500 uppercase">Clientes</th>
            <th className="text-right px-5 py-3 text-xs font-medium text-gray-500 uppercase">Receita</th>
            <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase">Taxa para próxima</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {loading
            ? Array.from({ length: 3 }).map((_, i) => (
                <tr key={i}>{Array.from({ length: 4 }).map((__, j) => (
                  <td key={j} className="px-5 py-4"><Sk cls="h-4 w-full" /></td>
                ))}</tr>
              ))
            : (data?.por_etapa ?? []).map(etapa => (
                <tr key={etapa.etapa} className="hover:bg-gray-50">
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div className={`w-3 h-3 rounded-full ${etapaColors[etapa.etapa] ?? 'bg-gray-400'}`} />
                      <span className="font-medium text-gray-900">{etapa.etapa}</span>
                    </div>
                  </td>
                  <td className="px-5 py-4 text-right font-semibold text-gray-900">
                    {etapa.total_clientes.toLocaleString('pt-BR')}
                  </td>
                  <td className="px-5 py-4 text-right text-gray-700">{brl(etapa.receita)}</td>
                  <td className="px-5 py-4">
                    {etapa.taxa_para_proxima !== null ? (
                      <div className="flex items-center gap-3">
                        <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden max-w-[120px]">
                          <div
                            className="h-full bg-primary-500 rounded-full"
                            style={{ width: `${Math.min(etapa.taxa_para_proxima, 100)}%` }}
                          />
                        </div>
                        <span className="text-sm font-semibold text-gray-700 w-12">
                          {etapa.taxa_para_proxima}%
                        </span>
                      </div>
                    ) : (
                      <span className="text-gray-300 text-xs">—</span>
                    )}
                  </td>
                </tr>
              ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Aba Lista Diária ───────────────────────────────────────────────────────

function AbaLista({ range }: { range: DateRange }) {
  const [data,    setData]    = useState<RelatorioPerformanceLista | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    relatoriosApi.performanceLista(range.inicio, range.fim)
      .then(setData).finally(() => setLoading(false))
  }, [range.inicio, range.fim])

  function exportar() {
    if (!data) return
    exportarCsv(
      data.por_dia.map(d => ({ Data: d.data, Contatos: d.contatos, Convertidos: d.convertidos })),
      `relatorio_lista_${range.inicio}_${range.fim}.csv`
    )
  }

  const prioridadeOrder = ['alta', 'media', 'baixa']

  return (
    <div className="space-y-5">
      {/* 3 cards */}
      <div className="grid grid-cols-3 gap-4">
        {loading ? Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
            <Sk cls="h-3 w-24" /><Sk cls="h-8 w-16" />
          </div>
        )) : <>
          <MetricCard label="Contatos Realizados" value={data?.total_contatos_realizados ?? 0}
            color="text-blue-600"
            icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>}
          />
          <MetricCard label="Convertidos" value={data?.total_convertidos ?? 0}
            color="text-emerald-600"
            icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
          />
          <MetricCard label="Taxa de Conversão" value={`${data?.taxa_conversao ?? 0}%`}
            color="text-violet-600"
            icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>}
          />
        </>}
      </div>

      {/* Tabela por prioridade */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Por Prioridade</h2>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase">Prioridade</th>
              <th className="text-right px-5 py-3 text-xs font-medium text-gray-500 uppercase">Contatos</th>
              <th className="text-right px-5 py-3 text-xs font-medium text-gray-500 uppercase">Convertidos</th>
              <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase">Taxa</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading
              ? Array.from({ length: 3 }).map((_, i) => (
                  <tr key={i}>{Array.from({ length: 4 }).map((__, j) => (
                    <td key={j} className="px-5 py-3.5"><Sk cls="h-4 w-full" /></td>
                  ))}</tr>
                ))
              : prioridadeOrder.map(prio => {
                  const row = data?.por_prioridade[prio] ?? { contatos: 0, convertidos: 0, taxa: 0 }
                  return (
                    <tr key={prio} className="hover:bg-gray-50">
                      <td className="px-5 py-3.5">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${prioColors[prio]}`}>
                          {prio.charAt(0).toUpperCase() + prio.slice(1)}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-right font-semibold text-gray-900">{row.contatos}</td>
                      <td className="px-5 py-3.5 text-right text-gray-700">{row.convertidos}</td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${row.taxa}%` }} />
                          </div>
                          <span className="text-sm font-semibold text-gray-700">{row.taxa}%</span>
                        </div>
                      </td>
                    </tr>
                  )
                })}
          </tbody>
        </table>
      </div>

      {/* Gráfico de linha por dia */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Evolução Diária</h2>
          <button onClick={exportar} className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800 border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50 transition-colors">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
            Exportar CSV
          </button>
        </div>
        {loading ? <Sk cls="h-52 w-full" /> : (
          data && data.por_dia.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={data.por_dia} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis
                  dataKey="data"
                  tick={{ fontSize: 10, fill: '#9ca3af' }}
                  tickFormatter={d => new Date(d + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
                  interval={Math.max(0, Math.floor((data.por_dia.length) / 6) - 1)}
                />
                <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} allowDecimals={false} width={28} />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
                  labelFormatter={d => new Date(d + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })}
                />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="contatos"   name="Contatos"   stroke="#3b82f6" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                <Line type="monotone" dataKey="convertidos" name="Convertidos" stroke="#10b981" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-52 flex items-center justify-center text-sm text-gray-400">
              Nenhum dado de lista diária no período.
            </div>
          )
        )}
      </div>
    </div>
  )
}

// ── Aba Produtos ───────────────────────────────────────────────────────────

function AbaProdutos({ range }: { range: DateRange }) {
  const [data,    setData]    = useState<RelatorioProdutos | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    relatoriosApi.produtos(range.inicio, range.fim)
      .then(setData).finally(() => setLoading(false))
  }, [range.inicio, range.fim])

  function exportar() {
    if (!data) return
    exportarCsv(
      data.produtos.map(p => ({
        Produto: p.nome, Tipo: p.tipo,
        Vendas: p.total_vendas, Receita: p.receita,
        'Ticket Médio': p.ticket_medio,
        '% do Total': p.percentual_receita,
      })),
      `relatorio_produtos_${range.inicio}_${range.fim}.csv`
    )
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Receita por Produto</h2>
        <button onClick={exportar} className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800 border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50 transition-colors">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
          Exportar CSV
        </button>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b border-gray-100">
          <tr>
            <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase">Produto</th>
            <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase hidden sm:table-cell">Tipo</th>
            <th className="text-right px-5 py-3 text-xs font-medium text-gray-500 uppercase">Vendas</th>
            <th className="text-right px-5 py-3 text-xs font-medium text-gray-500 uppercase">Receita</th>
            <th className="text-right px-5 py-3 text-xs font-medium text-gray-500 uppercase hidden md:table-cell">Ticket Médio</th>
            <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase hidden lg:table-cell">% do Total</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {loading
            ? Array.from({ length: 6 }).map((_, i) => (
                <tr key={i}>{Array.from({ length: 6 }).map((__, j) => (
                  <td key={j} className="px-5 py-3.5"><Sk cls="h-4 w-full" /></td>
                ))}</tr>
              ))
            : (data?.produtos ?? []).map(p => (
                <tr key={p.produto_id} className="hover:bg-gray-50">
                  <td className="px-5 py-3.5 max-w-[240px]">
                    <p className="font-medium text-gray-900 truncate" title={p.nome}>{p.nome}</p>
                  </td>
                  <td className="px-5 py-3.5 hidden sm:table-cell">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${tipoColors[p.tipo] ?? 'bg-gray-100 text-gray-600'}`}>
                      {tipoLabel[p.tipo] ?? p.tipo}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-right text-gray-700">{p.total_vendas}</td>
                  <td className="px-5 py-3.5 text-right font-semibold text-gray-900">{brl(p.receita)}</td>
                  <td className="px-5 py-3.5 text-right text-gray-500 hidden md:table-cell">{brl(p.ticket_medio)}</td>
                  <td className="px-5 py-3.5 hidden lg:table-cell">
                    <div className="flex items-center gap-2">
                      <div className="w-20 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full bg-primary-500 rounded-full" style={{ width: `${p.percentual_receita}%` }} />
                      </div>
                      <span className="text-xs font-semibold text-gray-600 w-8">{p.percentual_receita}%</span>
                    </div>
                  </td>
                </tr>
              ))}
        </tbody>
      </table>
      {!loading && (data?.produtos ?? []).length === 0 && (
        <p className="text-center py-12 text-sm text-gray-400">Nenhuma venda no período selecionado.</p>
      )}
    </div>
  )
}

// ── Relatorios ─────────────────────────────────────────────────────────────

type Aba = 'ascensao' | 'funil' | 'lista' | 'produtos'

const ABAS: { id: Aba; label: string }[] = [
  { id: 'ascensao', label: 'Ascensão'      },
  { id: 'funil',    label: 'Funil'         },
  { id: 'lista',    label: 'Lista Diária'  },
  { id: 'produtos', label: 'Produtos'      },
]

export default function Relatorios() {
  const [aba,   setAba]   = useState<Aba>('ascensao')
  const [range, setRange] = useState<DateRange>(mesAtual())

  return (
    <div className="space-y-5">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h1 className="text-2xl font-bold text-gray-900">Relatórios</h1>
        <DateRangePicker value={range} onChange={setRange} />
      </div>

      {/* ── Sub-abas ── */}
      <div className="flex border-b border-gray-200 -mb-px">
        {ABAS.map(a => (
          <button
            key={a.id}
            onClick={() => setAba(a.id)}
            className={[
              'px-5 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px',
              aba === a.id
                ? 'border-primary-600 text-primary-700'
                : 'border-transparent text-gray-500 hover:text-gray-700',
            ].join(' ')}
          >
            {a.label}
          </button>
        ))}
      </div>

      {/* ── Conteúdo da aba ── */}
      <div className="pt-1">
        {aba === 'ascensao' && <AbaAscensao range={range} />}
        {aba === 'funil'    && <AbaFunil    range={range} />}
        {aba === 'lista'    && <AbaLista    range={range} />}
        {aba === 'produtos' && <AbaProdutos range={range} />}
      </div>
    </div>
  )
}
