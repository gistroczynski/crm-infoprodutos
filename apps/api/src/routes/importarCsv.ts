import { Router, Request, Response } from 'express'
import multer from 'multer'
import { parse } from 'csv-parse'
import { Readable } from 'stream'
import { pool, queryOne } from '../db'
import { formatarTelefone } from '../services/hotmart'

export const importarCsvRouter = Router()

// ── Multer: memória ────────────────────────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
  fileFilter: (_req, file, cb) => {
    const ok = file.mimetype === 'text/csv'
      || file.originalname.endsWith('.csv')
      || file.originalname.endsWith('.xlsx')
    ok ? cb(null, true) : cb(new Error('Apenas arquivos .csv ou .xlsx são aceitos'))
  },
})

// ── Normalização de cabeçalhos ─────────────────────────────────────────────

function normalizar(str: string): string {
  return str
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')  // remove diacríticos
    .replace(/[^a-z0-9 ]/g, ' ')     // substitui especiais (-, _, etc.) por espaço
    .replace(/\s+/g, ' ')
    .trim()
}

const MAPA_EMAIL = new Set([
  'email', 'e mail', 'e mail do comprador', 'email do comprador',
  'buyer email', 'comprador email',
])

const MAPA_TELEFONE = new Set([
  'telefone', 'phone', 'celular',
  'telefone do comprador', 'telefone do cliente',
  'buyer phone', 'comprador telefone',
  'whatsapp', 'numero', 'numero de telefone',
  'tel', 'fone',
])

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

// ── Detecção de encoding ───────────────────────────────────────────────────

function decodificarBuffer(buf: Buffer): { texto: string; encoding: string } {
  // UTF-8 BOM (EF BB BF)
  if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
    return { texto: buf.toString('utf8').replace(/^\uFEFF/, ''), encoding: 'UTF-8 BOM' }
  }

  // Tenta UTF-8: se não houver caractere de substituição, é UTF-8 válido
  const utf8 = buf.toString('utf8')
  if (!utf8.includes('\uFFFD')) {
    return { texto: utf8.replace(/^\uFEFF/, ''), encoding: 'UTF-8' }
  }

  // Fallback: Latin-1 / ISO-8859-1 (Node.js suporta nativamente via 'latin1')
  return { texto: buf.toString('latin1'), encoding: 'Latin-1' }
}

// ── Detecção de separador ──────────────────────────────────────────────────

function detectarSeparador(primeiraLinha: string): ',' | ';' {
  const nPontoVirgula = (primeiraLinha.match(/;/g) ?? []).length
  const nVirgula      = (primeiraLinha.match(/,/g) ?? []).length
  return nPontoVirgula >= nVirgula ? ';' : ','
}

// ── Parse principal ────────────────────────────────────────────────────────

interface CsvParseResult {
  registros:  Record<string, string>[]
  encoding:   string
  separador:  ',' | ';'
}

async function parsearCsv(buffer: Buffer, maxLinhas?: number): Promise<CsvParseResult> {
  const { texto, encoding } = decodificarBuffer(buffer)
  const primeiraLinha = texto.split(/\r?\n/)[0] ?? ''
  const separador     = detectarSeparador(primeiraLinha)

  return new Promise((resolve, reject) => {
    const registros: Record<string, string>[] = []
    const stream = Readable.from([Buffer.from(texto, 'utf8')])

    const parser = parse({
      columns:            true,
      skip_empty_lines:   true,
      trim:               true,
      delimiter:          separador,
      relax_column_count: true,
      ...(maxLinhas ? { to: maxLinhas } : {}),
    })

    stream
      .pipe(parser)
      .on('data',  row => registros.push(row as Record<string, string>))
      .on('end',   ()  => resolve({ registros, encoding, separador }))
      .on('error', err => reject(err))
  })
}

// ── GET /template ──────────────────────────────────────────────────────────

importarCsvRouter.get('/template', (_req: Request, res: Response) => {
  const csv = [
    'email,telefone',
    'joao@exemplo.com,11999999999',
    'maria@exemplo.com,21988887777',
  ].join('\r\n')

  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', 'attachment; filename="modelo-telefones.csv"')
  res.send('\uFEFF' + csv)
})

// ── POST /preview ──────────────────────────────────────────────────────────

