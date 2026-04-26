import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import dotenv from 'dotenv'
import cron from 'node-cron'

import { pool } from './db'
import { clientesRouter } from './routes/clientes'
import { listaDiariaRouter } from './routes/listaDiaria'
import { produtosRouter } from './routes/produtos'
import { dashboardRouter } from './routes/dashboard'
import { configuracoesRouter } from './routes/configuracoes'
import { syncRouter } from './routes/sync'
import { listaRouter } from './routes/lista'
import { webhookRouter } from './routes/webhook'
import { importarCsvRouter } from './routes/importarCsv'
import { debugRouter } from './routes/debug'
import { relatoriosRouter } from './routes/relatorios'
import { vendasRouter } from './routes/vendas'
import { cadenciasRouter } from './routes/cadencias'
import { reativacaoRouter } from './routes/reativacao'
import { manutencaoRouter } from './routes/manutencao'
import { errorHandler } from './middleware/errorHandler'
import { authMiddleware } from './middleware/auth'
import { apenasAdmin } from './middleware/perfil'
import { authRouter } from './routes/auth'
import { executarSync } from './jobs/sync'
import { executarGeracaoLista } from './jobs/lista'
import { executarListaReativacao, executarPopularFilaReativacao, executarAtualizarPrioridades } from './jobs/cadencia'

process.env.TZ = 'America/Sao_Paulo'

dotenv.config()

// ── Validação de variáveis de ambiente obrigatórias ────────────────────────

const ENV_REQUIRED = ['DATABASE_URL'] as const

function validarEnv() {
  const faltando = ENV_REQUIRED.filter(k => !process.env[k])
  if (faltando.length > 0) {
    console.error(`[ENV] Variáveis obrigatórias ausentes: ${faltando.join(', ')}`)
    console.error('[ENV] Configure o arquivo .env antes de iniciar.')
    process.exit(1)
  }
  console.log('[ENV] Todas as variáveis de ambiente validadas.')
}

validarEnv()

// ── App ────────────────────────────────────────────────────────────────────

const app  = express()
const PORT = Number(process.env.PORT ?? 3001)

// ── Segurança ──────────────────────────────────────────────────────────────

// Helmet: headers de segurança (desabilita contentSecurityPolicy para evitar
// quebrar a API — o front-end tem seu próprio CSP via Vite)
app.use(helmet({ contentSecurityPolicy: false }))

// Rate limiting: 100 requisições por minuto por IP (exceto webhook)
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas requisições. Tente novamente em um minuto.' },
  skip: req => req.path.startsWith('/api/webhook'),
})
app.use(limiter)

// ── CORS ───────────────────────────────────────────────────────────────────

app.use(cors({
  origin: function(origin, callback) {
    const allowedOrigins = [
      'http://localhost:5173',
      'https://crm-infoprodutos-web.vercel.app',
      process.env.FRONTEND_URL,
    ].filter(Boolean)

    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true)
    } else {
      callback(new Error('Not allowed by CORS'))
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}))

// ── Middlewares ────────────────────────────────────────────────────────────
app.use(express.json({ limit: '50mb' }))
app.use(express.urlencoded({ limit: '50mb', extended: true }))

// ── Health check ────────────────────────────────────────────────────────────

app.get('/health', async (_req, res) => {
  let dbOk = false
  let dbLatencyMs: number | null = null
  try {
    const t0 = Date.now()
    await pool.query('SELECT 1')
    dbLatencyMs = Date.now() - t0
    dbOk = true
  } catch {}

  const status = dbOk ? 'ok' : 'degraded'
  res.status(dbOk ? 200 : 503).json({
    status,
    ts: new Date().toISOString(),
    db: dbOk ? `ok (${dbLatencyMs}ms)` : 'error',
    uptime_s: Math.floor(process.uptime()),
    version: process.env.npm_package_version ?? '1.0.0',
  })
})

// ── Auth (público — antes do middleware JWT) ────────────────────────────────
app.use('/api/auth', authRouter)

// ── JWT em todas as rotas protegidas ───────────────────────────────────────
app.use(authMiddleware)

// ── Routes ─────────────────────────────────────────────────────────────────
app.use('/api/clientes', clientesRouter)
app.use('/api/lista-diaria', listaDiariaRouter)
app.use('/api/produtos', produtosRouter)
app.use('/api/dashboard', dashboardRouter)
app.use('/api/configuracoes', configuracoesRouter)
app.use('/api/sync', syncRouter)
app.use('/api/lista', listaRouter)
app.use('/api/webhook', webhookRouter)
app.use('/api/clientes/importar-csv', importarCsvRouter)
app.use('/api/debug', debugRouter)
app.use('/api/relatorios', apenasAdmin, relatoriosRouter)
app.use('/api/vendas', vendasRouter)
app.use('/api/cadencias', cadenciasRouter)
app.use('/api/reativacao', reativacaoRouter)
app.use('/api/manutencao', manutencaoRouter)

// ── Error handler ──────────────────────────────────────────────────────────
app.use(errorHandler)

// ── Cron: sincronização Hotmart a cada 2 horas ────────────────────────────
cron.schedule('0 */2 * * *', async () => {
  console.log('[Cron] Iniciando sync automático com Hotmart...')
  try {
    await executarSync()
  } catch (err) {
    console.error('[Cron] Erro no sync automático:', err)
  }
})

// ── Cron: gera lista diária todo dia às 06:00 ─────────────────────────────
cron.schedule('0 6 * * *', executarGeracaoLista)

// ── Cron: pré-aquece lista de reativação às 06:05 (após geração da lista) ──
cron.schedule('5 6 * * *', async () => {
  try { await executarListaReativacao() } catch {}
})

// ── Cron: popula fila de reativação e atualiza prioridades todo domingo às 23:00 ──
cron.schedule('0 23 * * 0', async () => {
  try { await executarPopularFilaReativacao() } catch {}
  try { await executarAtualizarPrioridades() } catch {}
})

// ── Start ──────────────────────────────────────────────────────────────────
async function start() {
  try {
    await pool.query('SELECT 1')
    console.log('[DB] Conexão com PostgreSQL estabelecida')
  } catch (err) {
    console.error('[DB] Falha na conexão — verifique DATABASE_URL:', err)
    process.exit(1)
  }

  app.listen(PORT, () => {
    console.log(`[API] Rodando em http://localhost:${PORT}`)
  })
}

start()
