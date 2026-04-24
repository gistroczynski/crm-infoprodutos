import { Request, Response, NextFunction } from 'express'

export function apenasAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.usuario) {
    res.status(401).json({ error: 'Não autenticado.' })
    return
  }
  if (req.usuario.perfil !== 'admin') {
    res.status(403).json({ error: 'Acesso restrito a administradores.' })
    return
  }
  next()
}