importarCsvRouter.post('/preview', upload.single('arquivo'), async (req: Request, res: Response) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' })

  try {
    // Limita a 200 linhas no preview — suficiente para detectar colunas, muito mais rápido em arquivos grandes
    const { registros, encoding, separador } = await parsearCsv(req.file.buffer, 200)
    const cabecalhos = Object.keys(registros[0] ?? {})
    const { emailCol, telefoneCol } = detectarColunas(cabecalhos)

    console.log(`[ImportarCSV/preview] encoding=${encoding} sep="${separador}" colunas=${JSON.stringify(cabecalhos)}`)
    console.log(`[ImportarCSV/preview] primeiras 3 linhas:`, JSON.stringify(registros.slice(0, 3), null, 2))

    res.json({
      total_linhas:       registros.length,
      encoding_detectado: encoding,
      separador_detectado: separador,
      colunas_detectadas: { email: emailCol, telefone: telefoneCol },
      preview:            registros.slice(0, 5),
      cabecalhos,
    })
  } catch (err) {
    console.error('[ImportarCSV/preview] Erro ao parsear:', err)
    res.status(500).json({
      error: `Erro ao parsear o arquivo: ${String(err)}`,
      dica:  'Verifique se o arquivo é um CSV válido exportado da Hotmart.',
    })
  }
})

// ── POST / (importar) ──────────────────────────────────────────────────────

importarCsvRouter.post('/', upload.single('arquivo'), async (req: Request, res: Response) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado. Use o campo "arquivo".' })

  try {
    const { registros, encoding, separador } = await parsearCsv(req.file.buffer)

    if (registros.length === 0) {
      return res.status(400).json({ error: 'CSV vazio ou sem linhas de dados.' })
    }

    const cabecalhos = Object.keys(registros[0])
    const { emailCol, telefoneCol } = detectarColunas(cabecalhos)

    console.log(`[ImportarCSV] encoding=${encoding} sep="${separador}" colunas=${JSON.stringify(cabecalhos)}`)
    console.log(`[ImportarCSV] primeiras 3 linhas:`, JSON.stringify(registros.slice(0, 3), null, 2))

    if (!emailCol) {
      return res.status(400).json({
        error:              `Coluna de email não encontrada.`,
        colunas_encontradas: cabecalhos,
        dica:               'Esperado: "email", "E-mail do Comprador", "buyer_email"',
      })
    }
    if (!telefoneCol) {
      return res.status(400).json({
        error:              `Coluna de telefone não encontrada.`,
        colunas_encontradas: cabecalhos,
        dica:               'Esperado: "telefone", "Telefone do Comprador", "phone", "whatsapp"',
      })
    }

    const resultado = {
      atualizados:      0,
      nao_encontrados:  [] as string[],
      erros:            [] as string[],
    }

    // Processa em lotes de 100 para eficiência sem sobrecarregar o pool de conexões
    const LOTE = 100
    for (let i = 0; i < registros.length; i += LOTE) {
      const lote = registros.slice(i, i + LOTE)

      await Promise.all(lote.map(async linha => {
        const email  = linha[emailCol!]?.trim().toLowerCase()
        const telRaw = linha[telefoneCol!]?.trim()

        if (!email) return
        if (!telRaw) { resultado.erros.push(`${email}: telefone vazio`); return }

        try {
          const cliente = await queryOne<{ id: string }>(
            'SELECT id FROM clientes WHERE LOWER(email) = $1', [email]
          )

          if (!cliente) { resultado.nao_encontrados.push(email); return }

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
      }))

      if ((i + LOTE) % 1000 === 0) {
        console.log(`[ImportarCSV] Progresso: ${i + LOTE}/${registros.length} linhas`)
      }
    }

    console.log(
      `[ImportarCSV] Concluído: ${registros.length} linhas` +
      ` | atualizados: ${resultado.atualizados}` +
      ` | não encontrados: ${resultado.nao_encontrados.length}` +
      ` | erros: ${resultado.erros.length}`
    )

    res.json({ success: true, total_linhas: registros.length, ...resultado })
  } catch (err) {
    console.error('[ImportarCSV] Erro:', err)
    res.status(500).json({
      error: `Erro ao processar arquivo: ${String(err)}`,
      dica:  'Verifique se o arquivo é um CSV válido exportado da Hotmart.',
    })
  }
})

// ── POST /debug-colunas ────────────────────────────────────────────────────
// Diagnostica o CSV sem importar — útil para identificar problemas de encoding/separador

importarCsvRouter.post('/debug-colunas', upload.single('arquivo'), async (req: Request, res: Response) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' })

  try {
    const { registros, encoding, separador } = await parsearCsv(req.file.buffer)
    const cabecalhos = Object.keys(registros[0] ?? {})
    const { emailCol, telefoneCol } = detectarColunas(cabecalhos)

    res.json({
      encoding_detectado:   encoding,
      separador_detectado:  separador,
      colunas_encontradas:  cabecalhos,
      primeiras_3_linhas:   registros.slice(0, 3),
      email_coluna:         emailCol,
      telefone_coluna:      telefoneCol,
    })
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})
