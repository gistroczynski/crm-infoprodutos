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
    .replace(/[̀-ͯ]/g, '')  // remove diacríticos
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

const MAPA_DDD = new Set([
  'ddd', 'codigo de area', 'cod area', 'area code',
])

const MAPA_NOME = new Set([
  'nome', 'nome do comprador', 'comprador', 'nome do cliente',
  'buyer name', 'buyer', 'name', 'client name', 'cliente',
  'nome completo', 'full name',
])

const MAPA_STATUS = new Set([
  'status', 'status da venda', 'status do pedido', 'transaction status',
])

const MAPA_PRODUTO_NOME = new Set([
  'nome do produto', 'produto', 'product name', 'product', 'nome produto',
  'item', 'descricao', 'description',
])

const MAPA_DATA_VENDA = new Set([
  'data de venda', 'data da venda', 'data compra', 'data da compra',
  'purchase date', 'sale date', 'data',
])

const MAPA_PRECO = new Set([
  'preco da oferta', 'preco', 'valor', 'price', 'offer price',
  'valor da venda', 'valor do produto', 'amount',
])

const MAPA_TRANSACTION_ID = new Set([
  'cod pedido', 'codigo do pedido', 'codigo pedido', 'transaction',
  'transaction id', 'transacao', 'cod transacao', 'codigo transacao',
  'numero do pedido', 'numero pedido', 'order id', 'id transacao',
  'id da transacao', 'pedido', 'ref pedido',
])

function detectarColunas(cabecalhos: string[]): {
  emailCol:          string | null
  telefoneCol:       string | null
  dddCol:            string | null
  nomeCol:           string | null
  statusCol:         string | null
  produtoNomeCol:    string | null
  dataVendaCol:      string | null
  precoCol:          string | null
  transactionIdCol:  string | null
} {
  let emailCol:         string | null = null
  let telefoneCol:      string | null = null
  let dddCol:           string | null = null
  let nomeCol:          string | null = null
  let statusCol:        string | null = null
  let produtoNomeCol:   string | null = null
  let dataVendaCol:     string | null = null
  let precoCol:         string | null = null
  let transactionIdCol: string | null = null

  for (const h of cabecalhos) {
    const n = normalizar(h)
    if (!emailCol         && MAPA_EMAIL.has(n))          emailCol         = h
    if (!telefoneCol      && MAPA_TELEFONE.has(n))       telefoneCol      = h
    if (!dddCol           && MAPA_DDD.has(n))            dddCol           = h
    if (!nomeCol          && MAPA_NOME.has(n))           nomeCol          = h
    if (!statusCol        && MAPA_STATUS.has(n))         statusCol        = h
    if (!produtoNomeCol   && MAPA_PRODUTO_NOME.has(n))   produtoNomeCol   = h
    if (!dataVendaCol     && MAPA_DATA_VENDA.has(n))     dataVendaCol     = h
    if (!precoCol         && MAPA_PRECO.has(n))          precoCol         = h
    if (!transactionIdCol && MAPA_TRANSACTION_ID.has(n)) transactionIdCol = h
  }

  return { emailCol, telefoneCol, dddCol, nomeCol, statusCol, produtoNomeCol, dataVendaCol, precoCol, transactionIdCol }
}

// ── Helpers para dados da Hotmart ──────────────────────────────────────────

const STATUS_VALIDOS = new Set([
  'complete', 'completo',
  'aprovado', 'approved',
  'pago', 'paid',
  'concluido', 'concluido',
])

