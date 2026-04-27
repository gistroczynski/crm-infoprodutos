import { useEffect, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, Legend,
} from 'recharts'
import {
  relatoriosApi,
  type RelatorioAscensao,
  type RelatorioPerformanceLista,
  type RelatorioCadencias,
} from '../services/api'

// ── Helpers ────────────────────────────────────────────────────────────────

function hoje() {
  return new Date().toLocaleDateString('pt-BR', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).split('/').reverse().join('-')
}

function mesAtual(): DateRange {
  const parts = new Date().toLocaleDateString('pt-BR', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).split('/')
  const y = Number(parts[2])
  const m = Number(parts[1])
  const ld = new Date(y, m, 0).getDate()
  const ms = String(m).padStart(2, '0')
  return { inicio: `${y}-${ms}-01`, fim: `${y}-${ms}-${String(ld).padStart(2, '0')}` }
}

function semanaAtual(): DateRange {
  const brtStr = new Date().toLocaleDateString('pt-BR', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).split('/')
  const [d, mo, y] = brtStr.map(Number)
  const now = new Date(y, mo - 1, d)
  const dow = now.getDay() === 0 ? 6 : now.getDay() - 1
  const mon = new Date(y, mo - 1, d - dow)
  const sun = new Date(y, mo - 1, d - dow + 6)
  const fmt = (dt: Date) =>
    `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
  return { inicio: fmt(mon), fim: fmt(sun) }
}

function anoAtual(): DateRange {
  const y = new Date().getFullYear()
  return { inicio: `${y}-01-01`, fim: `${y}-12-31` }
}

function fmtPeriodo(inicio: string, fim: string) {
  const tz = { timeZone: 'America/Sao_Paulo' } as const
  const fmt = (s: string) => new Date(s + 'T12:00:00').toLocaleDateString('pt-BR', { ...tz, day: '2-digit', month: 'short' })
  if (inicio === fim) return fmt(inicio)
  const i = new Date(inicio + 'T12:00:00')
  const f = new Date(fim    + 'T12:00:00')
  if (i.getMonth() === f.getMonth() && i.getFullYear() === f.getFullYear())
    return i.toLocaleDateString('pt-BR', { ...tz, month: 'long', year: 'numeric' })
  if (i.getMonth() === 0 && f.getMonth() === 11 && i.getFullYear() === f.getFullYear())
    return String(i.getFullYear())
  return `${fmt(inicio)} – ${fmt(fim)}`
}

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
  const blob = new Blob(['﻿' + linhas], { type: 'text/csv;charset=utf-8;' })
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
  { id: 'hoje',          label: 'Hoje'         },
  { id: 'semana',        label: 'Esta semana'  },
  { id: 'mes',           label: 'Este mês'     },
  { id: 'ano',           label: 'Este ano'     },
  { id: 'personalizado', label: 'Personalizado'},
]

function DateRangePicker({ value, onChange }: { value: DateRange; onChange: (r: DateRange) => void }) {
  const [modo, setModo]     = useState<Modo>('mes')
  const [inicio, setInicio] = useState(value.inicio)
  const [fim,    setFim]    = useState(value.fim)

  function handleModo(m: Modo) {
    setModo(m)
    if (m === 'hoje')          onChange({ inicio: hoje(), fim: hoje() })
    if (m === 'semana')        onChange(semanaAtual())
    if (m === 'mes')           onChange(mesAtual())
    if (m === 'ano')           onChange(anoAtual())
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

const prioColors: Record<string, string> = {
  alta:  'bg-red-100 text-red-700',
  media: 'bg-amber-100 text-amber-700',
  baixa: 'bg-gray-100 text-gray-600',
}

// ── Aba Ascensão de Clientes ───────────────────────────────────────────────

function AbaAscensaoClientes({ range }: { range: DateRange }) {
  const [data,      setData]      = useState<RelatorioAscensao | null>(null)
  const [cadencias, setCadencias] = useState<RelatorioCadencias | null>(null)
  const [loading,   setLoading]   = useState(true)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      relatoriosApi.ascensao(range.inicio, range.fim),
      relatoriosApi.cadencias(range.inicio, range.fim),
    ]).then(([a, c]) => { setData(a); setCadencias(c) })
      .finally(() => setLoading(false))
  }, [range.inicio, range.fim])

  function exportar() {
    if (!data) return
    exportarCsv(data.ascensoes_por_semana, `relatorio_ascensao_${range.inicio}_${range.fim}.csv`)
  }

  return (
    <div className="space-y-5">
      {/* 4 cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {loading ? Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
            <Sk cls="h-3 w-24" /><Sk cls="h-8 w-20" /><Sk cls="h-3 w-16" />
          </div>
        )) : <>
          <MetricCard
            label="Total na Base"
            value={(data?.total_clientes_base ?? 0).toLocaleString('pt-BR')}
            color="text-primary-600"
            sub="clientes cadastrados"
            icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>}
          />
          <MetricCard
            label="Sem Upsell"
            value={(data?.clientes_sem_upsell ?? 0).toLocaleString('pt-BR')}
            color="text-amber-600"
            sub="potencial de conversão"
            icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
          />
          <MetricCard
            label="Ascendidos no Período"
            value={data?.novos_ascendidos ?? 0}
            color="text-emerald-600"
            sub="compraram o produto upsell"
            icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>}
          />
          <MetricCard
            label="Taxa de Ascensão"
            value={`${data?.taxa_ascensao ?? 0}%`}
            color="text-violet-600"
            sub="dos clientes do período"
            icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>}
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

      {/* Tabela por trilha de cadência */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Performance por Trilha de Cadência</h2>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase">Trilha</th>
              <th className="text-right px-5 py-3 text-xs font-medium text-gray-500 uppercase">Inscritos</th>
              <th className="text-right px-5 py-3 text-xs font-medium text-gray-500 uppercase hidden sm:table-cell">Em andamento</th>
              <th className="text-right px-5 py-3 text-xs font-medium text-gray-500 uppercase">Convertidos</th>
              <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase">Taxa</th>
              <th className="text-right px-5 py-3 text-xs font-medium text-gray-500 uppercase hidden lg:table-cell">Tempo médio</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading
              ? Array.from({ length: 3 }).map((_, i) => (
                  <tr key={i}>{Array.from({ length: 6 }).map((__, j) => (
                    <td key={j} className="px-5 py-3.5"><Sk cls="h-4 w-full" /></td>
                  ))}</tr>
                ))
              : (cadencias?.por_trilha ?? []).length === 0
                ? <tr><td colSpan={6} className="text-center py-10 text-sm text-gray-400">Nenhuma trilha ativa no período.</td></tr>
                : (cadencias?.por_trilha ?? []).map(t => (
                    <tr key={t.trilha_nome} className="hover:bg-gray-50">
                      <td className="px-5 py-3.5 font-medium text-gray-900 max-w-[200px] truncate" title={t.trilha_nome}>{t.trilha_nome}</td>
                      <td className="px-5 py-3.5 text-right text-gray-700">{t.total_inscritos}</td>
                      <td className="px-5 py-3.5 text-right text-blue-600 hidden sm:table-cell">{t.em_andamento}</td>
                      <td className="px-5 py-3.5 text-right text-emerald-600 font-semibold">{t.convertidos}</td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${t.taxa_conversao}%` }} />
                          </div>
                          <span className="text-sm font-semibold text-gray-700">{t.taxa_conversao}%</span>
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-right text-gray-500 hidden lg:table-cell">
                        {t.tempo_medio_dias > 0 ? `${t.tempo_medio_dias} dias` : '—'}
                      </td>
                    </tr>
                  ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Aba Performance do Guilherme ───────────────────────────────────────────

