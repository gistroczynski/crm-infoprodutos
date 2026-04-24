import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'

export interface UsuarioJWT {
  id:     string
  nome:   string
  perfil: 'comercial' | 'admin'
}

// Rotas públicas que não exigem JWT
const ROTAS_PUBLICAS = ['/health', '/api/auth/login']
const PREFIXOS_PUBLICOS = ['/api/webhook']

declare global {
  namespace Express {
    interface Request { usuario?: UsuarioJWT }
  }
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Deixa passar rotas públicas
  if (ROTAS_PUBLICAS.includes(req.path)) { next(); return }
  if (PREFIXOS_PUBLICOS.some(p => req.path.startsWith(p))) { next(); return }

  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Token de autenticação ausente.' })
    return
  }

  const token  = authHeader.slice(7)
  const secret = process.env.JWT_SECRET ?? 'ogc_crm_secret_2026'

  try {
    const payload = jwt.verify(token, secret) as UsuarioJWT
    req.usuario   = payload
    next()
  } catch {
    res.status(401).json({ error: 'Token inválido ou expirado.' })
  }
}