function removerAcentos(str: string): string {
  return str.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

function isStatusAprovado(statusVal: string): boolean {
  const s = removerAcentos(statusVal.trim()).toLowerCase()
  return STATUS_VALIDOS.has(s)
}

function combinarDddTelefone(
  linha: Record<string, string>,
  dddCol: string | null,
  telefoneCol: string | null,
): string {
  const tel = telefoneCol ? (linha[telefoneCol]?.trim() || '') : ''
  if (!tel) return ''
  if (dddCol) {
    const ddd = linha[dddCol]?.trim() || ''
    return ddd + tel
  }
  return tel
}

function parsearPreco(precoStr: string): number | null {
  if (!precoStr) return null
  // Remove "R$", pontos de milhar, troca vírgula por ponto
  const limpo = precoStr
    .replace(/R\$\s*/g, '')
    .replace(/\./g, '')
    .replace(',', '.')
    .trim()
  const n = parseFloat(limpo)
  return isNaN(n) ? null : n
}

function parsearData(dataStr: string): Date | null {
  if (!dataStr) return null
  // dd/mm/yyyy ou dd/mm/yyyy HH:MM
  const brMatch = dataStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (brMatch) {
    const [, d, m, y] = brMatch
    const dt = new Date(`${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}T00:00:00Z`)
    return isNaN(dt.getTime()) ? null : dt
  }
  // ISO ou outros formatos que Date consegue parsear
  const dt = new Date(dataStr)
  return isNaN(dt.getTime()) ? null : dt
}

// ── Detecção de encoding ───────────────────────────────────────────────────

function decodificarBuffer(buf: Buffer): { texto: string; encoding: string } {
  // UTF-8 BOM (EF BB BF)
  if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
    return { texto: buf.toString('utf8').replace(/^﻿/, ''), encoding: 'UTF-8 BOM' }
  }

  // Tenta UTF-8: se não houver caractere de substituição, é UTF-8 válido
  const utf8 = buf.toString('utf8')
  if (!utf8.includes('�')) {
    return { texto: utf8.replace(/^﻿/, ''), encoding: 'UTF-8' }
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
  res.send('﻿' + csv)
})

// ── Contagem total de linhas sem parsear ────────────────────────────────────

function contarLinhasCsv(buffer: Buffer): number {
  const { texto } = decodificarBuffer(buffer)
  const linhas = texto.split(/\r?\n/).filter(l => l.trim().length > 0)
  return Math.max(0, linhas.length - 1) // subtrai cabeçalho
}

// ── POST /preview ──────────────────────────────────────────────────────────

