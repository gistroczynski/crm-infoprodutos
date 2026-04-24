import { Navigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import type { ReactNode } from 'react'

interface Props {
  children: ReactNode
  apenasAdmin?: boolean
}

export function ProtectedRoute({ children, apenasAdmin = false }: Props) {
  const { usuario, isLoading } = useAuth()

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="w-8 h-8 border-4 border-[#D2191F] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!usuario) return <Navigate to="/login" replace />
  if (apenasAdmin && usuario.perfil !== 'admin') return <Navigate to="/" replace />

  return <>{children}</>
}