function AbaPerformanceGuilherme({ range }: { range: DateRange }) {
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
      `relatorio_performance_${range.inicio}_${range.fim}.csv`
    )
  }

  const prioridadeOrder = ['alta', 'media', 'baixa']
  const semDados = !loading && (data?.total_contatos_realizados ?? 0) === 0

  if (semDados) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-12 flex flex-col items-center justify-center gap-3 text-center">
        <svg className="w-12 h-12 text-gray-300" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
        </svg>
        <p className="text-gray-500 text-sm max-w-sm">
          Nenhum contato registrado ainda. Os dados aparecerão conforme o Guilherme usar o sistema.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* 4 cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {loading ? Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
            <Sk cls="h-3 w-24" /><Sk cls="h-8 w-16" />
          </div>
        )) : <>
          <MetricCard
            label="Contatos Realizados"
            value={data?.total_contatos_realizados ?? 0}
            color="text-blue-600"
            icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>}
          />
          <MetricCard
            label="Responderam"
            value={data?.total_contatos_realizados ?? 0}
            color="text-indigo-600"
            sub="contatos com resposta"
            icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>}
          />
          <MetricCard
            label="Convertidos"
            value={data?.total_convertidos ?? 0}
            color="text-emerald-600"
            icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
          />
          <MetricCard
            label="Taxa de Conversão"
            value={`${data?.taxa_conversao ?? 0}%`}
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
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Contatos por Dia</h2>
          <button onClick={exportar} className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800 border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50 transition-colors">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
            Exportar CSV
          </button>
        </div>
        {loading ? <Sk cls="h-52 w-full" /> : (
          data && data.por_dia.some(d => d.contatos > 0) ? (
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
                <Line type="monotone" dataKey="contatos"    name="Contatos realizados" stroke="#3b82f6" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                <Line type="monotone" dataKey="convertidos" name="Convertidos"          stroke="#10b981" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-52 flex items-center justify-center text-sm text-gray-400">
              Nenhum dado no período selecionado.
            </div>
          )
        )}
      </div>
    </div>
  )
}

// ── Relatorios ─────────────────────────────────────────────────────────────

type Aba = 'ascensao' | 'performance'

const ABAS: { id: Aba; label: string }[] = [
  { id: 'ascensao',    label: 'Ascensão de Clientes'    },
  { id: 'performance', label: 'Performance do Guilherme' },
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
              'px-5 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px whitespace-nowrap',
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
        {aba === 'ascensao'    && <AbaAscensaoClientes      range={range} />}
        {aba === 'performance' && <AbaPerformanceGuilherme  range={range} />}
      </div>
    </div>
  )
}