importarCsvRouter.post('/preview', upload.single('arquivo'), async (req: Request, res: Response) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' })

  try {
    const totalLinhas = contarLinhasCsv(req.file.buffer)
    const { registros, encoding, separador } = await parsearCsv(req.file.buffer, 200)
    const cabecalhos = Object.keys(registros[0] ?? {})
    const cols = detectarColunas(cabecalhos)

    console.log(`[ImportarCSV/preview] encoding=${encoding} sep="${separador}" colunas=${JSON.stringify(cabecalhos)}`)
    console.log(`[ImportarCSV/preview] primeiras 3 linhas:`, JSON.stringify(registros.slice(0, 3), null, 2))

    res.json({
      total_linhas:        totalLinhas,
      encoding_detectado:  encoding,
      separador_detectado: separador,
      colunas_detectadas:  {
        email:          cols.emailCol,
        telefone:       cols.telefoneCol,
        ddd:            cols.dddCol,
        status:         cols.statusCol,
        produto_nome:   cols.produtoNomeCol,
        data_venda:     cols.dataVendaCol,
        transaction_id: cols.transactionIdCol,
      },
      preview:    registros.slice(0, 5),
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

// ── POST / (importar apenas telefones) ────────────────────────────────────
// Atualiza telefone dos clientes já existentes no banco.
// Aceita ?amostra=100 para processar somente as primeiras N linhas (teste).

importarCsvRouter.post('/', upload.single('arquivo'), async (req: Request, res: Response) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado. Use o campo "arquivo".' })

  const amostra = req.query.amostra ? Number(req.query.amostra) : undefined

  try {
    const { registros, encoding, separador } = await parsearCsv(req.file.buffer, amostra)

    if (registros.length === 0) {
      return res.status(400).json({ error: 'CSV vazio ou sem linhas de dados.' })
    }

    const cabecalhos = Object.keys(registros[0])
    const { emailCol, telefoneCol, dddCol, statusCol } = detectarColunas(cabecalhos)

    console.log(`[ImportarCSV] encoding=${encoding} sep="${separador}" colunas=${JSON.stringify(cabecalhos)}`)
    console.log(`[ImportarCSV] total de linhas: ${registros.length}${amostra ? ` (amostra: ${amostra})` : ''}`)

    if (!emailCol) {
      return res.status(400).json({
        error:               'Coluna de email não encontrada.',
        colunas_encontradas: cabecalhos,
        dica:                'Esperado: "Email", "E-mail do Comprador", "buyer_email"',
      })
    }
    if (!telefoneCol && !dddCol) {
      return res.status(400).json({
        error:               'Coluna de telefone não encontrada.',
        colunas_encontradas: cabecalhos,
        dica:                'Esperado: "Telefone", "DDD" + "Telefone", "phone", "whatsapp"',
      })
    }

    // Deduplicação: guarda o último telefone não-vazio por email
    // Filtra apenas linhas com Status aprovado (quando coluna Status existe)
    const emailParaTelefone = new Map<string, string>()
    let semEmailNaLinha    = 0
    let filtradosPorStatus = 0

    for (const linha of registros) {
      // Filtrar por status aprovado quando a coluna existir
      if (statusCol) {
        const statusVal = linha[statusCol]?.trim() || ''
        if (statusVal && !isStatusAprovado(statusVal)) {
          filtradosPorStatus++
          continue
        }
      }

      const email  = linha[emailCol]?.trim().toLowerCase()
      const telRaw = combinarDddTelefone(linha, dddCol, telefoneCol)
      if (!email) { semEmailNaLinha++; continue }
      if (telRaw) {
        emailParaTelefone.set(email, telRaw)
      } else if (!emailParaTelefone.has(email)) {
        emailParaTelefone.set(email, '')
      }
    }

    const emailsUnicos     = emailParaTelefone.size
    const comTelefone      = [...emailParaTelefone.values()].filter(t => t.length > 0).length
    const semTelefoneNoCsv = emailsUnicos - comTelefone

    console.log(
      `[ImportarCSV] ${registros.length} linhas → ` +
      `filtrados_status=${filtradosPorStatus} ` +
      `emails_unicos=${emailsUnicos} com_telefone=${comTelefone}`
    )

    const resultado = {
      total_linhas_csv:          registros.length,
      filtrados_por_status:      filtradosPorStatus,
      emails_unicos_encontrados: emailsUnicos,
      com_telefone:              comTelefone,
      sem_telefone_no_csv:       semTelefoneNoCsv,
      atualizados:               0,
      nao_encontrados:           0,
      erros:                     0,
    }

    const entradas = [...emailParaTelefone.entries()].filter(([, tel]) => tel.length > 0)
    const LOTE = 500

    for (let i = 0; i < entradas.length; i += LOTE) {
      const lote = entradas.slice(i, i + LOTE)

      await Promise.all(lote.map(async ([email, telRaw]) => {
        try {
          const cliente = await queryOne<{ id: string }>(
            'SELECT id FROM clientes WHERE LOWER(email) = $1', [email]
          )

          if (!cliente) { resultado.nao_encontrados++; return }

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
          console.error(`[ImportarCSV] Erro ao atualizar ${email}:`, err)
          resultado.erros++
        }
      }))

      console.log(`[ImportarCSV] Progresso: ${Math.min(i + LOTE, entradas.length)}/${entradas.length} emails processados`)
    }

    console.log(
      `[ImportarCSV] Concluído:` +
      ` atualizados=${resultado.atualizados}` +
      ` nao_encontrados=${resultado.nao_encontrados}` +
      ` erros=${resultado.erros}`
    )

    res.json({ success: true, ...resultado })
  } catch (err) {
    console.error('[ImportarCSV] Erro:', err)
    res.status(500).json({
      error: `Erro ao processar arquivo: ${String(err)}`,
      dica:  'Verifique se o arquivo é um CSV válido exportado da Hotmart.',
    })
  }
})

// ── POST /completo ─────────────────────────────────────────────────────────
// Upsert de clientes (cria novos + atualiza telefone) + salva compras.
// Filtra apenas linhas com Status = COMPLETE / Aprovado.
// Aceita ?amostra=100 para processar somente as primeiras N linhas (teste).

importarCsvRouter.post('/completo', upload.single('arquivo'), async (req: Request, res: Response) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado. Use o campo "arquivo".' })

  const amostra = req.query.amostra ? Number(req.query.amostra) : undefined

  try {
    const { registros, encoding, separador } = await parsearCsv(req.file.buffer, amostra)

    if (registros.length === 0) {
      return res.status(400).json({ error: 'CSV vazio ou sem linhas de dados.' })
    }

    const cabecalhos = Object.keys(registros[0])
    const {
      emailCol, telefoneCol, dddCol, nomeCol, statusCol,
      produtoNomeCol, dataVendaCol, precoCol, transactionIdCol,
    } = detectarColunas(cabecalhos)

    console.log(
      `[ImportarCSV/completo] encoding=${encoding} sep="${separador}" ` +
      `colunas=${JSON.stringify(cabecalhos)}` +
      `${amostra ? ` amostra=${amostra}` : ''}`
    )

    if (!emailCol) {
      return res.status(400).json({
        error: 'Coluna de email não encontrada.',
        colunas_encontradas: cabecalhos,
        dica: 'Esperado: "Email", "E-mail do Comprador", "buyer_email"',
      })
    }

    // ── Filtra linhas aprovadas e separa dados por email e por linha ──────────
    interface DadosCliente {
      nome:     string
      telefone: string
    }
    interface DadosCompra {
      email:         string
      produtoNome:   string
      dataVenda:     Date | null
      preco:         number | null
      transactionId: string | null
    }

    const porEmail    = new Map<string, DadosCliente>()
    const comprasLote: DadosCompra[] = []
    let filtradosPorStatus = 0

    for (const linha of registros) {
      // Filtrar por status aprovado quando a coluna existir
      if (statusCol) {
        const statusVal = linha[statusCol]?.trim() || ''
        if (statusVal && !isStatusAprovado(statusVal)) {
          filtradosPorStatus++
          continue
        }
      }

      const email = linha[emailCol]?.trim().toLowerCase()
      if (!email) continue

      const nome   = nomeCol ? (linha[nomeCol]?.trim() || '') : ''
      const telRaw = combinarDddTelefone(linha, dddCol, telefoneCol)

      if (!porEmail.has(email)) {
        porEmail.set(email, { nome, telefone: telRaw })
      } else {
        const atual = porEmail.get(email)!
        if (!atual.nome     && nome)   atual.nome     = nome
        if (!atual.telefone && telRaw) atual.telefone = telRaw
      }

      // Coleta dados da compra se tiver coluna de produto
      if (produtoNomeCol) {
        const produtoNome = linha[produtoNomeCol]?.trim()
        if (produtoNome) {
          const transactionId = transactionIdCol
            ? (linha[transactionIdCol]?.trim() || null)
            : null
          comprasLote.push({
            email,
            produtoNome,
            dataVenda:     dataVendaCol     ? parsearData(linha[dataVendaCol] ?? '')  : null,
            preco:         precoCol         ? parsearPreco(linha[precoCol] ?? '')     : null,
            transactionId,
          })
        }
      }
    }

    // Quando há coluna de transaction_id, deduplica: mantém apenas a linha de maior
    // valor por transação. Isso evita inserir múltiplos produtos do mesmo pedido como
    // compras separadas, já que o CSV da Hotmart gera uma linha por produto por pedido.
    let comprasParaInserir = comprasLote
    if (transactionIdCol) {
      const byTransaction = new Map<string, DadosCompra>()
      const semTransaction: DadosCompra[] = []

      for (const c of comprasLote) {
        if (c.transactionId) {
          const existing = byTransaction.get(c.transactionId)
          if (!existing || (c.preco ?? 0) > (existing.preco ?? 0)) {
            byTransaction.set(c.transactionId, c)
          }
        } else {
          semTransaction.push(c)
        }
      }
      comprasParaInserir = [...byTransaction.values(), ...semTransaction]

      console.log(
        `[ImportarCSV/completo] Dedup por transaction_id: ` +
        `${comprasLote.length} → ${comprasParaInserir.length} compras`
      )
    }

    const emailsUnicos = porEmail.size
    console.log(
      `[ImportarCSV/completo] ${registros.length} linhas → ` +
      `filtrados_status=${filtradosPorStatus} ` +
      `emails_unicos=${emailsUnicos} ` +
      `compras_coletadas=${comprasLote.length} ` +
      `compras_apos_dedup=${comprasParaInserir.length}`
    )

    // ── Upsert de clientes ─────────────────────────────────────────────────
    const resultado = {
      total_linhas_csv:     registros.length,
      filtrados_por_status: filtradosPorStatus,
      emails_unicos:        emailsUnicos,
      criados:              0,
      atualizados:          0,
      sem_telefone:         0,
      compras_inseridas:    0,
      compras_duplicadas:   0,
      erros:                0,
    }

    // Mapa email → cliente_id para uso na etapa de compras
    const emailParaClienteId = new Map<string, string>()
    const entradas  = [...porEmail.entries()]
    const LOTE = 200

    for (let i = 0; i < entradas.length; i += LOTE) {
      const lote = entradas.slice(i, i + LOTE)

      await Promise.all(lote.map(async ([email, { nome, telefone: telRaw }]) => {
        try {
          const nomeUsado = nome || email.split('@')[0]

          let telefoneFormatado: string | null = null
          let telefoneValido    = false

          if (telRaw) {
            const fmt = formatarTelefone(telRaw)
            telefoneFormatado = fmt.formatado
            telefoneValido    = fmt.valido
          } else {
            resultado.sem_telefone++
          }

          const r = await pool.query<{ id: string; xmax: string }>(`
            INSERT INTO clientes (nome, email, telefone_raw, telefone_formatado, telefone_valido)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (email) DO UPDATE SET
              nome               = CASE WHEN LENGTH(COALESCE(clientes.nome, '')) < 2
                                        THEN EXCLUDED.nome ELSE clientes.nome END,
              telefone_raw       = CASE WHEN EXCLUDED.telefone_raw IS NOT NULL AND EXCLUDED.telefone_raw != ''
                                        THEN EXCLUDED.telefone_raw ELSE clientes.telefone_raw END,
              telefone_formatado = CASE WHEN EXCLUDED.telefone_formatado IS NOT NULL
                                        THEN EXCLUDED.telefone_formatado ELSE clientes.telefone_formatado END,
              telefone_valido    = CASE WHEN EXCLUDED.telefone_formatado IS NOT NULL
                                        THEN EXCLUDED.telefone_valido ELSE clientes.telefone_valido END,
              updated_at         = NOW()
            RETURNING id, xmax::text
          `, [nomeUsado, email, telRaw || null, telefoneFormatado, telefoneValido])

          const row = r.rows[0]
          emailParaClienteId.set(email, row.id)
          if (row.xmax === '0') resultado.criados++
          else                  resultado.atualizados++
        } catch (err) {
          console.error(`[ImportarCSV/completo] Erro ao processar cliente ${email}:`, err)
          resultado.erros++
        }
      }))

      if ((i / LOTE) % 5 === 0) {
        console.log(`[ImportarCSV/completo] Clientes: ${Math.min(i + LOTE, entradas.length)}/${entradas.length}`)
      }
    }

    // ── Upsert de produtos e inserção de compras ───────────────────────────
    if (comprasParaInserir.length > 0) {
      // Coleta nomes únicos de produtos e faz upsert
      const nomesUnicos = [...new Set(comprasParaInserir.map(c => c.produtoNome))]
      const produtoIdPorNome = new Map<string, string>()

      for (const nome of nomesUnicos) {
        try {
          // Tenta encontrar o produto existente primeiro
          const existente = await queryOne<{ id: string }>(
            'SELECT id FROM produtos WHERE nome = $1', [nome]
          )
          if (existente) {
            produtoIdPorNome.set(nome, existente.id)
          } else {
            // Cria produto novo sem tipo (pode ser classificado depois pelo admin)
            const novo = await pool.query<{ id: string }>(
              'INSERT INTO produtos (nome) VALUES ($1) RETURNING id', [nome]
            )
            if (novo.rows[0]) produtoIdPorNome.set(nome, novo.rows[0].id)
          }
        } catch (err) {
          console.error(`[ImportarCSV/completo] Erro ao upsert produto "${nome}":`, err)
        }
      }

      // Insere compras evitando duplicatas em reimportações
      const LOTE_COMPRAS = 200
      for (let i = 0; i < comprasParaInserir.length; i += LOTE_COMPRAS) {
        const lote = comprasParaInserir.slice(i, i + LOTE_COMPRAS)

        await Promise.all(lote.map(async ({ email, produtoNome, dataVenda, preco, transactionId }) => {
          const clienteId = emailParaClienteId.get(email)
          const produtoId = produtoIdPorNome.get(produtoNome)
          if (!clienteId || !produtoId) return

          try {
            // Deduplicação: se temos transaction_id, ele é a chave primária da compra.
            // Sem transaction_id, cai no fallback de cliente + produto + data.
            let existente: { id: string } | null = null
            if (transactionId) {
              existente = await queryOne<{ id: string }>(
                'SELECT id FROM compras WHERE hotmart_transaction_id = $1 LIMIT 1',
                [transactionId]
              )
            } else {
              existente = await queryOne<{ id: string }>(`
                SELECT id FROM compras
                WHERE cliente_id = $1
                  AND produto_id = $2
                  AND ($3::date IS NULL OR data_compra::date = $3::date)
                LIMIT 1
              `, [clienteId, produtoId, dataVenda ? dataVenda.toISOString() : null])
            }

            if (existente) {
              resultado.compras_duplicadas++
              return
            }

            await pool.query(`
              INSERT INTO compras
                (cliente_id, produto_id, valor, status, data_compra, hotmart_transaction_id)
              VALUES ($1, $2, $3, $4, $5, $6)
            `, [
              clienteId,
              produtoId,
              preco,
              'COMPLETE',
              dataVenda ? dataVenda.toISOString() : null,
              transactionId ?? null,
            ])

            resultado.compras_inseridas++
          } catch (err) {
            console.error(`[ImportarCSV/completo] Erro ao inserir compra para ${email}:`, err)
            resultado.erros++
          }
        }))
      }
    }

    console.log(
      `[ImportarCSV/completo] Concluído:` +
      ` criados=${resultado.criados}` +
      ` atualizados=${resultado.atualizados}` +
      ` sem_telefone=${resultado.sem_telefone}` +
      ` compras_inseridas=${resultado.compras_inseridas}` +
      ` compras_duplicadas=${resultado.compras_duplicadas}` +
      ` erros=${resultado.erros}`
    )

    res.json({ success: true, ...resultado })
  } catch (err) {
    console.error('[ImportarCSV/completo] Erro:', err)
    res.status(500).json({ error: `Erro ao processar arquivo: ${String(err)}` })
  }
})

// ── POST /debug-colunas ────────────────────────────────────────────────────
// Diagnostica o CSV sem importar — útil para identificar problemas de encoding/separador

importarCsvRouter.post('/debug-colunas', upload.single('arquivo'), async (req: Request, res: Response) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' })

  try {
    const { registros, encoding, separador } = await parsearCsv(req.file.buffer, 10)
    const cabecalhos = Object.keys(registros[0] ?? {})
    const cols = detectarColunas(cabecalhos)

    res.json({
      encoding_detectado:  encoding,
      separador_detectado: separador,
      colunas_encontradas: cabecalhos,
      primeiras_3_linhas:  registros.slice(0, 3),
      colunas_mapeadas: {
        email:          cols.emailCol,
        telefone:       cols.telefoneCol,
        ddd:            cols.dddCol,
        nome:           cols.nomeCol,
        status:         cols.statusCol,
        produto_nome:   cols.produtoNomeCol,
        data_venda:     cols.dataVendaCol,
        preco:          cols.precoCol,
        transaction_id: cols.transactionIdCol,
      },
    })
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})
