import { pool, query, queryOne } from '../db'

// ── Score de priorização ───────────────────────────────────────────────────

interface ClienteReativacao {
  cliente_id: string
  nome: string
  email: string
  telefone_formatado: string | null
  telefone_valido: boolean
  produtos: Array<{ nome: string; tipo: string; is_order_bump: boolean }>
  dias_desde_compra: number
}

type TipoProdutoReativacao = 'multiplos' | 'workshop' | 'livro' | 'order_bump'

function calcularScoreReativacao(c: ClienteReativacao): number {
  let score = 0

  // Telefone válido é obrigatório para contato — peso alto
  if (c.telefone_valido) score += 30
  else return 0 // sem telefone, score zero — vai para o fim da fila

  const tipos = new Set(c.produtos.map(p => p.tipo))
  const temWorkshop = c.produtos.some(p =>
    /workshop|masterclass|desafio/i.test(p.nome + ' ' + p.tipo)
  )
  const temLivro   = c.produtos.some(p => /livro|generoso|fraqueza|vida|inabalável/i.test(p.nome + ' ' + p.tipo))
  const soOrderBump = c.produtos.every(p => p.is_order_bump)

  if (c.produtos.length >= 2) score += 40
  if (temWorkshop)            score += 50
  else if (temLivro)          score += 20
  else if (soOrderBump)       score += 10

  // Bonus por recência (mais recente = mais morno)
  if      (c.dias_desde_compra <= 60)  score += 20
  else if (c.dias_desde_compra <= 90)  score += 10
  else if (c.dias_desde_compra <= 180) score += 5

  // Bonus por email pessoal
  if (/gmail|hotmail|yahoo|outlook/i.test(c.email)) score += 5

  return score
}

function detectarTipoProduto(c: ClienteReativacao): TipoProdutoReativacao {
  if (c.produtos.length >= 2) return 'multiplos'
  const temWorkshop = c.produtos.some(p =>
    /workshop|masterclass|desafio/i.test(p.nome + ' ' + p.tipo)
  )
  if (temWorkshop) return 'workshop'
  const temLivro = c.produtos.some(p =>
    /livro|generoso|fraqueza|vida/i.test(p.nome + ' ' + p.tipo)
  )
  if (temLivro) return 'livro'
  return 'order_bump'
}

// ── Popular fila ───────────────────────────────────────────────────────────

