import { Router, Request, Response } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { queryOne } from '../db'
import { authMiddleware } from '../middleware/auth'

export const authRouter = Router()

const JWT_SECRET  = process.env.JWT_SECRET ?? 'ogc_crm_secret_2026'
const JWT_EXPIRES = '7d'

// ── POST /api/auth/login ───────────────────────────────────────────────────
authRouter.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, senha } = req.body as { email?: string; senha?: string }

    if (!email || !senha) {
      return res.status(400).json({ error: 'Email e senha são obrigatórios.' })
    }

    const usuario = await queryOne<{
      id: string; nome: string; senha_hash: string; perfil: string; ativo: boolean
    }>(
      'SELECT id, nome, senha_hash, perfil, ativo FROM usuarios WHERE email = $1',
      [email.trim().toLowerCase()]
    )

    if (!usuario || !usuario.ativo) {
      return res.status(401).json({ error: 'Credenciais inválidas.' })
    }

    const senhaOk = await bcrypt.compare(senha, usuario.senha_hash)
    if (!senhaOk) {
      return res.status(401).json({ error: 'Credenciais inválidas.' })
    }

    const payload = { id: usuario.id, nome: usuario.nome, perfil: usuario.perfil }
    const token   = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES })

    res.json({ token, usuario: payload })
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})

// ── GET /api/auth/me ───────────────────────────────────────────────────────
// authMiddleware aplicado aqui porque /api/auth é registrado antes do
// middleware global em index.ts (necessário para /login ser público).
authRouter.get('/me', authMiddleware, (_req: Request, res: Response) => {
  res.json({ usuario: _req.usuario })
})
