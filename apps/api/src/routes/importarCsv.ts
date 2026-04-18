import { Router, Request, Response } from 'express'
import multer from 'multer'
import { parse } from 'csv-parse'
import { Readable } from 'stream'
import { pool, queryOne } from '../db'
import { formatarTelefone } from '../services/hotmart'

export const importarCsvRouter = Router()

// ── Multer: memória (sem salvar em disco) ──────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true)
    } else {
      cb(new Error('Apenas arquivos CSV são aceitos'))
    }
  },
})

// ── Normalização de cabeçalhos ─────────────────────────────────────────────
//    Remove acentos, lowercase, trim
function normalizar(str: string): string {
  return str
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')  // remove diacríticos
    .replace(/[^a-z0-9 ]/g, ' ')     // substitui especiais por espaço
    .replace(/\s+/g, ' ')
    .trim()
}

const MAPA_EMAIL     = new Set(['email', 'e mail', 'e mail do comprador', 'email do comprador'])
const MAPA_TELEFONE  = new Set(['telefone', 'phone', 'celular', 'telefone do comprador', 'numero', 'numero de telefone'])

function detectarColunas(cabecalhos: string[]): { emailCol: string | null; telefoneCol: string | null } {
  let emailCol:    string | null = null
  let telefoneCol: string | null = null

  for (const h of cabecalhos) {
    const n = normalizar(h)
    if (!emailCol    && MAPA_EMAIL.has(n))    emailCol    = h
    if (!telefoneCol && MAPA_TELEFONE.has(n)) telefoneCol = h
  }

  return { emailCol, telefoneCol }
}

// ── Parseia CSV do buffer ──────────────────────────────────────────────────
async function parsearCsv(buffer: Buffer): Promise<Record<string, string>[]> {
  return new Promise((resolve, reject) => {
    const registros: Record<string, string>[] = []
    const stream = Readable.from(buffer)

    stream
      .pipe(parse({ columns: true, skip_empty_lines: true, trim: true, bom: true }))
      .on('data', (row: Record<string, string>) => registros.push(row))
      .on('end',  () => resolve(registros))
      .on('error', reject)
  })
}

// ── GET /api/clientes/importar-csv/template ────────────────────────────────
importarCsvRouter.get('/template', (_req: Request, res: Response) => {
  const csv = [
    'email,telefone',
    'joao@exemplo.com,11999999999',
    'maria@exemplo.com,21988887777',
  ].join('\r\n')

  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', 'attachment; filename="modelo-telefones.csv"')
  res.send('\uFEFF' + csv) // BOM para Excel reconhecer UTF-8
})

// ── POST /api/clientes/importar-csv ───────────────────────────────────────
importarCsvRouter.post('/', upload.single('arquivo'), async (req: Request, res: Response) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Nenhum arquivo enviado. Use o campo "arquivo".' })
  }

  try {
    const registros = await parsearCsv(req.file.buffer)

    if (registros.length === 0) {
      return res.status(400).json({ error: 'CSV vazio ou sem linhas de dados.' })
    }

    // Detecta colunas automaticamente
    const cabecalhos = Object.keys(registros[0])
    const { emailCol, telefoneCol } = detectarColunas(cabecalhos)

    if (!emailCol) {
      return res.status(400).json({
        error: `Coluna de email não encontrada. Colunas detectadas: ${cabecalhos.join(', ')}`,
        dica: 'Use: email, e-mail, "E-mail do Comprador"',
      })
    }
    if (!telefoneCol) {
      return res.status(400).json({
        error: `Coluna de telefone não encontrada. Colunas detectadas: ${cabecalhos.join(', ')}`,
        dica: 'Use: telefone, phone, celular, "Telefone do Comprador"',
      })
    }

    const resultado = {
      atualizados:     0,
      nao_encontrados: [] as string[],
      erros:           [] as string[],
    }

    for (const linha of registros) {
      const email    = linha[emailCol]?.trim().toLowerCase()
      const telRaw   = linha[telefoneCol]?.trim()

      if (!email) continue

      if (!telRaw) {
        resultado.erros.push(`${email}: telefone vazio`)
        continue
      }

      try {
        // Verifica se cliente existe pelo email
        const cliente = await queryOne<{ id: string }>(
          'SELECT id FROM clientes WHERE LOWER(email) = $1',
          [email]
        )

        if (!cliente) {
          resultado.nao_encontrados.push(email)
          continue
        }

        const { formatado, valido } = formatarTelefone(telRaw)

        await pool.query(`
          UPDATE clientes SET
            telefone_raw       = $2,
            telefone_formatado = $3,
            telefone_valido    = $4,
            updated_at         = NOW()
          WHERE id = $1
        `, [cliente.id, telRaw, formatado, valido])

        resultado.atualizados++
      } catch (err) {
        resultado.erros.push(`${email}: ${String(err)}`)
      }
    }

    console.log(
      `[ImportarCSV] Processados: ${registros.length} linhas` +
      ` | atualizados: ${resultado.atualizados}` +
      ` | não encontrados: ${resultado.nao_encontrados.length}` +
      ` | erros: ${resultado.erros.length}`
    )

    res.json({
      success: true,
      total_linhas: registros.length,
      ...resultado,
    })
  } catch (err) {
    console.error('[ImportarCSV] Erro:', err)
    res.status(500).json({ error: String(err) })
  }
})

// ── POST /api/clientes/importar-csv/preview ───────────────────────────────
// Retorna as primeiras 5 linhas sem importar (para preview no frontend)
importarCsvRouter.post('/preview', upload.single('arquivo'), async (req: Request, res: Response) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Nenhum arquivo enviado.' })
  }

  try {
    const registros = await parsearCsv(req.file.buffer)
    const cabecalhos = Object.keys(registros[0] ?? {})
    const { emailCol, telefoneCol } = detectarColunas(cabecalhos)

    res.json({
      total_linhas: registros.length,
      colunas_detectadas: { email: emailCol, telefone: telefoneCol },
      preview: registros.slice(0, 5),
      cabecalhos,
    })
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})