export async function popularFilaReativacao(): Promise<{
  adicionados: number
  ja_na_fila: number
  sem_telefone: number
  ja_convertidos: number
}> {
  console.log('[Reativação] Iniciando população da fila...')

  // Busca configs
  const cfgDias = await queryOne<{ valor: string }>(
    `SELECT valor FROM configuracoes WHERE chave = 'dias_lead_antigo'`
  )
  const diasAntigo = Number(cfgDias?.valor ?? 30)

  // Clientes elegíveis: não têm Conduta Masculina, última compra > X dias, não estão em cadência ativa
  const candidatos = await query<{
    cliente_id: string
    nome: string
    email: string
    telefone_formatado: string | null
    telefone_valido: boolean
    dias_desde_compra: number
    produto_principal: string
  }>(`
    SELECT
      c.id                                                          AS cliente_id,
      c.nome,
      c.email,
      c.telefone_formatado,
      c.telefone_valido,
      EXTRACT(DAY FROM NOW() - MAX(co.data_compra))::int            AS dias_desde_compra,
      (SELECT p2.nome FROM compras co2
       JOIN produtos p2 ON p2.id = co2.produto_id
       WHERE co2.cliente_id = c.id AND co2.status IN ('COMPLETE','APPROVED')
       ORDER BY co2.data_compra DESC LIMIT 1)                       AS produto_principal
    FROM clientes c
    JOIN compras co ON co.cliente_id = c.id AND co.status IN ('COMPLETE','APPROVED')
    WHERE
      -- Não tem Conduta Masculina
      NOT EXISTS (
        SELECT 1 FROM compras co3
        JOIN produtos p3 ON p3.id = co3.produto_id
        WHERE co3.cliente_id = c.id AND co3.status IN ('COMPLETE','APPROVED')
          AND (p3.tipo = 'principal' OR p3.nome ILIKE '%Conduta Masculina%')
      )
      -- Última compra foi há mais de X dias
      AND c.id NOT IN (
        SELECT co4.cliente_id FROM compras co4
        WHERE co4.status IN ('COMPLETE','APPROVED')
          AND co4.data_compra >= NOW() - ($1 || ' days')::interval
      )
      -- Não está em trilha de reativação ativa
      AND NOT EXISTS (
        SELECT 1 FROM clientes_trilha ct
        JOIN trilhas_cadencia t ON t.id = ct.trilha_id
        WHERE ct.cliente_id = c.id AND ct.status = 'ativo' AND t.tipo_pipeline = 'reativacao'
      )
    GROUP BY c.id, c.nome, c.email, c.telefone_formatado, c.telefone_valido
    ORDER BY MAX(co.data_compra) DESC
  `, [diasAntigo])

  console.log(`[Reativação] ${candidatos.length} candidatos encontrados`)

  let adicionados  = 0
  let ja_na_fila   = 0
  let sem_telefone = 0
  let ja_convertidos = 0

  for (const c of candidatos) {
    // Busca produtos deste cliente
    const produtos = await query<{ nome: string; tipo: string; is_order_bump: boolean }>(`
      SELECT p.nome, COALESCE(p.tipo, 'entrada') AS tipo, COALESCE(co.is_order_bump, false) AS is_order_bump
      FROM compras co
      JOIN produtos p ON p.id = co.produto_id
      WHERE co.cliente_id = $1 AND co.status IN ('COMPLETE','APPROVED')
    `, [c.cliente_id])

    const cliente: ClienteReativacao = {
      cliente_id:         c.cliente_id,
      nome:               c.nome,
      email:              c.email,
      telefone_formatado: c.telefone_formatado,
      telefone_valido:    c.telefone_valido,
      produtos,
      dias_desde_compra:  c.dias_desde_compra,
    }

    if (!c.telefone_valido) { sem_telefone++; continue }

    const score    = calcularScoreReativacao(cliente)
    const tipoProd = detectarTipoProduto(cliente)

    const resultado = await pool.query(`
      INSERT INTO fila_reativacao
        (cliente_id, produto_principal_comprado, tipo_produto, dias_desde_compra, score_prioridade)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (cliente_id) DO UPDATE SET
        score_prioridade          = EXCLUDED.score_prioridade,
        produto_principal_comprado = EXCLUDED.produto_principal_comprado,
        tipo_produto              = EXCLUDED.tipo_produto,
        dias_desde_compra         = EXCLUDED.dias_desde_compra
      WHERE fila_reativacao.status = 'aguardando'
    `, [c.cliente_id, c.produto_principal ?? '', tipoProd, c.dias_desde_compra, score])

    if ((resultado.rowCount ?? 0) > 0) adicionados++
    else ja_na_fila++
  }

  console.log(
    `[Reativação] Fila populada — adicionados: ${adicionados}` +
    ` | já na fila: ${ja_na_fila} | sem telefone: ${sem_telefone}`
  )

  return { adicionados, ja_na_fila, sem_telefone, ja_convertidos }
}

// ── Selecionar trilha de reativação correta ────────────────────────────────

async function selecionarTrilhaReativacao(tipoProduto: string): Promise<string | null> {
  const mapa: Record<string, string> = {
    multiplos:  '%Múltiplos%',
    workshop:   '%Workshop/Masterclass%',
    livro:      '%Livros%',
    order_bump: '%Order Bump%',
  }
  const pattern = mapa[tipoProduto] ?? '%Livros%'

  const trilha = await queryOne<{ id: string }>(`
    SELECT id FROM trilhas_cadencia
    WHERE tipo_pipeline = 'reativacao' AND nome ILIKE $1 AND ativa = true
    LIMIT 1
  `, [pattern])

  return trilha?.id ?? null
}

// ── Buscar lista de reativação do dia ──────────────────────────────────────

export interface ItemReativacao {
  id: string               // clientes_trilha.id
  fila_id: string          // fila_reativacao.id
  cliente_id: string
  cliente_nome: string
  cliente_email: string
  cliente_telefone: string | null
  produto_comprado: string
  tipo_produto: string
  dias_desde_compra: number
  score_prioridade: number
  trilha_nome: string
  trilha_cor: string
  etapa_atual: number
  total_etapas: number
  nome_etapa: string
  mensagem_do_dia: string
  link_whatsapp: string | null
}

