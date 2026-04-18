import { useRef, useState } from 'react'
import type { StatusContato } from '../api/client'

interface Props {
  link: string | null
  onAcao: (status: StatusContato) => void
  desabilitado?: boolean
}

const opcoes: { label: string; value: StatusContato; cor: string }[] = [
  { label: 'Marcar como contatado', value: 'contatado',    cor: 'text-emerald-700' },
  { label: 'Sem resposta',          value: 'sem_resposta', cor: 'text-amber-600'   },
  { label: 'Convertido! 🎉',        value: 'convertido',   cor: 'text-blue-700'    },
  { label: 'Número inválido',       value: 'nao_pertence', cor: 'text-red-600'     },
]

export default function WhatsAppButton({ link, onAcao, desabilitado = false }: Props) {
  const [aberto, setAberto] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  function abrirWhatsApp() {
    if (link) window.open(link, '_blank', 'noopener,noreferrer')
  }

  function escolher(valor: StatusContato) {
    setAberto(false)
    onAcao(valor)
  }

  return (
    <div ref={containerRef} className="relative flex items-center gap-1" onClick={e => e.stopPropagation()}>
      {/* Botão WhatsApp */}
      <button
        onClick={abrirWhatsApp}
        disabled={!link || desabilitado}
        title={link ? 'Abrir conversa no WhatsApp' : 'Telefone não disponível'}
        className={[
          'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors',
          link && !desabilitado
            ? 'bg-emerald-500 hover:bg-emerald-600 text-white'
            : 'bg-gray-100 text-gray-400 cursor-not-allowed',
        ].join(' ')}
      >
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
          <path d="M12 0C5.373 0 0 5.373 0 12c0 2.123.554 4.118 1.528 5.852L.057 23.5l5.797-1.52A11.93 11.93 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.847 0-3.575-.476-5.083-1.312l-.364-.215-3.44.902.918-3.352-.236-.384A9.955 9.955 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/>
        </svg>
        WhatsApp
        {link && <span className="opacity-70">↗</span>}
      </button>

      {/* Dropdown de ações */}
      <div className="relative">
        <button
          onClick={() => setAberto(a => !a)}
          disabled={desabilitado}
          className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-40"
          title="Mais opções"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {aberto && (
          <>
            {/* Overlay para fechar */}
            <div className="fixed inset-0 z-10" onClick={() => setAberto(false)} />
            <div className="absolute right-0 top-8 z-20 w-52 bg-white rounded-xl shadow-lg border border-gray-100 py-1 overflow-hidden">
              {opcoes.map(op => (
                <button
                  key={op.value}
                  onClick={() => escolher(op.value)}
                  className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-50 transition-colors ${op.cor}`}
                >
                  {op.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
