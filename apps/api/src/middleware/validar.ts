import { z, type ZodSchema } from 'zod'
import type { Request, Response, NextFunction } from 'express'

/**
 * Middleware de validação com Zod.
 * Retorna 400 com { error, campos: [{campo, mensagem}] } se o body não for válido.
 */
export function validar<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body)
    if (!result.success) {
      const campos = result.error.errors.map(e => ({
        campo:    e.path.length > 0 ? e.path.join('.') : 'body',
        mensagem: e.message,
      }))
      res.status(400).json({ error: 'Dados inválidos', campos })
      return
    }
    req.body = result.data
    next()
  }
}

// ── Schemas reutilizáveis ──────────────────────────────────────────────────

export const atualizarContatoSchema = z.object({
  status_contato: z.enum(['pendente', 'contatado', 'sem_resposta', 'nao_pertence', 'convertido'], {
    errorMap: () => ({ message: 'status_contato inválido' }),
  }),
  observacao: z.string().max(500, 'Observação muito longa (máx 500 caracteres)').optional(),
})

export const syncManualSchema = z.object({
  full: z.boolean().optional(),
})

export const salvarConfiguracaoSchema = z.object({
  valor: z.string().max(2000, 'Valor muito longo'),
})
