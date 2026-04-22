import { useEffect, useState } from 'react'
import { configuracoesApi, produtosApi } from '../services/api'
import type { Configuracao } from '@crm/shared'
import type { Produto } from '@crm/shared'
import ImportarTelefones from '../components/ImportarTelefones'
import api from '../services/api'
import { useToast } from '../hooks/useToast'

type Aba = 'geral' | 'funil' | 'comercial' | 'telefones'

const labels: Record<string, string> = {
  limite_lista_diaria:    'Limite da lista diária',
  score_alta_prioridade:  'Score mínimo — Alta prioridade',
  score_media_prioridade: 'Score mínimo — Média prioridade',
  ddi_padrao:             'DDI padrão (ex: 55)',
}

const OCULTAS = new Set(['ultima_sync', 'produto_principal_id', 'produtos_entrada_ids', 'produtos_upsell_ids', 'valor_maximo_order_bump'])

// ── Aba Geral ──────────────────────────────────────────────────────────────

function AbaGeral() {
  const toast = useToast()
  const [configs, setConfigs] = useState<Configuracao[]>([])
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState<string | null>(null)
  const [draft,   setDraft]   = useState<Record<string, string>>({})

  useEffect(() => {
    configuracoesApi.list().then(rows => {
      const visiveis = rows.filter(r => !OCULTAS.has(r.chave) && r.chave in labels)
      setConfigs(visiveis)
      setDraft(Object.fromEntries(visiveis.map(r => [r.chave, r.valor ?? ''])))
    }).finally(() => setLoading(false))
  }, [])

  async function salvar(chave: string) {
    setSaving(chave)
    try {
      await configuracoesApi.save(chave, draft[chave] ?? '')
      toast.success(`${labels[chave] ?? chave} salvo com sucesso!`)
    } catch {
      toast.error('Erro ao salvar. Tente novamente.')
    } finally {
      setSaving(null)
    }
  }

  if (loading) return <div className="text-gray-400 text-sm">Carregando...</div>

  return (
    <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
      {configs.map(({ chave }) => (
        <div key={chave} className="flex items-center gap-4 px-5 py-4">
          <label className="flex-1 text-sm font-medium text-gray-700">{labels[chave] ?? chave}</label>
          <input
            type="text"
            value={draft[chave] ?? ''}
            onChange={e => setDraft(d => ({ ...d, [chave]: e.target.value }))}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm w-48 focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          <button
            onClick={() => salvar(chave)}
            disabled={saving === chave}
            className="px-3 py-1.5 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-700 disabled:opacity-50 transition-colors"
          >
            {saving === chave ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      ))}
      {configs.length === 0 && (
        <p className="px-5 py-8 text-sm text-gray-400">Nenhuma configuração disponível.</p>
      )}
    </div>
  )
}

// ── Aba Funil ──────────────────────────────────────────────────────────────

function CheckList({
  produtos, selecionados, onToggle,
}: { produtos: Produto[]; selecionados: string[]; onToggle: (id: string) => void }) {
  return (
    <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
      {produtos.map(p => (
        <label key={p.id} className="flex items-center gap-3 cursor-pointer group">
          <input
            type="checkbox"
            checked={selecionados.includes(p.id)}
            onChange={() => onToggle(p.id)}
            className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
          />
          <span className="text-sm text-gray-700 group-hover:text-gray-900 leading-snug">{p.nome}</span>
        </label>
      ))}
    </div>
  )
}

function AbaFunil() {
  const toast = useToast()
  const [produtos,      setProdutos]      = useState<Produto[]>([])
  const [upsellId,      setUpsellId]      = useState<string>('')
  const [entradas,      setEntradas]      = useState<string[]>([])
  const [valorMaximoOB, setValorMaximoOB] = useState<string>('100')
  const [loading,       setLoading]       = useState(true)
  const [saving,        setSaving]        = useState(false)

  useEffect(() => {
    Promise.all([produtosApi.list(), configuracoesApi.list()]).then(([prods, configs]) => {
      setProdutos(prods)
      const m = Object.fromEntries(configs.map(c => [c.chave, c.valor ?? '']))
      setUpsellId(m['produto_principal_id'] ?? '')
      setValorMaximoOB(m['valor_maximo_order_bump'] ?? '100')
      try { setEntradas(JSON.parse(m['produtos_entrada_ids'] || '[]')) } catch {}
    }).finally(() => setLoading(false))
  }, [])

  function toggleEntrada(id: string) {
    setEntradas(e => e.includes(id) ? e.filter(x => x !== id) : [...e, id])
  }

  async function salvar() {
    setSaving(true)
    try {
      await Promise.all([
        configuracoesApi.save('produto_principal_id',    upsellId),
        configuracoesApi.save('produtos_entrada_ids',    JSON.stringify(entradas)),
        configuracoesApi.save('valor_maximo_order_bump', valorMaximoOB),
      ])
      await api.post('/api/lista/gerar')
      toast.success('Configurações salvas e lista diária recalculada!')
    } catch {
      toast.error('Erro ao salvar. Tente novamente.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="text-gray-400 text-sm">Carregando produtos...</div>

  return (
    <div className="space-y-5">

      {/* Produto Upsell */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-start justify-between mb-1">
          <h3 className="text-sm font-semibold text-gray-900">Produto Upsell (Ascensão)</h3>
          <span className="text-xs text-emerald-600 font-medium bg-emerald-50 px-2 py-0.5 rounded-full">único</span>
        </div>
        <p className="text-xs text-gray-500 mb-3">
          Clientes que compraram este produto são considerados <strong>ascendidos</strong>.
        </p>
        <select
          value={upsellId}
          onChange={e => setUpsellId(e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
        >
          <option value="">— Selecionar produto —</option>
          {produtos.map(p => (
            <option key={p.id} value={p.id}>{p.nome}</option>
          ))}
        </select>
        {upsellId && (
          <p className="mt-2 text-xs text-gray-400">
            Selecionado: <strong>{produtos.find(p => p.id === upsellId)?.nome}</strong>
          </p>
        )}
      </div>

      {/* Produtos de Entrada */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-start justify-between mb-1">
          <h3 className="text-sm font-semibold text-gray-900">Produtos de Entrada</h3>
          <span className="text-xs text-blue-600 font-medium bg-blue-50 px-2 py-0.5 rounded-full">
            {entradas.length} selecionado{entradas.length !== 1 ? 's' : ''}
          </span>
        </div>
        <p className="text-xs text-gray-500 mb-3">
          Produtos que iniciam a jornada do cliente. Usados como base do funil de conversão.
        </p>
        {produtos.length === 0
          ? <p className="text-sm text-gray-400">Nenhum produto cadastrado ainda.</p>
          : <CheckList produtos={produtos} selecionados={entradas} onToggle={toggleEntrada} />
        }
      </div>

      {/* Valor máximo de order bump */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-start justify-between mb-1">
          <h3 className="text-sm font-semibold text-gray-900">Valor máximo de order bump (R$)</h3>
          <span className="text-xs text-amber-600 font-medium bg-amber-50 px-2 py-0.5 rounded-full">co-compra</span>
        </div>
        <p className="text-xs text-gray-500 mb-3">
          Compras com valor até este limite, realizadas em menos de 2 minutos junto com uma compra maior,
          são classificadas automaticamente como <strong>order bump</strong>.
        </p>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">R$</span>
          <input
            type="number"
            min="0"
            step="10"
            value={valorMaximoOB}
            onChange={e => setValorMaximoOB(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-32 focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>
      </div>

      {/* Botão Salvar */}
      <div className="flex justify-end">
        <button
          onClick={salvar}
          disabled={saving}
          className="flex items-center gap-2 px-5 py-2.5 bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50"
        >
          {saving ? (
            <>
              <span className="inline-block w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Salvando...
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              Salvar e recalcular lista
            </>
          )}
        </button>
      </div>
    </div>
  )
}

// ── Aba Comercial ──────────────────────────────────────────────────────────

const COMERCIAL_CONFIGS: { chave: string; label: string; desc: string; min: number; max: number; step: number }[] = [
  {
    chave: 'limite_fluxo_ativo',
    label: 'Limite diário — Fluxo Ativo',
    desc:  'Máximo de contatos do Fluxo Ativo por dia.',
    min: 5, max: 100, step: 5,
  },
  {
    chave: 'limite_reativacao_diaria',
    label: 'Limite diário — Reativação',
    desc:  'Máximo de leads reativados por dia.',
    min: 5, max: 100, step: 5,
  },
  {
    chave: 'dias_lead_antigo',
    label: 'Dias para considerar lead antigo',
    desc:  'Leads com última compra há mais de X dias entram na fila de Reativação.',
    min: 7, max: 180, step: 1,
  },
]

function AbaComercial() {
  const toast   = useToast()
  const [draft,   setDraft]   = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState<string | null>(null)

  useEffect(() => {
    configuracoesApi.list().then(rows => {
      const m = Object.fromEntries(rows.map(r => [r.chave, r.valor ?? '']))
      const defaults: Record<string, string> = {
        limite_fluxo_ativo:      '30',
        limite_reativacao_diaria:'15',
        dias_lead_antigo:        '30',
      }
      setDraft({ ...defaults, ...m })
    }).finally(() => setLoading(false))
  }, [])

  async function salvar(chave: string) {
    setSaving(chave)
    try {
      await configuracoesApi.save(chave, draft[chave] ?? '')
      toast.success('Configuração salva!')
    } catch {
      toast.error('Erro ao salvar. Tente novamente.')
    } finally {
      setSaving(null)
    }
  }

  if (loading) return <div className="text-gray-400 text-sm">Carregando...</div>

  return (
    <div className="space-y-4">
      {COMERCIAL_CONFIGS.map(({ chave, label, desc, min, max, step }) => (
        <div key={chave} className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-gray-900">{label}</h3>
              <p className="text-xs text-gray-500 mt-0.5">{desc}</p>
              <div className="mt-3 flex items-center gap-3">
                <input
                  type="range"
                  min={min}
                  max={max}
                  step={step}
                  value={draft[chave] ?? min}
                  onChange={e => setDraft(d => ({ ...d, [chave]: e.target.value }))}
                  className="flex-1 accent-primary-600"
                />
                <span className="text-sm font-bold text-gray-800 w-10 text-right tabular-nums">
                  {draft[chave] ?? min}
                </span>
              </div>
            </div>
            <button
              onClick={() => salvar(chave)}
              disabled={saving === chave}
              className="flex-shrink-0 px-3 py-1.5 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
            >
              {saving === chave ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Configuracoes ──────────────────────────────────────────────────────────

export default function Configuracoes() {
  const [aba, setAba] = useState<Aba>('geral')

  const ABAS: { id: Aba; label: string }[] = [
    { id: 'geral',     label: 'Geral'      },
    { id: 'funil',     label: 'Funil'      },
    { id: 'comercial', label: 'Comercial'  },
    { id: 'telefones', label: 'Telefones'  },
  ]

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Configurações</h1>

      <div className="flex border-b border-gray-200 mb-6">
        {ABAS.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setAba(id)}
            className={[
              'px-5 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
              aba === id
                ? 'border-primary-600 text-primary-700'
                : 'border-transparent text-gray-500 hover:text-gray-700',
            ].join(' ')}
          >
            {label}
          </button>
        ))}
      </div>

      {aba === 'geral'     && <AbaGeral />}
      {aba === 'funil'     && <AbaFunil />}
      {aba === 'comercial' && <AbaComercial />}
      {aba === 'telefones' && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-1">Importar telefones dos clientes</h2>
          <p className="text-sm text-gray-500 mb-5">
            Vincule telefones aos clientes já importados via exportação CSV da Hotmart.
          </p>
          <ImportarTelefones />
        </div>
      )}
    </div>
  )
}