export async function buscarListaReativacaoDia(): Promise<ItemReativacao[]> {
  // 1. Clientes já em cadência de reativação com etapa vencida
  const emCadencia = await query<{
    ct_id: string
    fila_id: string
    cliente_id: string
    cliente_nome: string
    cliente_email: string
    cliente_telefone: string | null
    produto_comprado: string
    tipo_produto: string
    dias_desde_compra: number
    score_prioridade: number
    trilha_nome: string
    trilha_cor: string
    etapa_atual: number
    total_etapas: number
    nome_etapa: string
    mensagem_whatsapp: string
  }>(`
    SELECT
      ct.id                   AS ct_id,
      fr.id                   AS fila_id,
      ct.cliente_id,
      c.nome                  AS cliente_nome,
      c.email                 AS cliente_email,
      c.telefone_formatado    AS cliente_telefone,
      fr.produto_principal_comprado AS produto_comprado,
      fr.tipo_produto,
      fr.dias_desde_compra,
      fr.score_prioridade,
      t.nome                  AS trilha_nome,
      t.cor                   AS trilha_cor,
      ct.etapa_atual,
      (SELECT COUNT(*)::int FROM etapas_cadencia WHERE trilha_id = t.id AND ativa = true) AS total_etapas,
      e.nome                  AS nome_etapa,
      e.mensagem_whatsapp
    FROM clientes_trilha ct
    JOIN trilhas_cadencia t ON t.id = ct.trilha_id AND t.tipo_pipeline = 'reativacao'
    JOIN clientes c ON c.id = ct.cliente_id
    JOIN fila_reativacao fr ON fr.cliente_id = ct.cliente_id
    JOIN etapas_cadencia e ON e.trilha_id = t.id AND e.numero_etapa = ct.etapa_atual AND e.ativa = true
    WHERE ct.status = 'ativo' AND ct.data_proxima_etapa <= NOW()
    ORDER BY fr.score_prioridade DESC
  `)

  // 2. Busca limite da config
  const cfgLimite = await queryOne<{ valor: string }>(
    `SELECT valor FROM configuracoes WHERE chave = 'limite_reativacao_diaria'`
  )
  const limite = Number(cfgLimite?.valor ?? 15)

  const resultado: ItemReativacao[] = []

  for (const r of emCadencia) {
    if (resultado.length >= limite) break
    const produto = r.produto_comprado
    const msg = r.mensagem_whatsapp
      .replace(/\{nome\}/g, r.cliente_nome.split(' ')[0])
      .replace(/\{produto\}/g, produto)
    resultado.push({
      id:                r.ct_id,
      fila_id:           r.fila_id,
      cliente_id:        r.cliente_id,
      cliente_nome:      r.cliente_nome,
      cliente_email:     r.cliente_email,
      cliente_telefone:  r.cliente_telefone,
      produto_comprado:  produto,
      tipo_produto:      r.tipo_produto,
      dias_desde_compra: r.dias_desde_compra,
      score_prioridade:  r.score_prioridade,
      trilha_nome:       r.trilha_nome,
      trilha_cor:        r.trilha_cor,
      etapa_atual:       r.etapa_atual,
      total_etapas:      r.total_etapas,
      nome_etapa:        r.nome_etapa,
      mensagem_do_dia:   msg,
      link_whatsapp:     r.cliente_telefone
        ? `https://wa.me/${r.cliente_telefone}?text=${encodeURIComponent(msg)}`
        : null,
    })
  }

  // 3. Se ainda falta espaço, pega da fila e inscreve
  const faltam = limite - resultado.length
  if (faltam > 0) {
    const novos = await query<{
      fila_id: string
      cliente_id: string
      cliente_nome: string
      cliente_email: string
      cliente_telefone: string | null
      produto_comprado: string
      tipo_produto: string
      dias_desde_compra: number
      score_prioridade: number
    }>(`
      SELECT
        fr.id AS fila_id,
        fr.cliente_id,
        c.nome AS cliente_nome,
        c.email AS cliente_email,
        c.telefone_formatado AS cliente_telefone,
        fr.produto_principal_comprado AS produto_comprado,
        fr.tipo_produto,
        fr.dias_desde_compra,
        fr.score_prioridade
      FROM fila_reativacao fr
      JOIN clientes c ON c.id = fr.cliente_id
      WHERE fr.status = 'aguardando'
      ORDER BY fr.score_prioridade DESC
      LIMIT $1
    `, [faltam])

    for (const novo of novos) {
      // Seleciona trilha e inscreve
      const trilhaId = await selecionarTrilhaReativacao(novo.tipo_produto)
      if (!trilhaId) continue

      const etapa1 = await queryOne<{ id: string; dia_envio: number; nome: string; mensagem_whatsapp: string }>(`
        SELECT id, dia_envio, nome, mensagem_whatsapp FROM etapas_cadencia
        WHERE trilha_id = $1 AND numero_etapa = 1 AND ativa = true
      `, [trilhaId])
      if (!etapa1) continue

      // Inscreve na trilha
      const ct = await queryOne<{ id: string }>(`
        INSERT INTO clientes_trilha (cliente_id, trilha_id, etapa_atual, data_proxima_etapa, tipo_pipeline)
        VALUES ($1, $2, 1, NOW(), 'reativacao')
        ON CONFLICT (cliente_id, trilha_id) DO NOTHING
        RETURNING id
      `, [novo.cliente_id, trilhaId])
      if (!ct) continue

      // Atualiza fila
      await pool.query(`
        UPDATE fila_reativacao
        SET status = 'em_cadencia', data_inicio_cadencia = NOW()
        WHERE id = $1
      `, [novo.fila_id])

      const trilhaDados = await queryOne<{ nome: string; cor: string; total_etapas: number }>(`
        SELECT nome, cor,
          (SELECT COUNT(*)::int FROM etapas_cadencia WHERE trilha_id = $1 AND ativa = true) AS total_etapas
        FROM trilhas_cadencia WHERE id = $1
      `, [trilhaId])

      const produto = novo.produto_comprado
      const msg = etapa1.mensagem_whatsapp
        .replace(/\{nome\}/g, novo.cliente_nome.split(' ')[0])
        .replace(/\{produto\}/g, produto)

      resultado.push({
        id:                ct.id,
        fila_id:           novo.fila_id,
        cliente_id:        novo.cliente_id,
        cliente_nome:      novo.cliente_nome,
        cliente_email:     novo.cliente_email,
        cliente_telefone:  novo.cliente_telefone,
        produto_comprado:  produto,
        tipo_produto:      novo.tipo_produto,
        dias_desde_compra: novo.dias_desde_compra,
        score_prioridade:  novo.score_prioridade,
        trilha_nome:       trilhaDados?.nome ?? '',
        trilha_cor:        trilhaDados?.cor ?? '#F97316',
        etapa_atual:       1,
        total_etapas:      trilhaDados?.total_etapas ?? 4,
        nome_etapa:        etapa1.nome,
        mensagem_do_dia:   msg,
        link_whatsapp:     novo.cliente_telefone
          ? `https://wa.me/${novo.cliente_telefone}?text=${encodeURIComponent(msg)}`
          : null,
      })
    }
  }

  return resultado
}

