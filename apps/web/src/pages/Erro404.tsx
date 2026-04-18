import { useNavigate } from 'react-router-dom'

export default function Erro404() {
  const navigate = useNavigate()

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center gap-3 px-4">
      <p className="text-8xl font-black text-gray-100 select-none leading-none">404</p>
      <h1 className="text-2xl font-bold text-gray-800">Página não encontrada</h1>
      <p className="text-sm text-gray-500 max-w-xs">
        A página que você está procurando não existe ou foi movida.
      </p>
      <button
        onClick={() => navigate(-1)}
        className="mt-3 px-5 py-2.5 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 transition-colors"
      >
        Voltar
      </button>
    </div>
  )
}
