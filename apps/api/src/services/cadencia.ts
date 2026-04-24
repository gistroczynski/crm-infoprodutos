import { pool, query, queryOne } from '../db'

// ── Tipos ──────────────────────────────────────────────────────────────────

export interface ItemListaDia {
  id: string
  cliente_id: string
  cliente_nome: string
  cliente_email: string
  cliente_telefone: string | null
  trilha_id: string
  trilha_nome: string
  trilha_cor: string
  produto_entrada: string
  etapa_atual: number
  total_etapas: number
  etapa_id: string
  nome_etapa: string
  dias_na_trilha: number
  mensagem_do_dia: string
  link_whatsapp: string | null
  status: string
}

// ── Inscrição automática ───────────────────────────────────────────────────

// Remove prefixos comuns de produtos da Hotmart para comparação por nome.
// Ex: "CD - A fraqueza masculina..." → "a fraqueza masculina..."
function normalizarNomeProduto(nome: string): string {
  return nome
    .replace(/^(cd|e-?book|ebook|gravação do workshop|gravacao do workshop|workshop|masterclass|desafio|programa|combo)[\s:–\-]*/gi, '')
    .trim()
    .toLowerCase()
    .substring(0, 30)
}

/**
 * Inscreve o cliente na trilha correspondente ao produto comprado, se existir.
 * Idempotente: ignora se o cliente já está inscrito nessa trilha.
 *
 * Estratégia em 2 passos:
 * 1. Busca direta pelo produto_entrada_id (match exato por UUID)
 * 2. Fallback por nome normalizado — cobre casos onde o mesmo produto tem
 *    múltiplos hotmart_ids (variantes de SKU) e a trilha está vinculada a
 *    um UUID diferente do que chegou no webhook.
 */
export async function inscreverClienteNaTrilhaAutomaticamente(
  clienteId: string,
  produtoId: string
): Promise<string | null> {
  // 1. Busca direta
  let trilha = await queryOne<{ id: string }>(`
    SELECT id FROM trilhas_cadencia
    WHERE produto_entrada_id = $1 AND ativa = true
    LIMIT 1
  `, [produtoId])

  console.log(`[Cadencia] produto_id=${produtoId} match_direto=${trilha ? trilha.id : 'não'}`)

  // 2. Fallback por nome — o banco tem produtos duplicados com hotmart_ids distintos
  if (!trilha) {
    const produto = await queryOne<{ nome: string }>(
      'SELECT nome FROM produtos WHERE id = $1', [produtoId]
    )
    if (produto) {
      const nomeNorm   = normalizarNomeProduto(produto.nome)
      const nomePrefixo = produto.nome.toLowerCase().substring(0, 20)
      console.log(`[Cadencia] Fallback por nome: "${produto.nome}" → norm="${nomeNorm}"`)

      if (nomeNorm.length >= 6) {
        trilha = await queryOne<{ id: string }>(`
          SELECT tc.id FROM trilhas_cadencia tc
          JOIN produtos pe ON pe.id = tc.produto_entrada_id
          WHERE tc.ativa = true
            AND (
              LOWER(pe.nome) LIKE $1
              OR LOWER(pe.nome) LIKE $2
            )
          LIMIT 1
        `, [`%${nomeNorm}%`, `%${nomePrefixo}%`])

        console.log(`[Cadencia] Fallback resultado: ${trilha ? trilha.id : 'nenhuma trilha encontrada'}`)
      }
    }
  }

  if (!trilha) {
    console.log(`[Cadencia] Nenhuma trilha para produto_id=${produtoId} — cliente não inscrito`)
    return null
  }

  // Busca etapa 1 para calcular data_proxima_etapa
  const etapa1 = await queryOne<{ dia_envio: number }>(`
    SELECT dia_envio FROM etapas_cadencia
    WHERE trilha_id = $1 AND numero_etapa = 1 AND ativa = true
  `, [trilha.id])

  const diasEtapa1 = etapa1?.dia_envio ?? 1

  await pool.query(`
    INSERT INTO clientes_trilha (cliente_id, trilha_id, etapa_atual, data_proxima_etapa)
    VALUES ($1, $2, 1, NOW() + ($3 || ' days')::interval)
    ON CONFLICT (cliente_id, trilha_id) DO NOTHING
  `, [clienteId, trilha.id, diasEtapa1])

  console.log(`[Cadencia] Cliente ${clienteId} inscrito na trilha ${trilha.id}`)
  return trilha.id
}

// ── Lista do dia ───────────────────────────────────────────────────────────

