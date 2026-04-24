import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import logoOgc from '../assets/logo-ogc.svg'

export default function Login() {
  const { login } = useAuth()
  const navigate  = useNavigate()

  const [email,    setEmail]    = useState('')
  const [senha,    setSenha]    = useState('')
  const [erro,     setErro]     = useState('')
  const [loading,  setLoading]  = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setErro('')
    setLoading(true)
    try {
      await login(email.trim(), senha)
      navigate('/', { replace: true })
    } catch {
      setErro('Email ou senha incorretos.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#111111]">
      <div className="w-full max-w-sm">
        {/* Logo + título */}
        <div className="flex flex-col items-center mb-8">
          <img src={logoOgc} alt="OGC" className="w-16 h-16 mb-4" />
          <h1 className="text-2xl font-bold text-white tracking-wide">CRM OGC</h1>
          <p className="text-gray-400 text-sm mt-1">Entre com suas credenciais</p>
        </div>

        {/* Card */}
        <div className="bg-[#1a1a1a] rounded-2xl p-8 shadow-2xl border border-white/10">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder="seu@email.com"
                className="w-full px-4 py-3 rounded-xl bg-[#252525] border border-white/10 text-white placeholder-gray-600
                           focus:outline-none focus:border-[#D2191F] focus:ring-1 focus:ring-[#D2191F] transition"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                Senha
              </label>
              <input
                type="password"
                value={senha}
                onChange={e => setSenha(e.target.value)}
                required
                autoComplete="current-password"
                placeholder="••••••••"
                className="w-full px-4 py-3 rounded-xl bg-[#252525] border border-white/10 text-white placeholder-gray-600
                           focus:outline-none focus:border-[#D2191F] focus:ring-1 focus:ring-[#D2191F] transition"
              />
            </div>

            {erro && (
              <p className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
                {erro}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl bg-[#D2191F] hover:bg-[#b01218] text-white font-semibold
                         transition disabled:opacity-60 disabled:cursor-not-allowed mt-2"
            >
              {loading ? 'Entrando...' : 'Entrar'}
            </button>
          </form>
        </div>

        <p className="text-center text-gray-600 text-xs mt-6">v1.0.0</p>
      </div>
    </div>
  )
}