// ── Stats da fila ──────────────────────────────────────────────────────────

export async function buscarStatsReativacao() {
  const [geral, porTipo, semTel, cfgLimite] = await Promise.all([
    query<{ status: string; total: number }>(`
      SELECT status, COUNT(*)::int AS total FROM fila_reativacao GROUP BY status
    `),
    query<{ tipo_produto: string; total: number }>(`
      SELECT tipo_produto, COUNT(*)::int AS total
      FROM fila_reativacao WHERE status = 'aguardando'
      GROUP BY tipo_produto
    `),
    queryOne<{ total: number }>(`
      SELECT COUNT(*)::int AS total FROM clientes
      WHERE telefone_valido = false
        AND NOT EXISTS (
          SELECT 1 FROM compras co JOIN produtos p ON p.id = co.produto_id
          WHERE co.cliente_id = clientes.id AND co.status IN ('COMPLETE','APPROVED')
            AND (p.tipo = 'principal' OR p.nome ILIKE '%Conduta Masculina%')
        )
    `),
    queryOne<{ valor: string }>(`SELECT valor FROM configuracoes WHERE chave = 'limite_reativacao_diaria'`),
  ])

  const porStatus: Record<string, number> = {}
  for (const r of geral) porStatus[r.status] = r.total

  const porTipoProd: Record<string, number> = {}
  for (const r of porTipo) porTipoProd[r.tipo_produto] = r.total

  const totalFila    = Object.values(porStatus).reduce((s, v) => s + v, 0)
  const aguardando   = porStatus['aguardando']   ?? 0
  const limiteDiario = Number(cfgLimite?.valor ?? 15)
  const projecao     = limiteDiario > 0 ? Math.ceil(aguardando / limiteDiario) : null

  return {
    total_fila:       totalFila,
    aguardando,
    em_cadencia:      porStatus['em_cadencia']  ?? 0,
    convertidos:      porStatus['convertido']   ?? 0,
    descartados:      porStatus['descartado']   ?? 0,
    sem_telefone:     semTel?.total ?? 0,
    por_tipo_produto: {
      multiplos:  porTipoProd['multiplos']  ?? 0,
      workshop:   porTipoProd['workshop']   ?? 0,
      livro:      porTipoProd['livro']      ?? 0,
      order_bump: porTipoProd['order_bump'] ?? 0,
    },
    limite_diario:             limiteDiario,
    projecao_dias_para_zerar:  projecao,
  }
}
