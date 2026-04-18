import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { clientesApi, type ClientePerfil, type ClienteCompra } from '../services/api'

// ── Helpers ────────────────────────────────────────────────────────────────

function iniciais(nome: string) {
  return nome.split(' ').filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join('')
}

function brl(v: number | null) {
  if (v === null) return '—'
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatarData(iso: string) {
  return new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

function avatarBg(score: number) {
  if (score >= 70) return 'bg-emerald-500'
  if (score >= 40) return 'bg-amber-400'
  return 'bg-red-400'
}

function scoreColor(score: number) {
  if (score >= 70) return '#10b981'
  if (score >= 40) return '#f59e0b'
  return '#ef4444'
}

const statusColors: Record<string, string> = {
  novo:      'bg-blue-100 text-blue-700',
  nutricao:  'bg-purple-100 text-purple-700',
  pronto:    'bg-emerald-100 text-emerald-700',
  ascendido: 'bg-indigo-100 text-indigo-700',
  inativo:   'bg-gray-100 text-gray-500',
}

const statusLabels: Record<string, string> = {
  novo: 'Novo', nutricao: 'Nutrição', pronto: 'Pronto',
  ascendido: 'Ascendido', inativo: 'Inativo',
}

const prioridadeColors: Record<string, string> = {
  alta:  'bg-red-100 text-red-700',
  media: 'bg-amber-100 text-amber-700',
  baixa: 'bg-gray-100 text-gray-600',
}

// Ícone colorido por tipo de produto na timeline
const tipoIconBg: Record<string, string> = {
  entrada:    'bg-blue-100 text-blue-600',
  order_bump: 'bg-amber-100 text-amber-600',
  upsell:     'bg-violet-100 text-violet-600',
  principal:  'bg-emerald-100 text-emerald-600',
}

const tipoLabel: Record<string, string> = {
  entrada: 'Entrada', order_bump: 'Order Bump', upsell: 'Upsell', principal: 'Upsell',
}

// ── Skeleton ───────────────────────────────────────────────────────────────

function Sk({ cls }: { cls: string }) {
  return <div className={`bg-gray-200 animate-pulse rounded ${cls}`} />
}

// ── Funil visual ───────────────────────────────────────────────────────────

interface FunilStep {
  label: string
  done: boolean
  icon: React.ReactNode
}

function FunilSteps({ steps }: { steps: FunilStep[] }) {
  const firstEmpty = steps.findIndex(s => !s.done)
  return (
    <div className="flex items-center gap-0">
      {steps.map((step, i) => (
        <div key={step.label} className="flex items-center">
          <div className={[
            'flex flex-col items-center gap-1.5 px-3',
          ].join(' ')}>
            <div className={[
              'w-10 h-10 rounded-full flex items-center justify-center text-lg transition-all',
              step.done
                ? 'bg-emerald-100 text-emerald-600 ring-2 ring-emerald-300'
                : i === firstEmpty
                  ? 'bg-amber-50 text-amber-500 ring-2 ring-amber-300 ring-offset-1'
                  : 'bg-gray-100 text-gray-300',
            ].join(' ')}>
              {step.done ? (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              ) : step.icon}
            </div>
            <span className={`text-xs font-semibold ${step.done ? 'text-emerald-700' : i === firstEmpty ? 'text-amber-600' : 'text-gray-400'}`}>
              {step.label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div className={`h-px w-6 mx-0 ${steps[i + 1].done ? 'bg-emerald-300' : 'bg-gray-200'}`} />
          )}
        </div>
      ))}
    </div>
  )
}

// ── WhatsApp helpers ───────────────────────────────────────────────────────

function waLink(tel: string | null, mensagem: string) {
  if (!tel) return null
  return `https://wa.me/${tel.replace(/\D/g, '')}?text=${encodeURIComponent(mensagem)}`
}

function buildWaMessage(nome: string, passo: string, compras: ClienteCompra[]): string {
  const primeiroNome = nome.split(' ')[0]

  if (passo.includes('order bump')) {
    const ultimaEntrada = compras.find(c => c.produto_tipo === 'entrada')
    const produto = ultimaEntrada?.produto_nome ?? 'seu produto'
    return `Olá ${primeiroNome}! Tenho uma oferta especial para complementar o ${produto} que você já tem. Posso te contar mais?`
  }
  if (passo.includes('Upsell') || passo.includes('upsell')) {
    return `Olá ${primeiroNome}! Você já tem ótimos produtos. Queria te apresentar o Conduta Masculina que vai complementar tudo que você já estudou.`
  }
  // fallback genérico
  return `Olá ${primeiroNome}! Tenho uma novidade para você. Pode falar agora?`
}

// ── Cliente ────────────────────────────────────────────────────────────────

export default function Cliente() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [perfil,  setPerfil]  = useState<ClientePerfil | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    setLoading(true)
    clientesApi
      .getPerfil(id)
      .then(setPerfil)
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }, [id])

  if (error) {
    return (
      <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
        {error}
      </div>
    )
  }

  const score = perfil?.score.score ?? 0
  const passo = perfil?.resumo.proximo_passo_sugerido ?? ''
  const tel   = perfil?.cliente.telefone_formatado ?? null

  const mensagemWA = perfil
    ? buildWaMessage(perfil.cliente.nome, passo, perfil.compras)
    : ''
  const waPerfil  = waLink(tel, mensagemWA)

  // Jornada: quais etapas foram concluídas
  const temEntrada   = perfil?.compras.some(c => c.produto_tipo === 'entrada')   ?? false
  const temOrderBump = perfil?.compras.some(c => c.is_order_bump)                ?? false
  const temUpsell    = perfil?.compras.some(c => c.produto_tipo === 'principal') ?? false

  const funilSteps: FunilStep[] = [
    {
      label: 'Entrada',
      done: temEntrada,
      icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
            </svg>,
    },
    {
      label: 'Order Bump',
      done: temOrderBump,
      icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>,
    },
    {
      label: 'Upsell',
      done: temUpsell,
      icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
            </svg>,
    },
  ]

  const ascendido = passo.includes('✓')

  return (
    <div className="space-y-5 max-w-5xl">

      {/* ── Botão voltar ── */}
      <button
        onClick={() => navigate('/clientes')}
        className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        Voltar para Clientes
      </button>

      {/* ── Header ── */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        {loading ? (
          <div className="flex items-center gap-5">
            <Sk cls="w-16 h-16 rounded-full" />
            <div className="space-y-2 flex-1">
              <Sk cls="h-5 w-48" /><Sk cls="h-4 w-64" />
              <div className="flex gap-2 mt-2"><Sk cls="h-6 w-16 rounded-full" /><Sk cls="h-6 w-16 rounded-full" /></div>
            </div>
          </div>
        ) : perfil ? (
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-5">
            {/* Avatar + info */}
            <div className="flex items-center gap-5">
              <div className={`w-16 h-16 rounded-full ${avatarBg(score)} flex items-center justify-center text-white text-xl font-bold shrink-0`}>
                {iniciais(perfil.cliente.nome)}
              </div>
              <div>
                <div className="flex items-baseline gap-3 flex-wrap">
                  <h1 className="text-xl font-bold text-gray-900">{perfil.cliente.nome}</h1>
                  <span className="text-2xl font-black" style={{ color: scoreColor(score) }}>{score}</span>
                </div>
                <p className="text-sm text-gray-500">{perfil.cliente.email}</p>
                {tel && (
                  <p className="text-sm text-gray-400 mt-0.5">+{tel}</p>
                )}
                <div className="flex flex-wrap gap-2 mt-2">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusColors[perfil.status] ?? 'bg-gray-100 text-gray-600'}`}>
                    {statusLabels[perfil.status] ?? perfil.status}
                  </span>
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${prioridadeColors[perfil.score.prioridade] ?? 'bg-gray-100 text-gray-600'}`}>
                    Prioridade {perfil.score.prioridade}
                  </span>
                </div>
              </div>
            </div>

            {/* Botão WhatsApp */}
            {perfil.cliente.telefone_valido && waPerfil ? (
              <a
                href={waPerfil}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold rounded-lg transition-colors self-start shrink-0"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                  <path d="M12 0C5.373 0 0 5.373 0 12c0 2.123.554 4.118 1.528 5.852L.057 23.5l5.797-1.52A11.93 11.93 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.847 0-3.575-.476-5.083-1.312l-.364-.215-3.44.902.918-3.352-.236-.384A9.955 9.955 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/>
                </svg>
                Abrir WhatsApp
              </a>
            ) : (
              <span className="text-xs text-gray-400 self-start mt-1">Sem telefone válido</span>
            )}
          </div>
        ) : null}
      </div>

      {/* ── Score bar ── */}
      {!loading && perfil && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Score de Prioridade</h2>
            <span className="text-2xl font-black" style={{ color: scoreColor(score) }}>{score}</span>
          </div>
          <div className="w-full h-3 rounded-full overflow-hidden" style={{ background: 'linear-gradient(to right, #ef4444 0%, #f59e0b 50%, #10b981 100%)' }}>
            <div className="h-full" style={{ background: 'transparent', position: 'relative' }}>
              {/* Marcador de posição */}
              <div
                className="absolute top-0 h-full w-1 bg-white/80 rounded-full shadow-sm transition-all duration-500"
                style={{ left: `calc(${score}% - 2px)` }}
              />
            </div>
          </div>
          <div className="flex justify-between text-xs text-gray-400 mt-1">
            <span>0</span><span>50</span><span>100</span>
          </div>
          {perfil.score.motivos.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {perfil.score.motivos.map(m => (
                <span key={m} className="text-xs bg-gray-100 text-gray-600 px-2.5 py-1 rounded-full">
                  {m}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      {loading && <Sk cls="h-24 w-full rounded-xl" />}

      {/* ── Jornada do cliente (funil) ── */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-4">Jornada do Cliente</h2>
        {loading ? (
          <div className="flex gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex flex-col items-center gap-2">
                <Sk cls="w-10 h-10 rounded-full" />
                <Sk cls="h-3 w-16" />
              </div>
            ))}
          </div>
        ) : (
          <>
            <FunilSteps steps={funilSteps} />

            {/* Próximo passo em destaque */}
            {!ascendido && (
              <div className="mt-4 flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
                <svg className="w-4 h-4 text-amber-500 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                </svg>
                <p className="text-sm font-semibold text-amber-800">{passo}</p>
              </div>
            )}
            {ascendido && (
              <div className="mt-4 flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3">
                <svg className="w-4 h-4 text-emerald-500 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-sm font-semibold text-emerald-800">{passo}</p>
              </div>
            )}
          </>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* ── Coluna esquerda: resumo + próximo passo ── */}
        <div className="space-y-5">

          {/* Resumo numérico */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Resumo</h2>
            {loading ? (
              <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Sk key={i} cls="h-4 w-full" />)}</div>
            ) : perfil ? (
              <dl className="space-y-2.5 text-sm">
                <div className="flex justify-between">
                  <dt className="text-gray-500">Total gasto</dt>
                  <dd className="font-semibold text-gray-900">{brl(perfil.resumo.total_gasto)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">Compras</dt>
                  <dd className="font-semibold text-gray-900">{perfil.resumo.quantidade_compras}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">Primeira compra</dt>
                  <dd className="font-semibold text-gray-900">
                    {perfil.resumo.dias_desde_primeira_compra !== null
                      ? `${perfil.resumo.dias_desde_primeira_compra}d atrás`
                      : '—'}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">Última compra</dt>
                  <dd className="font-semibold text-gray-900">
                    {perfil.resumo.dias_desde_ultima_compra !== null
                      ? `${perfil.resumo.dias_desde_ultima_compra}d atrás`
                      : '—'}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">Tem upsell</dt>
                  <dd>
                    {perfil.resumo.tem_produto_upsell
                      ? <span className="text-emerald-600 font-semibold">Sim ✓</span>
                      : <span className="text-gray-400">Não</span>}
                  </dd>
                </div>
              </dl>
            ) : null}
          </div>

          {/* Card próximo passo + botão WA personalizado */}
          {!loading && perfil && !ascendido && (
            <div className="bg-white rounded-xl border-2 border-primary-200 p-5">
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Próximo Passo</h2>
              <div className="flex items-start gap-3 mb-4">
                <svg className="w-7 h-7 text-primary-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                </svg>
                <p className="text-sm font-semibold text-gray-800 leading-snug">{passo}</p>
              </div>

              {perfil.cliente.telefone_valido && waPerfil && (
                <a
                  href={waPerfil}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold rounded-lg transition-colors w-full"
                >
                  <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                    <path d="M12 0C5.373 0 0 5.373 0 12c0 2.123.554 4.118 1.528 5.852L.057 23.5l5.797-1.52A11.93 11.93 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.847 0-3.575-.476-5.083-1.312l-.364-.215-3.44.902.918-3.352-.236-.384A9.955 9.955 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/>
                  </svg>
                  Iniciar abordagem no WhatsApp
                </a>
              )}

              {/* Preview da mensagem */}
              {perfil.cliente.telefone_valido && (
                <p className="mt-3 text-xs text-gray-400 italic leading-relaxed">
                  "{mensagemWA}"
                </p>
              )}
            </div>
          )}

          {/* Cliente ascendido */}
          {!loading && perfil && ascendido && (
            <div className="bg-emerald-50 rounded-xl border border-emerald-200 p-5 text-center">
              <div className="text-3xl mb-2">🏆</div>
              <p className="text-sm font-bold text-emerald-800">Cliente Ascendido</p>
              <p className="text-xs text-emerald-600 mt-1">Jornada completa concluída.</p>
            </div>
          )}
        </div>

        {/* ── Coluna direita: timeline de compras ── */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-4">Histórico de Compras</h2>
          {loading ? (
            <div className="space-y-5">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-start gap-4">
                  <Sk cls="w-8 h-8 rounded-full shrink-0" />
                  <div className="flex-1 space-y-1.5 pt-1">
                    <Sk cls="h-4 w-52" /><Sk cls="h-3 w-32" />
                  </div>
                </div>
              ))}
            </div>
          ) : perfil && perfil.compras.length > 0 ? (
            <div className="relative">
              <div className="absolute left-4 top-4 bottom-4 w-px bg-gray-100" />
              <ol className="space-y-5 relative">
                {perfil.compras.map((c, i) => {
                  const tipo = c.is_order_bump ? 'order_bump' : c.produto_tipo
                  return (
                    <li key={i} className="flex items-start gap-4">
                      {/* Ícone colorido por tipo */}
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 z-10 text-sm font-bold ${tipoIconBg[tipo] ?? 'bg-gray-100 text-gray-500'}`}>
                        {(tipoLabel[tipo] ?? tipo)[0].toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0 pt-1">
                        <div className="flex items-start justify-between gap-2 flex-wrap">
                          <p className="font-medium text-gray-900 text-sm truncate max-w-[260px]" title={c.produto_nome}>
                            {c.produto_nome}
                          </p>
                          <span className="font-semibold text-gray-800 text-sm shrink-0">{brl(c.valor)}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${tipoIconBg[tipo] ?? 'bg-gray-100 text-gray-500'}`}>
                            {tipoLabel[tipo] ?? tipo}
                          </span>
                          {c.is_order_bump && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-700 border border-amber-200">
                              Order Bump
                            </span>
                          )}
                          <span className="text-xs text-gray-400">{formatarData(c.data_compra)}</span>
                          <span className="text-xs text-gray-400">· {c.dias_atras}d atrás</span>
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ol>
            </div>
          ) : !loading ? (
            <div className="text-center py-16 text-gray-400">
              <div className="text-4xl mb-3">🛒</div>
              <p className="text-sm">Nenhuma compra registrada.</p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
