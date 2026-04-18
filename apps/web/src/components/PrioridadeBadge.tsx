import type { Prioridade } from '../api/client'

const estilos: Record<Prioridade, string> = {
  alta:  'bg-red-100 text-red-700 ring-1 ring-red-200',
  media: 'bg-amber-100 text-amber-700 ring-1 ring-amber-200',
  baixa: 'bg-gray-100 text-gray-500 ring-1 ring-gray-200',
}

const rotulos: Record<Prioridade, string> = {
  alta:  'Alta',
  media: 'Média',
  baixa: 'Baixa',
}

interface Props {
  prioridade: Prioridade
  className?: string
}

export default function PrioridadeBadge({ prioridade, className = '' }: Props) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${estilos[prioridade]} ${className}`}>
      {rotulos[prioridade]}
    </span>
  )
}
