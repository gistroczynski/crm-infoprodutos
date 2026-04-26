import { query, queryOne, pool } from '../db'

// ── Tipos ──────────────────────────────────────────────────────────────────

export interface RegraDB {
  id: string
  nome: string
  condicao_tipo: string
  condicao_valor: Record<string, number | string>
  pontos: number
  ordem: number
}

export interface DadosClienteParaScore {
  id: string
  nome: string
  email: string
  telefone_formatado: string | null
  dias_desde_ultima_compra: number | null  // null = nunca comprou
  total_compras: number
  tipos_comprados: string[]               // ex: ['entrada', 'principal']
  ultima_compra: Date | null
}

export interface ScoreResult {
  cliente_id: string
  score: number
  prioridade: 'alta' | 'media' | 'baixa'
  status: 'novo' | 'nutricao' | 'pronto' | 'inativo'
  motivos: string[]
}

// ── Configurações ──────────────────────────────────────────────────────────

async function buscarConfigs(): Promise<Record<string, string>> {
  const rows = await query<{ chave: string; valor: string }>(
    'SELECT chave, valor FROM configuracoes'
  )
  return Object.fromEntries(rows.map(r => [r.chave, r.valor ?? '']))
}

// ── Candidatos ─────────────────────────────────────────────────────────────

export async function buscarCandidatos(
  produtoPrincipalId: string
): Promise<DadosClienteParaScore[]> {

  // Se há produto principal configurado, exclui quem já comprou
  const filtroExcluirPrincipal = produtoPrincipalId
    ? `AND NOT EXISTS (
        SELECT 1 FROM compras co2
        WHERE co2.cliente_id = c.id
          AND co2.produto_id = $1::uuid
          AND co2.status IN ('COMPLETE', 'APPROVED')
       )`
    : ''

  const params = produtoPrincipalId ? [produtoPrincipalId] : []

  const rows = await query<{
    id: string
    nome: string
    email: string
    telefone_formatado: string | null
    ultima_compra: Date | null
    total_compras: number
    tipos_comprados: string | null  // JSON array como string
  }>(`
    SELECT
      c.id,
      c.nome,
      c.email,
      c.telefone_formatado,
      MAX(co.data_compra)                          AS ultima_compra,
      COUNT(co.id)::int                            AS total_compras,
      COALESCE(
        json_agg(DISTINCT p.tipo) FILTER (WHERE p.tipo IS NOT NULL),
        '[]'
      )::text                                      AS tipos_comprados
    FROM clientes c
    LEFT JOIN compras co ON co.cliente_id = c.id AND co.status IN ('COMPLETE', 'APPROVED')
    LEFT JOIN produtos p ON p.id = co.produto_id
    WHERE c.email IS NOT NULL
    ${filtroExcluirPrincipal}
    GROUP BY c.id
    HAVING COUNT(co.id) > 0
  `, params)

  const agora = Date.now()

  return rows.map(r => {
    const ultimaCompra = r.ultima_compra ? new Date(r.ultima_compra) : null
    const diasDesdeUltimaCompra = ultimaCompra
      ? Math.floor((agora - ultimaCompra.getTime()) / (1000 * 60 * 60 * 24))
      : null

    let tipos: string[] = []
    try { tipos = JSON.parse(r.tipos_comprados ?? '[]') } catch {}

    return {
      id: r.id,
      nome: r.nome,
      email: r.email,
      telefone_formatado: r.telefone_formatado,
      dias_desde_ultima_compra: diasDesdeUltimaCompra,
      total_compras: r.total_compras,
      tipos_comprados: tipos,
      ultima_compra: ultimaCompra,
    }
  })
}

// ── Avaliação de regras ────────────────────────────────────────────────────

function avaliarRegra(
  regra: RegraDB,
  cliente: DadosClienteParaScore
): { aplica: boolean; motivo: string } {
  const dias = cliente.dias_desde_ultima_compra
  const v    = regra.condicao_valor

  switch (regra.condicao_tipo) {
    case 'dias_desde_compra_max':
      if (dias !== null && dias <= Number(v.dias)) {
        return { aplica: true, motivo: regra.nome }
      }
      break

    case 'dias_desde_compra_entre':
      if (dias !== null && dias >= Number(v.min) && dias <= Number(v.max)) {
        return { aplica: true, motivo: regra.nome }
      }
      break

    case 'dias_desde_compra_min':
      if (dias !== null && dias >= Number(v.dias)) {
        return { aplica: true, motivo: regra.nome }
      }
      break

    case 'quantidade_compras_min':
      if (cliente.total_compras >= Number(v.quantidade)) {
        return { aplica: true, motivo: regra.nome }
      }
      break

    case 'sem_produto_tipo': {
      const tipo = String(v.tipo)
      if (!cliente.tipos_comprados.includes(tipo)) {
        return { aplica: true, motivo: regra.nome }
      }
      break
    }
  }

  return { aplica: false, motivo: '' }
}

// ── Status do cliente ──────────────────────────────────────────────────────