export async function buscarListaDoDia(): Promise<ItemListaDia[]> {
  const rows = await query<{
    id: string
    cliente_id: string
    cliente_nome: string
    cliente_email: string
    cliente_telefone: string | null
    trilha_id: string
    trilha_nome: string
    trilha_cor: string
    produto_entrada: string
    etapa_atual: number
    total_etapas: number
    etapa_id: string
    nome_etapa: string
    mensagem_whatsapp: string
    dias_na_trilha: number
    status: string
  }>(`
    SELECT
      ct.id,
      ct.cliente_id,
      c.nome                           AS cliente_nome,
      c.email                          AS cliente_email,
      c.telefone_formatado             AS cliente_telefone,
      t.id                             AS trilha_id,
      t.nome                           AS trilha_nome,
      t.cor                            AS trilha_cor,
      COALESCE(pe.nome, '')            AS produto_entrada,
      ct.etapa_atual,
      (SELECT COUNT(*)::int FROM etapas_cadencia WHERE trilha_id = t.id AND ativa = true)
                                       AS total_etapas,
      e.id                             AS etapa_id,
      e.nome                           AS nome_etapa,
      e.mensagem_whatsapp,
      EXTRACT(DAY FROM NOW() - ct.data_entrada)::int AS dias_na_trilha,
      ct.status
    FROM clientes_trilha ct
    JOIN clientes c           ON c.id = ct.cliente_id
    JOIN trilhas_cadencia t   ON t.id = ct.trilha_id
    LEFT JOIN produtos pe     ON pe.id = t.produto_entrada_id
    JOIN etapas_cadencia e    ON e.trilha_id = t.id
                             AND e.numero_etapa = ct.etapa_atual
                             AND e.ativa = true
    WHERE ct.status = 'ativo'
      AND ct.data_proxima_etapa <= NOW()
    ORDER BY ct.data_proxima_etapa ASC
  `)

  return rows.map(r => {
    const msg = r.mensagem_whatsapp.replace(/\{nome\}/g, r.cliente_nome.split(' ')[0])
    const link = r.cliente_telefone
      ? `https://wa.me/${r.cliente_telefone}?text=${encodeURIComponent(msg)}`
      : null

    return {
      id:               r.id,
      cliente_id:       r.cliente_id,
      cliente_nome:     r.cliente_nome,
      cliente_email:    r.cliente_email,
      cliente_telefone: r.cliente_telefone,
      trilha_id:        r.trilha_id,
      trilha_nome:      r.trilha_nome,
      trilha_cor:       r.trilha_cor,
      produto_entrada:  r.produto_entrada,
      etapa_atual:      r.etapa_atual,
      total_etapas:     r.total_etapas,
      etapa_id:         r.etapa_id,
      nome_etapa:       r.nome_etapa,
      dias_na_trilha:   r.dias_na_trilha,
      mensagem_do_dia:  msg,
      link_whatsapp:    link,
      status:           r.status,
    }
  })
}

// ── Avançar etapa ──────────────────────────────────────────────────────────

type StatusContato = 'enviado' | 'respondeu' | 'sem_resposta' | 'convertido' | 'nao_quer'

