import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import api from '../services/api'

export interface UsuarioJWT {
  id:     string
  nome:   string
  perfil: 'comercial' | 'admin'
}

interface AuthContextType {
  usuario:   UsuarioJWT | null
  token:     string | null
  login:     (email: string, senha: string) => Promise<void>
  logout:    () => void
  isLoading: boolean
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [usuario,   setUsuario]   = useState<UsuarioJWT | null>(null)
  const [token,     setToken]     = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const saved = localStorage.getItem('auth-token')
    if (saved) {
      setToken(saved)
      api.defaults.headers.common['Authorization'] = `Bearer ${saved}`
      api.get<{ usuario: UsuarioJWT }>('/api/auth/me')
        .then(r => setUsuario(r.data.usuario))
        .catch(() => {
          localStorage.removeItem('auth-token')
          setToken(null)
          delete api.defaults.headers.common['Authorization']
        })
        .finally(() => setIsLoading(false))
    } else {
      setIsLoading(false)
    }
  }, [])

  async function login(email: string, senha: string) {
    const { data } = await api.post<{ token: string; usuario: UsuarioJWT }>(
      '/api/auth/login', { email, senha }
    )
    localStorage.setItem('auth-token', data.token)
    api.defaults.headers.common['Authorization'] = `Bearer ${data.token}`
    setToken(data.token)
    setUsuario(data.usuario)
  }

  function logout() {
    localStorage.removeItem('auth-token')
    delete api.defaults.headers.common['Authorization']
    setToken(null)
    setUsuario(null)
  }

  return (
    <AuthContext.Provider value={{ usuario, token, login, logout, isLoading }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
