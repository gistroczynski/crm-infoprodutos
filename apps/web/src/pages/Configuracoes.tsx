import { useEffect, useRef, useState } from 'react'
import { configuracoesApi, produtosApi, historicoSyncApi, mensagensApi, cadenciasApi, type HistoricoInfo, type MensagemTemplate, type TrilhaCadencia, type EtapaCadencia } from '../services/api'
import type { Configuracao } from '@crm/shared'
import type { Produto } from '@crm/shared'
import ImportarTelefones from '../components/ImportarTelefones'
import api from '../services/api'
import { useToast } from '../hooks/useToast'

type Aba = 'geral' | 'funil' | 'comercial' | 'telefones' | 'mensagens'

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
      const unicos = prods.filter((p, i, self) => i === self.findIndex(t => t.nome === p.nome))
      setProdutos(unicos)
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

  const [historicoInfo, setHistoricoInfo] = useState<HistoricoInfo | null>(null)
  const [iniciandoHistorico, setIniciandoHistorico] = useState(false)
  const [historicoMsg, setHistoricoMsg] = useState<string | null>(null)

  useEffect(() => {
    historicoSyncApi.info().then(setHistoricoInfo).catch(() => {})
  }, [])

  async function iniciarSyncHistorico() {
    setIniciandoHistorico(true)
    setHistoricoMsg(null)
    try {
      const r = await historicoSyncApi.iniciar()
      setHistoricoMsg(r.estimativa)
    } catch (e: any) {
      setHistoricoMsg(e?.response?.data?.error ?? 'Erro ao iniciar sync histórico.')
    } finally {
      setIniciandoHistorico(false)
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
      {/* Sync Histórico Completo */}
      <div className="bg-white rounded-xl border border-amber-200 bg-amber-50 p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-gray-900">Sync histórico completo (desde jan/2020)</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              O sync padrão cobre apenas desde jan/2023. Use isso para recuperar clientes antigos.
              Pode demorar 15-30 minutos — roda em background.
            </p>
            {historicoInfo && (
              <div className="mt-2 flex gap-4 text-xs text-gray-500">
                <span>Banco: <strong>{historicoInfo.banco.clientes_no_banco.toLocaleString('pt-BR')}</strong> clientes</span>
                <span>Compras desde: <strong>{historicoInfo.banco.data_mais_antiga?.slice(0,10) ?? '—'}</strong></span>
                <span>Janelas: <strong>{historicoInfo.sync_historico.janelas_mensais}</strong> meses</span>
              </div>
            )}
            {historicoMsg && (
              <p className="mt-2 text-xs text-amber-700 font-medium">{historicoMsg}</p>
            )}
          </div>
          <button
            onClick={iniciarSyncHistorico}
            disabled={iniciandoHistorico || historicoInfo?.em_andamento}
            className="flex-shrink-0 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {iniciandoHistorico ? 'Iniciando...' : 'Iniciar'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Aba Mensagens ──────────────────────────────────────────────────────────

const CONTEXTO_LABELS: Record<string, string> = {
  lista_diaria:   'Lista Diária',
  sem_order_bump: 'Sem Order Bump',
  sem_upsell:     'Sem Upsell',
  reativacao:     'Reativação',
  geral:          'Geral',
}

const CONTEXTO_CORES: Record<string, string> = {
  lista_diaria:   'bg-blue-50 text-blue-700',
  sem_order_bump: 'bg-amber-50 text-amber-700',
  sem_upsell:     'bg-purple-50 text-purple-700',
  reativacao:     'bg-emerald-50 text-emerald-700',
  geral:          'bg-gray-100 text-gray-600',
}

const VARIAVEIS_TEMPLATE = ['{nome}', '{produto}', '{dias}']
const VARIAVEIS_ETAPA    = ['{nome}', '{produto}']

const CORES_TRILHA = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f59e0b',
  '#10b981', '#3b82f6', '#ef4444', '#06b6d4',
]

const EXEMPLOS: Record<string, string> = {
  '{nome}':    'João Silva',
  '{produto}': 'Conduta Masculina',
  '{dias}':    '15',
}

function substituirExemplos(texto: string, produtoEntrada?: string | null): string {
  const prod = produtoEntrada ?? EXEMPLOS['{produto}']
  return Object.entries(EXEMPLOS).reduce(
    (t, [v, ex]) => t.split(v).join(v === '{produto}' ? prod : ex),
    texto
  )
}

interface ModalState {
  template: Partial<MensagemTemplate> | null
  modo: 'criar' | 'editar'
}

// ── Modal edição de etapa de trilha ────────────────────────────────────────

function ModalEtapaEditar({
  etapa, produtoEntrada, onSave, onClose,
}: {
  etapa: EtapaCadencia
  produtoEntrada: string | null
  onSave: (id: string, dados: { nome: string; mensagem_whatsapp: string }) => Promise<void>
  onClose: () => void
}) {
  const [nome,     setNome]     = useState(etapa.nome)
  const [mensagem, setMensagem] = useState(etapa.mensagem_whatsapp)
  const [saving,   setSaving]   = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  function inserirVariavel(v: string) {
    const el = textareaRef.current
    if (!el) { setMensagem(m => m + v); return }
    const start = el.selectionStart ?? mensagem.length
    const end   = el.selectionEnd   ?? mensagem.length
    setMensagem(mensagem.slice(0, start) + v + mensagem.slice(end))
    setTimeout(() => { el.focus(); el.setSelectionRange(start + v.length, start + v.length) }, 0)
  }

  async function handleSave() {
    if (!nome.trim() || !mensagem.trim()) return
    setSaving(true)
    try { await onSave(etapa.id, { nome: nome.trim(), mensagem_whatsapp: mensagem.trim() }) }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">

        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Editar etapa</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Etapa {etapa.numero_etapa} · Dia +{etapa.dia_envio}
              {produtoEntrada && <> · <span className="text-primary-600">{produtoEntrada}</span></>}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Nome da etapa</label>
            <input
              type="text"
              value={nome}
              onChange={e => setNome(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>

          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Variáveis — clique para inserir</p>
            <div className="flex gap-2">
              {VARIAVEIS_ETAPA.map(v => (
                <button key={v} type="button" onClick={() => inserirVariavel(v)}
                  className="px-2.5 py-1 bg-gray-100 hover:bg-primary-50 hover:text-primary-700 text-gray-600 text-xs font-mono rounded-md border border-gray-200 transition-colors">
                  {v}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Mensagem WhatsApp</label>
              <textarea
                ref={textareaRef}
                value={mensagem}
                onChange={e => setMensagem(e.target.value)}
                rows={11}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                Preview · João Silva · {produtoEntrada ?? 'Produto'}
              </label>
              <div className="border border-gray-200 rounded-lg px-3 py-2.5 text-sm bg-gray-50 overflow-y-auto whitespace-pre-wrap text-gray-700" style={{ height: 256 }}>
                {mensagem
                  ? substituirExemplos(mensagem, produtoEntrada)
                  : <span className="text-gray-400 italic">A mensagem aparecerá aqui...</span>
                }
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 rounded-lg hover:bg-gray-100 transition-colors">Cancelar</button>
          <button onClick={handleSave} disabled={saving || !nome.trim() || !mensagem.trim()}
            className="px-5 py-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors">
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Acordeão de trilha ──────────────────────────────────────────────────────

function AcordaoTrilha({
  trilha,
  onEditar,
  onExcluir,
}: {
  trilha: TrilhaCadencia
  onEditar: (t: TrilhaCadencia) => void
  onExcluir: (t: TrilhaCadencia) => void
}) {
  const toast = useToast()
  const [aberto,    setAberto]    = useState(false)
  const [etapas,    setEtapas]    = useState<EtapaCadencia[] | null>(null)
  const [carregando,setCarregando]= useState(false)
  const [modalEtapa,setModalEtapa]= useState<EtapaCadencia | null>(null)

  async function toggle() {
    if (!aberto && etapas === null) {
      setCarregando(true)
      try {
        const data = await cadenciasApi.getTrilha(trilha.id)
        setEtapas(data.etapas as EtapaCadencia[])
      } catch {
        toast.error('Erro ao carregar etapas.')
      } finally {
        setCarregando(false)
      }
    }
    setAberto(a => !a)
  }

  async function salvarEtapa(id: string, dados: { nome: string; mensagem_whatsapp: string }) {
    await cadenciasApi.atualizarEtapa(id, dados)
    setEtapas(es => es?.map(e => e.id === id ? { ...e, ...dados } : e) ?? null)
    setModalEtapa(prev => prev?.id === id ? { ...prev, ...dados } : prev)
    toast.success('Mensagem salva!')
  }

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      {/* Header do acordeão — div para evitar botões aninhados */}
      <div className="w-full flex items-center justify-between px-4 py-3 bg-white hover:bg-gray-50 transition-colors">
        <div
          className="flex items-center gap-3 min-w-0 flex-1 cursor-pointer"
          onClick={toggle}
        >
          <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: trilha.cor }} />
          <span className="text-sm font-semibold text-gray-900 truncate">{trilha.nome}</span>
          {!trilha.ativa && (
            <span className="text-[10px] font-bold uppercase bg-red-50 text-red-500 px-1.5 py-0.5 rounded flex-shrink-0">inativa</span>
          )}
          {trilha.produto_entrada && (
            <span className="text-xs text-gray-400 truncate hidden md:block">
              {trilha.produto_entrada}
              {trilha.produto_destino && <> → {trilha.produto_destino}</>}
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5 flex-shrink-0 ml-2">
          <span className="text-xs text-gray-400 tabular-nums mr-1">{trilha.total_etapas} etapas</span>
          <button
            onClick={e => { e.stopPropagation(); onEditar(trilha) }}
            title="Editar trilha"
            className="p-1.5 rounded-lg text-gray-400 hover:text-primary-600 hover:bg-primary-50 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
          <button
            onClick={e => { e.stopPropagation(); onExcluir(trilha) }}
            title="Excluir trilha"
            className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
              <path d="M10 11v6M14 11v6" />
              <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
            </svg>
          </button>
          <div
            onClick={toggle}
            className="p-1.5 cursor-pointer rounded-lg text-gray-400 hover:bg-gray-100 transition-colors"
          >
            <svg
              className={`w-4 h-4 transition-transform duration-200 ${aberto ? 'rotate-180' : ''}`}
              fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>
      </div>

      {/* Etapas */}
      {aberto && (
        <div className="border-t border-gray-100">
          {carregando && (
            <div className="px-4 py-3 text-sm text-gray-400 flex items-center gap-2">
              <span className="inline-block w-3.5 h-3.5 border-2 border-gray-300 border-t-primary-500 rounded-full animate-spin" />
              Carregando etapas...
            </div>
          )}
          {etapas?.map(etapa => (
            <div
              key={etapa.id}
              className="flex items-center justify-between px-4 py-3 border-b border-gray-100 last:border-0 hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-xs font-bold text-gray-400 flex-shrink-0 tabular-nums" style={{ minWidth: 72 }}>
                  E{etapa.numero_etapa} · D+{etapa.dia_envio}
                </span>
                <span className="text-sm text-gray-700 truncate">{etapa.nome}</span>
              </div>
              <button
                onClick={() => setModalEtapa(etapa)}
                className="flex-shrink-0 ml-3 px-3 py-1 text-xs font-medium text-primary-600 hover:text-primary-700 hover:bg-primary-50 rounded-lg transition-colors border border-primary-200"
              >
                Editar
              </button>
            </div>
          ))}
          {etapas?.length === 0 && (
            <div className="px-4 py-3 text-sm text-gray-400">Nenhuma etapa cadastrada.</div>
          )}
        </div>
      )}

      {modalEtapa && (
        <ModalEtapaEditar
          etapa={modalEtapa}
          produtoEntrada={trilha.produto_entrada}
          onSave={salvarEtapa}
          onClose={() => setModalEtapa(null)}
        />
      )}
    </div>
  )
}

// ── Modal criar trilha ─────────────────────────────────────────────────────

function ModalCriarTrilha({
  produtos,
  onSave,
  onClose,
}: {
  produtos: Produto[]
  onSave: (data: {
    nome: string; tipo_pipeline: 'ativo' | 'reativacao'
    produto_entrada_id: string | null; produto_destino_id: string | null
    cor: string; num_etapas: number
  }) => Promise<void>
  onClose: () => void
}) {
  const [nome,      setNome]      = useState('')
  const [tipo,      setTipo]      = useState<'ativo' | 'reativacao'>('ativo')
  const [entradaId, setEntradaId] = useState('')
  const [destinoId, setDestinoId] = useState('')
  const [cor,       setCor]       = useState(CORES_TRILHA[0])
  const [numEtapas, setNumEtapas] = useState(5)
  const [saving,    setSaving]    = useState(false)

  async function handleSave() {
    if (!nome.trim()) return
    setSaving(true)
    try {
      await onSave({
        nome: nome.trim(), tipo_pipeline: tipo,
        produto_entrada_id: entradaId || null,
        produto_destino_id: destinoId || null,
        cor, num_etapas: numEtapas,
      })
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Nova trilha de cadência</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Nome da trilha</label>
            <input
              type="text" value={nome} onChange={e => setNome(e.target.value)}
              placeholder="Ex: Pós-compra Produto X"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Tipo</label>
            <div className="flex gap-2">
              {(['ativo', 'reativacao'] as const).map(t => (
                <button key={t} type="button" onClick={() => setTipo(t)}
                  className={[
                    'flex-1 py-2 text-sm font-medium rounded-lg border transition-colors',
                    tipo === t
                      ? 'bg-primary-600 text-white border-primary-600'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-primary-300',
                  ].join(' ')}
                >
                  {t === 'ativo' ? 'Fluxo Ativo' : 'Reativação'}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Produto de entrada</label>
            <select value={entradaId} onChange={e => setEntradaId(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500">
              <option value="">— Selecionar —</option>
              {produtos.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Produto destino (upsell)</label>
            <select value={destinoId} onChange={e => setDestinoId(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500">
              <option value="">— Selecionar —</option>
              {produtos.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Cor da trilha</label>
            <div className="flex gap-2">
              {CORES_TRILHA.map(c => (
                <button key={c} type="button" onClick={() => setCor(c)}
                  className={['w-7 h-7 rounded-full border-2 transition-all', cor === c ? 'border-gray-900 scale-110' : 'border-transparent'].join(' ')}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Número de etapas</label>
            <select value={numEtapas} onChange={e => setNumEtapas(Number(e.target.value))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500">
              {[3, 4, 5, 6].map(n => <option key={n} value={n}>{n} etapas</option>)}
            </select>
            <p className="text-xs text-gray-400 mt-1">As mensagens padrão são criadas automaticamente e podem ser editadas depois.</p>
          </div>
        </div>

        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 rounded-lg hover:bg-gray-100 transition-colors">Cancelar</button>
          <button onClick={handleSave} disabled={saving || !nome.trim()}
            className="px-5 py-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors">
            {saving ? 'Criando...' : 'Criar trilha'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Modal editar trilha ────────────────────────────────────────────────────

function ModalEditarTrilha({
  trilha,
  produtos,
  onSave,
  onClose,
}: {
  trilha: TrilhaCadencia
  produtos: Produto[]
  onSave: (id: string, data: {
    nome: string; tipo_pipeline: 'ativo' | 'reativacao'
    produto_entrada_id: string | null; produto_destino_id: string | null
    cor: string; ativa: boolean
  }) => Promise<void>
  onClose: () => void
}) {
  const encontrarId = (nome: string | null) =>
    nome ? (produtos.find(p => p.nome === nome)?.id ?? '') : ''

  const [nome,      setNome]      = useState(trilha.nome)
  const [tipo,      setTipo]      = useState<'ativo' | 'reativacao'>(
    trilha.tipo_pipeline === 'reativacao' ? 'reativacao' : 'ativo'
  )
  const [entradaId, setEntradaId] = useState(encontrarId(trilha.produto_entrada))
  const [destinoId, setDestinoId] = useState(encontrarId(trilha.produto_destino))
  const [cor,       setCor]       = useState(trilha.cor)
  const [ativa,     setAtiva]     = useState(trilha.ativa)
  const [saving,    setSaving]    = useState(false)

  async function handleSave() {
    if (!nome.trim()) return
    setSaving(true)
    try {
      await onSave(trilha.id, {
        nome: nome.trim(), tipo_pipeline: tipo,
        produto_entrada_id: entradaId || null,
        produto_destino_id: destinoId || null,
        cor, ativa,
      })
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Editar trilha</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Nome da trilha</label>
            <input
              type="text" value={nome} onChange={e => setNome(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Tipo</label>
            <div className="flex gap-2">
              {(['ativo', 'reativacao'] as const).map(t => (
                <button key={t} type="button" onClick={() => setTipo(t)}
                  className={[
                    'flex-1 py-2 text-sm font-medium rounded-lg border transition-colors',
                    tipo === t
                      ? 'bg-primary-600 text-white border-primary-600'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-primary-300',
                  ].join(' ')}
                >
                  {t === 'ativo' ? 'Fluxo Ativo' : 'Reativação'}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Produto de entrada</label>
            <select value={entradaId} onChange={e => setEntradaId(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500">
              <option value="">— Selecionar —</option>
              {produtos.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Produto destino (upsell)</label>
            <select value={destinoId} onChange={e => setDestinoId(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500">
              <option value="">— Selecionar —</option>
              {produtos.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Cor da trilha</label>
            <div className="flex gap-2">
              {CORES_TRILHA.map(c => (
                <button key={c} type="button" onClick={() => setCor(c)}
                  className={['w-7 h-7 rounded-full border-2 transition-all', cor === c ? 'border-gray-900 scale-110' : 'border-transparent'].join(' ')}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox" checked={ativa} onChange={e => setAtiva(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
            />
            <span className="text-sm text-gray-700">Trilha ativa</span>
          </label>
        </div>

        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 rounded-lg hover:bg-gray-100 transition-colors">Cancelar</button>
          <button onClick={handleSave} disabled={saving || !nome.trim()}
            className="px-5 py-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors">
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ModalMensagem({
  estado, onSave, onClose,
}: {
  estado: ModalState
  onSave: (data: { nome: string; texto: string; contexto: string; ativa: boolean }, id?: string) => Promise<void>
  onClose: () => void
}) {
  const { template, modo } = estado
  const [nome,     setNome]     = useState(template?.nome     ?? '')
  const [texto,    setTexto]    = useState(template?.texto    ?? '')
  const [contexto, setContexto] = useState(template?.contexto ?? 'geral')
  const [ativa,    setAtiva]    = useState(template?.ativa    ?? true)
  const [saving,   setSaving]   = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  function inserirVariavel(v: string) {
    const el = textareaRef.current
    if (!el) { setTexto(t => t + v); return }
    const start = el.selectionStart ?? texto.length
    const end   = el.selectionEnd   ?? texto.length
    const novo  = texto.slice(0, start) + v + texto.slice(end)
    setTexto(novo)
    setTimeout(() => {
      el.focus()
      el.setSelectionRange(start + v.length, start + v.length)
    }, 0)
  }

  async function handleSave() {
    if (!nome.trim() || !texto.trim()) return
    setSaving(true)
    try {
      await onSave({ nome: nome.trim(), texto: texto.trim(), contexto, ativa }, template?.id)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">
            {modo === 'criar' ? 'Nova mensagem' : 'Editar mensagem'}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5">

          {/* Nome + contexto */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Nome</label>
              <input
                type="text"
                value={nome}
                onChange={e => setNome(e.target.value)}
                placeholder="Ex: Acompanhamento dia 3"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Contexto</label>
              <select
                value={contexto}
                onChange={e => setContexto(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                {Object.entries(CONTEXTO_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Variáveis disponíveis */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Variáveis disponíveis — clique para inserir
            </p>
            <div className="flex flex-wrap gap-2">
              {VARIAVEIS_TEMPLATE.map(v => (
                <button
                  key={v}
                  type="button"
                  onClick={() => inserirVariavel(v)}
                  className="px-2.5 py-1 bg-gray-100 hover:bg-primary-50 hover:text-primary-700 text-gray-600 text-xs font-mono rounded-md border border-gray-200 transition-colors"
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          {/* Editor + preview lado a lado */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Texto da mensagem</label>
              <textarea
                ref={textareaRef}
                value={texto}
                onChange={e => setTexto(e.target.value)}
                rows={10}
                placeholder="Digite a mensagem aqui..."
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                Preview (variáveis substituídas)
              </label>
              <div className="h-[234px] border border-gray-200 rounded-lg px-3 py-2.5 text-sm bg-gray-50 overflow-y-auto whitespace-pre-wrap text-gray-700">
                {texto ? substituirExemplos(texto) : <span className="text-gray-400 italic">A mensagem aparecerá aqui...</span>}
              </div>
            </div>
          </div>

          {/* Ativa */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={ativa}
              onChange={e => setAtiva(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
            />
            <span className="text-sm text-gray-700">Template ativo</span>
          </label>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 rounded-lg hover:bg-gray-100 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !nome.trim() || !texto.trim()}
            className="px-5 py-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors"
          >
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Templates Gerais (seção inferior da aba) ────────────────────────────────

function TemplatesGerais() {
  const toast = useToast()
  const [templates, setTemplates] = useState<MensagemTemplate[]>([])
  const [loading,   setLoading]   = useState(true)
  const [modal,     setModal]     = useState<ModalState | null>(null)
  const [excluindo, setExcluindo] = useState<string | null>(null)

  useEffect(() => {
    mensagensApi.list()
      .then(setTemplates)
      .catch(() => toast.error('Erro ao carregar templates.'))
      .finally(() => setLoading(false))
  }, [])

  async function handleSave(data: { nome: string; texto: string; contexto: string; ativa: boolean }, id?: string) {
    try {
      if (id) {
        const updated = await mensagensApi.update(id, data)
        setTemplates(ts => ts.map(t => t.id === id ? updated : t))
        toast.success('Template atualizado!')
      } else {
        const created = await mensagensApi.create(data)
        setTemplates(ts => [...ts, created])
        toast.success('Template criado!')
      }
    } catch {
      toast.error('Erro ao salvar template.')
      throw new Error('save failed')
    }
  }

  async function handleDuplicar(t: MensagemTemplate) {
    try {
      const novo = await mensagensApi.duplicar(t.id)
      setTemplates(ts => [...ts, novo])
      toast.success(`"${t.nome}" duplicado!`)
    } catch { toast.error('Erro ao duplicar.') }
  }

  async function handleExcluir(t: MensagemTemplate) {
    if (t.is_sistema) return
    if (!window.confirm(`Excluir "${t.nome}"? Esta ação não pode ser desfeita.`)) return
    setExcluindo(t.id)
    try {
      await mensagensApi.delete(t.id)
      setTemplates(ts => ts.filter(x => x.id !== t.id))
      toast.success('Template excluído.')
    } catch { toast.error('Erro ao excluir.') }
    finally { setExcluindo(null) }
  }

  const grupos = templates.reduce<Record<string, MensagemTemplate[]>>((acc, t) => {
    ;(acc[t.contexto] ??= []).push(t)
    return acc
  }, {})

  const ordemContextos = ['lista_diaria', 'sem_order_bump', 'sem_upsell', 'reativacao', 'geral']
  const contextosOrdenados = [
    ...ordemContextos.filter(c => grupos[c]),
    ...Object.keys(grupos).filter(c => !ordemContextos.includes(c)),
  ]

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="text-base font-semibold text-gray-900">Templates Gerais</span>
          {!loading && (
            <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
              {templates.length}
            </span>
          )}
        </div>
        <button
          onClick={() => setModal({ template: {}, modo: 'criar' })}
          className="flex items-center gap-2 px-3 py-1.5 bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold rounded-lg transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
          </svg>
          Novo template
        </button>
      </div>

      {loading && <div className="text-gray-400 text-sm py-2">Carregando templates...</div>}

      {!loading && templates.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 px-6 py-8 text-center">
          <p className="text-gray-400 text-sm">Nenhum template cadastrado.</p>
        </div>
      )}

      {contextosOrdenados.map(ctx => (
        <div key={ctx} className="mb-4">
          <div className="flex items-center gap-2 mb-2">
            <span className={`text-xs font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${CONTEXTO_CORES[ctx] ?? 'bg-gray-100 text-gray-600'}`}>
              {CONTEXTO_LABELS[ctx] ?? ctx}
            </span>
            <span className="text-xs text-gray-400">{grupos[ctx].length}</span>
          </div>
          <div className="space-y-1.5">
            {grupos[ctx].map(t => (
              <div key={t.id} className="bg-white rounded-xl border border-gray-200 px-4 py-3 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-medium text-gray-900 truncate">{t.nome}</span>
                    {t.is_sistema && <span className="text-[10px] font-bold uppercase bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">sistema</span>}
                    {!t.ativa && <span className="text-[10px] font-bold uppercase bg-red-50 text-red-500 px-1.5 py-0.5 rounded">inativo</span>}
                  </div>
                  <p className="text-xs text-gray-400 line-clamp-1 whitespace-pre-wrap">{t.texto}</p>
                </div>
                <div className="flex items-center gap-0.5 flex-shrink-0">
                  <button onClick={() => setModal({ template: t, modo: 'editar' })} title="Editar"
                    className="p-1.5 rounded-lg text-gray-400 hover:text-primary-600 hover:bg-primary-50 transition-colors">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                  </button>
                  <button onClick={() => handleDuplicar(t)} title="Duplicar"
                    className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg>
                  </button>
                  <button onClick={() => handleExcluir(t)} disabled={t.is_sistema || excluindo === t.id}
                    title={t.is_sistema ? 'Templates do sistema não podem ser excluídos' : 'Excluir'}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" /></svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {modal && (
        <ModalMensagem
          estado={modal}
          onSave={handleSave}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  )
}

// ── Aba Mensagens principal ─────────────────────────────────────────────────

function AbaMensagens() {
  const toast = useToast()
  const [trilhas,       setTrilhas]       = useState<TrilhaCadencia[]>([])
  const [produtos,      setProdutos]      = useState<Produto[]>([])
  const [carregando,    setCarregando]    = useState(true)
  const [modalCriar,    setModalCriar]    = useState(false)
  const [editandoTrilha,setEditandoTrilha]= useState<TrilhaCadencia | null>(null)

  async function carregarTrilhas() {
    const r = await cadenciasApi.listaTrilhas()
    setTrilhas(r.trilhas)
  }

  useEffect(() => {
    Promise.all([cadenciasApi.listaTrilhas(), produtosApi.list()])
      .then(([r, prods]) => { setTrilhas(r.trilhas); setProdutos(prods) })
      .catch(() => toast.error('Erro ao carregar dados.'))
      .finally(() => setCarregando(false))
  }, [])

  async function handleCriarTrilha(data: Parameters<typeof cadenciasApi.criarTrilha>[0]) {
    await cadenciasApi.criarTrilha(data)
    toast.success('Trilha criada!')
    setModalCriar(false)
    await carregarTrilhas()
  }

  async function handleEditarTrilha(id: string, data: Parameters<typeof cadenciasApi.editarTrilha>[1]) {
    await cadenciasApi.editarTrilha(id, data)
    toast.success('Trilha atualizada!')
    setEditandoTrilha(null)
    await carregarTrilhas()
  }

  async function handleExcluirTrilha(trilha: TrilhaCadencia) {
    if (!window.confirm(`Excluir a trilha "${trilha.nome}"? Esta ação não pode ser desfeita.`)) return
    try {
      await cadenciasApi.excluirTrilha(trilha.id)
      toast.success('Trilha excluída.')
      await carregarTrilhas()
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Erro ao excluir trilha.')
    }
  }

  const ativo      = trilhas.filter(t => !t.tipo_pipeline || t.tipo_pipeline === 'ativo')
  const reativacao = trilhas.filter(t => t.tipo_pipeline === 'reativacao')

  if (carregando) {
    return <div className="text-gray-400 text-sm py-4 flex items-center gap-2">
      <span className="inline-block w-4 h-4 border-2 border-gray-200 border-t-primary-500 rounded-full animate-spin" />
      Carregando trilhas...
    </div>
  }

  return (
    <div className="space-y-8">

      {/* ── Fluxo Ativo ── */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <svg className="w-4 h-4 text-amber-500" fill="currentColor" viewBox="0 0 24 24">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
          <h2 className="text-sm font-bold text-gray-700 uppercase tracking-widest">Fluxo Ativo</h2>
          <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{ativo.length} trilha{ativo.length !== 1 ? 's' : ''}</span>
          <button
            onClick={() => setModalCriar(true)}
            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 bg-primary-600 hover:bg-primary-700 text-white text-xs font-semibold rounded-lg transition-colors"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
            </svg>
            Nova trilha
          </button>
        </div>
        {ativo.length > 0 ? (
          <div className="space-y-2">
            {ativo.map(t => (
              <AcordaoTrilha
                key={t.id} trilha={t}
                onEditar={setEditandoTrilha}
                onExcluir={handleExcluirTrilha}
              />
            ))}
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 px-6 py-8 text-center">
            <p className="text-gray-400 text-sm">Nenhuma trilha de Fluxo Ativo ainda.</p>
          </div>
        )}
      </div>

      {/* ── Reativação ── */}
      {reativacao.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <svg className="w-4 h-4 text-emerald-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M3 2v6h6" /><path d="M3 13a9 9 0 1 0 3-7.7L3 8" />
            </svg>
            <h2 className="text-sm font-bold text-gray-700 uppercase tracking-widest">Reativação</h2>
            <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{reativacao.length} trilha{reativacao.length !== 1 ? 's' : ''}</span>
          </div>
          <div className="space-y-2">
            {reativacao.map(t => (
              <AcordaoTrilha
                key={t.id} trilha={t}
                onEditar={setEditandoTrilha}
                onExcluir={handleExcluirTrilha}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Divisor ── */}
      <div className="border-t border-gray-200 pt-6">
        <TemplatesGerais />
      </div>

      {modalCriar && (
        <ModalCriarTrilha
          produtos={produtos}
          onSave={handleCriarTrilha}
          onClose={() => setModalCriar(false)}
        />
      )}
      {editandoTrilha && (
        <ModalEditarTrilha
          trilha={editandoTrilha}
          produtos={produtos}
          onSave={handleEditarTrilha}
          onClose={() => setEditandoTrilha(null)}
        />
      )}
    </div>
  )
}

// ── Configuracoes ──────────────────────────────────────────────────────────

export default function Configuracoes() {
  const [aba, setAba] = useState<Aba>('geral')

  const ABAS: { id: Aba; label: string }[] = [
    { id: 'geral',      label: 'Geral'      },
    { id: 'funil',      label: 'Funil'      },
    { id: 'comercial',  label: 'Comercial'  },
    { id: 'mensagens',  label: 'Mensagens'  },
    { id: 'telefones',  label: 'Telefones'  },
  ]

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Configurações</h1>

      <div className="flex border-b border-gray-200 mb-6 overflow-x-auto">
        {ABAS.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setAba(id)}
            className={[
              'px-5 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap',
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
      {aba === 'mensagens' && <AbaMensagens />}
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