function calcularStatus(
  cliente: DadosClienteParaScore,
  temPrincipal: boolean
): 'novo' | 'nutricao' | 'pronto' | 'inativo' {
  const dias = cliente.dias_desde_ultima_compra

  if (dias === null || dias > 90) return 'inativo'
  if (dias <= 7)                   return 'novo'
  if (cliente.total_compras >= 2 && !temPrincipal) return 'pronto'
  if (dias > 30)                   return 'nutricao'
  return 'novo'
}

// ── Motor principal ────────────────────────────────────────────────────────

export async function calcularScores(): Promise<ScoreResult[]> {
  const [configs, regras] = await Promise.all([
    buscarConfigs(),
    query<RegraDB>(`
      SELECT id, nome, condicao_tipo, condicao_valor, pontos, ordem
      FROM regras_priorizacao
      WHERE ativa = true
      ORDER BY ordem ASC
    `),
  ])

  const produtoPrincipalId = configs['produto_principal_id'] ?? ''
  const limiarAlta  = Number(configs['score_alta_prioridade']  ?? 70)
  const limiarMedia = Number(configs['score_media_prioridade'] ?? 40)

  const candidatos = await buscarCandidatos(produtoPrincipalId)

  console.log(`[Scoring] ${candidatos.length} candidatos | ${regras.length} regras ativas`)

  return candidatos.map(cliente => {
    let pontos = 0
    const motivos: string[] = []

    for (const regra of regras) {
      const { aplica, motivo } = avaliarRegra(regra, cliente)
      if (aplica) {
        pontos += regra.pontos
        if (regra.pontos > 0) motivos.push(motivo)
      }
    }

    // Clamp entre 0 e 100
    const score = Math.max(0, Math.min(100, pontos))

    // Deduplica motivos (proteção contra regras duplicadas no banco)
    const motivosUnicos = [...new Set(motivos)]

    const prioridade: ScoreResult['prioridade'] =
      score >= limiarAlta  ? 'alta'  :
      score >= limiarMedia ? 'media' : 'baixa'

    // Para status: verificar se já tem produto principal
    const temPrincipal = produtoPrincipalId
      ? false  // candidatos já foram filtrados (quem tem principal foi excluído)
      : cliente.tipos_comprados.includes('principal')

    const status = calcularStatus(cliente, temPrincipal)

    return { cliente_id: cliente.id, score, prioridade, status, motivos: motivosUnicos }
  })
}

// ── Persistência dos scores ────────────────────────────────────────────────

export async function salvarScores(scores: ScoreResult[]): Promise<void> {
  if (scores.length === 0) return

  // Upsert em lotes de 100
  const LOTE = 100
  for (let i = 0; i < scores.length; i += LOTE) {
    const lote = scores.slice(i, i + LOTE)

    // lead_scores
    const scorePlaceholders = lote.map((_, j) => {
      const base = j * 4
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}::jsonb, NOW())`
    }).join(', ')

    const scoreParams = lote.flatMap(s => [
      s.cliente_id,
      s.score,
      s.prioridade,
      JSON.stringify(s.motivos),
    ])

    await query(`
      INSERT INTO lead_scores (cliente_id, score, prioridade, motivos, updated_at)
      VALUES ${scorePlaceholders}
      ON CONFLICT (cliente_id) DO UPDATE SET
        score      = EXCLUDED.score,
        prioridade = EXCLUDED.prioridade,
        motivos    = EXCLUDED.motivos,
        updated_at = NOW()
    `, scoreParams)

    // status_clientes
    const statusPlaceholders = lote.map((_, j) => {
      const base = j * 2
      return `($${base + 1}, $${base + 2}, NOW())`
    }).join(', ')

    const statusParams = lote.flatMap(s => [s.cliente_id, s.status])

    await query(`
      INSERT INTO status_clientes (cliente_id, status, updated_at)
      VALUES ${statusPlaceholders}
      ON CONFLICT (cliente_id) DO UPDATE SET
        status     = EXCLUDED.status,
        updated_at = NOW()
    `, statusParams)
  }

  console.log(`[Scoring] ${scores.length} scores salvos`)
}

// ── Zera scores de clientes sem compras ────────────────────────────────────

export async function zerarScoresClientesSemCompras(): Promise<void> {
  const res = await pool.query(`
    UPDATE lead_scores
    SET score = 0, prioridade = 'baixa', updated_at = NOW()
    WHERE cliente_id NOT IN (
      SELECT DISTINCT cliente_id FROM compras
      WHERE status IN ('COMPLETE', 'APPROVED')
    )
    AND score > 0
  `)

  await pool.query(`
    INSERT INTO status_clientes (cliente_id, status, updated_at)
    SELECT c.id, 'sem_compras', NOW()
    FROM clientes c
    WHERE NOT EXISTS (
      SELECT 1 FROM compras
      WHERE cliente_id = c.id AND status IN ('COMPLETE', 'APPROVED')
    )
    ON CONFLICT (cliente_id) DO UPDATE SET
      status     = 'sem_compras',
      updated_at = NOW()
  `)

  if ((res.rowCount ?? 0) > 0) {
    console.log(`[Scoring] ${res.rowCount} clientes sem compras tiveram score zerado`)
  }
}
