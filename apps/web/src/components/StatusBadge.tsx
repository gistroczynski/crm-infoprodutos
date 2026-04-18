import type { StatusCliente } from '../api/client'

const estilos: Record<StatusCliente, string> = {
  novo:     'bg-blue-100 text-blue-700 ring-1 ring-blue-200',
  nutricao: 'bg-purple-100 text-purple-700 ring-1 ring-purple-200',
  pronto:   'bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200',
  inativo:  'bg-gray-100 text-gray-500 ring-1 ring-gray-200',
}

const rotulos: Record<StatusCliente, string> = {
  novo:     'Novo',
  nutricao: 'Nutrição',
  pronto:   'Pronto',
  inativo:  'Inativo',
}

interface Props {
  status: StatusCliente
  className?: string
}

export default function StatusBadge({ status, className = '' }: Props) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${estilos[status]} ${className}`}>
      {rotulos[status]}
    </span>
  )
}
