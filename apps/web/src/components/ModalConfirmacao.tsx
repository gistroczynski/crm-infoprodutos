interface ModalConfirmacaoProps {
  aberto: boolean
  titulo: string
  mensagem: string
  labelConfirmar?: string
  labelCancelar?: string
  variante?: 'danger' | 'default'
  carregando?: boolean
  onConfirmar: () => void
  onCancelar: () => void
}

/**
 * Modal de confirmação genérico para ações destrutivas ou importantes.
 */
export default function ModalConfirmacao({
  aberto,
  titulo,
  mensagem,
  labelConfirmar = 'Confirmar',
  labelCancelar  = 'Cancelar',
  variante       = 'default',
  carregando     = false,
  onConfirmar,
  onCancelar,
}: ModalConfirmacaoProps) {
  if (!aberto) return null

  const btnConfirmar = variante === 'danger'
    ? 'bg-red-600 hover:bg-red-700 focus:ring-red-500'
    : 'bg-primary-600 hover:bg-primary-700 focus:ring-primary-500'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onCancelar}
      />

      {/* Painel */}
      <div className="relative bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 z-10">
        <h3 id="modal-title" className="text-base font-semibold text-gray-900 mb-2">
          {titulo}
        </h3>
        <p className="text-sm text-gray-500 leading-relaxed mb-6">{mensagem}</p>

        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancelar}
            disabled={carregando}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-300 disabled:opacity-50 transition-colors"
          >
            {labelCancelar}
          </button>
          <button
            onClick={onConfirmar}
            disabled={carregando}
            className={[
              'flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-lg',
              'focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 transition-colors',
              btnConfirmar,
            ].join(' ')}
          >
            {carregando && (
              <span className="inline-block w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            )}
            {labelConfirmar}
          </button>
        </div>
      </div>
    </div>
  )
}