export async function avancarEtapa(
  clienteTrilhaId: string,
  statusContato: StatusContato,
  observacao?: string
): Promise<{ ok: boolean; proximo_status: string; data_proxima_etapa: string | null }> {
  const ct = await queryOne<{
    id: string; trilha_id: string; etapa_atual: number; data_entrada: string; status: string
  }>(`SELECT id, trilha_id, etapa_atual, data_entrada, status FROM clientes_trilha WHERE id = $1`, [clienteTrilhaId])

  if (!ct) throw new Error('Registro clientes_trilha não encontrado')
  if (ct.status !== 'ativo') throw new Error('Trilha não está ativa para este cliente')

  // Registra o contato no histórico
  const etapaAtual = await queryOne<{ id: string }>(`
    SELECT id FROM etapas_cadencia
    WHERE trilha_id = $1 AND numero_etapa = $2 AND ativa = true
  `, [ct.trilha_id, ct.etapa_atual])

  await pool.query(`
    INSERT INTO historico_cadencia (cliente_trilha_id, etapa_id, status_contato, observacao)
    VALUES ($1, $2, $3, $4)
  `, [clienteTrilhaId, etapaAtual?.id ?? null, statusContato, observacao ?? null])

  // Determina novo status
  if (statusContato === 'convertido') {
    await pool.query(
      `UPDATE clientes_trilha SET status = 'convertido', updated_at = NOW() WHERE id = $1`,
      [clienteTrilhaId]
    )
    return { ok: true, proximo_status: 'convertido', data_proxima_etapa: null }
  }

  if (statusContato === 'nao_quer') {
    await pool.query(
      `UPDATE clientes_trilha SET status = 'desistiu', updated_at = NOW() WHERE id = $1`,
      [clienteTrilhaId]
    )
    return { ok: true, proximo_status: 'desistiu', data_proxima_etapa: null }
  }

  // Para enviado, respondeu ou sem_resposta → avança para próxima etapa
  const proximaEtapa = await queryOne<{ numero_etapa: number; dia_envio: number }>(`
    SELECT numero_etapa, dia_envio FROM etapas_cadencia
    WHERE trilha_id = $1 AND numero_etapa > $2 AND ativa = true
    ORDER BY numero_etapa ASC
    LIMIT 1
  `, [ct.trilha_id, ct.etapa_atual])

  if (!proximaEtapa) {
    // Última etapa — conclui
    await pool.query(
      `UPDATE clientes_trilha SET status = 'concluido', updated_at = NOW() WHERE id = $1`,
      [clienteTrilhaId]
    )
    return { ok: true, proximo_status: 'concluido', data_proxima_etapa: null }
  }

  // Ancora a próxima etapa à data de entrada (não a data atual)
  const dataProxima = new Date(ct.data_entrada)
  dataProxima.setDate(dataProxima.getDate() + proximaEtapa.dia_envio)

  await pool.query(`
    UPDATE clientes_trilha
    SET etapa_atual = $2, data_proxima_etapa = $3, updated_at = NOW()
    WHERE id = $1
  `, [clienteTrilhaId, proximaEtapa.numero_etapa, dataProxima.toISOString()])

  return {
    ok: true,
    proximo_status: 'ativo',
    data_proxima_etapa: dataProxima.toISOString(),
  }
}

// ── Métricas ───────────────────────────────────────────────────────────────

export async function buscarMetricasCadencias() {
  const [porTrilha, porEtapa] = await Promise.all([
    query<{
      trilha_id: string
      trilha_nome: string
      trilha_cor: string
      total: number
      ativos: number
      convertidos: number
      desistiram: number
      concluidos: number
      taxa_conversao: number
      tempo_medio_dias: number | null
    }>(`
      SELECT
        t.id                                                          AS trilha_id,
        t.nome                                                        AS trilha_nome,
        t.cor                                                         AS trilha_cor,
        COUNT(ct.id)::int                                             AS total,
        COUNT(CASE WHEN ct.status = 'ativo'      THEN 1 END)::int    AS ativos,
        COUNT(CASE WHEN ct.status = 'convertido' THEN 1 END)::int    AS convertidos,
        COUNT(CASE WHEN ct.status = 'desistiu'   THEN 1 END)::int    AS desistiram,
        COUNT(CASE WHEN ct.status = 'concluido'  THEN 1 END)::int    AS concluidos,
        CASE WHEN COUNT(ct.id) > 0
          THEN ROUND(
            COUNT(CASE WHEN ct.status = 'convertido' THEN 1 END)::numeric / COUNT(ct.id) * 100, 1
          )::float
          ELSE 0
        END                                                           AS taxa_conversao,
        ROUND(
          AVG(
            CASE WHEN ct.status = 'convertido'
              THEN EXTRACT(DAY FROM ct.updated_at - ct.data_entrada)
            END
          )
        )::int                                                        AS tempo_medio_dias
      FROM trilhas_cadencia t
      LEFT JOIN clientes_trilha ct ON ct.trilha_id = t.id
      WHERE t.ativa = true
      GROUP BY t.id, t.nome, t.cor
      ORDER BY convertidos DESC, total DESC
    `),

    query<{
      trilha_nome: string
      etapa_numero: number
      etapa_nome: string
      total_chegaram: number
      convertidos: number
      desistiram: number
    }>(`
      SELECT
        t.nome                                                          AS trilha_nome,
        e.numero_etapa                                                  AS etapa_numero,
        e.nome                                                          AS etapa_nome,
        COUNT(hc.id)::int                                               AS total_chegaram,
        COUNT(CASE WHEN hc.status_contato = 'convertido' THEN 1 END)::int AS convertidos,
        COUNT(CASE WHEN hc.status_contato = 'nao_quer'   THEN 1 END)::int AS desistiram
      FROM etapas_cadencia e
      JOIN trilhas_cadencia t ON t.id = e.trilha_id
      LEFT JOIN historico_cadencia hc ON hc.etapa_id = e.id
      WHERE t.ativa = true
      GROUP BY t.id, t.nome, e.id, e.numero_etapa, e.nome
      ORDER BY t.nome, e.numero_etapa
    `),
  ])

  return { por_trilha: porTrilha, por_etapa: porEtapa }
}
