interface ErroApiProps {
  mensagem?: string
  onRetry?: () => void
}

/**
 * Componente reutilizável para exibir erros de API com botão de retry opcional.
 */
export default function ErroApi({
  mensagem = 'Erro ao carregar os dados.',
  onRetry,
}: ErroApiProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
      <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
        <svg className="w-6 h-6 text-red-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      </div>

      <div>
        <p className="text-sm font-medium text-gray-700">{mensagem}</p>
        <p className="text-xs text-gray-400 mt-0.5">Verifique a conexão com a API.</p>
      </div>

      {onRetry && (
        <button
          onClick={onRetry}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-primary-600 border border-primary-300 rounded-lg hover:bg-primary-50 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Tentar novamente
        </button>
      )}
    </div>
  )
}
