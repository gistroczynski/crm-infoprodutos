import { query, queryOne, pool } from '../db'
import { calcularScores, salvarScores, buscarCandidatos, zerarScoresClientesSemCompras } from './scoring'

// ── Tipos ──────────────────────────────────────────────────────────────────

export interface ItemListaDiaria {
  id: string
  cliente_id: string
  nome: string
  email: string
  telefone_formatado: string | null
  produto_comprado: string | null
  data_compra: string | null
  dias_desde_compra: number | null
  status: string
  prioridade: string
  score: number
  motivos: string[]
  link_whatsapp: string | null
  status_contato: string
  observacao: string | null
  contatado_em: string | null
  trilha_nome: string | null
  trilha_cor: string | null
  trilha_etapa: number | null
}

export interface ListaHojeResult {
  data: string
  total: number
  alta: number
  media: number
  baixa: number
  itens: ItemListaDiaria[]
}

// ── WhatsApp ───────────────────────────────────────────────────────────────

const TEMPLATE_PADRAO =
  'Olá {nome}! Vi que você tem o {produto} e queria entender como está sendo sua experiência. Posso te ajudar com alguma coisa? 😊'

export function gerarLinkWhatsApp(
  telefone: string,
  nomeCliente: string,
  nomeProduto: string,
  template?: string
): string {
  const texto = (template ?? TEMPLATE_PADRAO)
    .replace(/\{nome\}/g, nomeCliente)
    .replace(/\{produto\}/g, nomeProduto)

  const encoded = encodeURIComponent(texto)
  return `https://wa.me/${telefone}?text=${encoded}`
}

async function resolverLinkWhatsApp(
  telefone: string | null,
  clienteNome: string,
  produtoId: string | null
): Promise<string | null> {
  if (!telefone) return null

  // Busca template específico do produto ou genérico ativo
  let template: string | undefined
  if (produtoId) {
    const row = await queryOne<{ texto: string }>(
      `SELECT texto FROM mensagens_template WHERE produto_id = $1 AND ativa = true LIMIT 1`,
      [produtoId]
    )
    template = row?.texto
  }

  if (!template) {
    const row = await queryOne<{ texto: string }>(
      `SELECT texto FROM mensagens_template WHERE produto_id IS NULL AND ativa = true LIMIT 1`
    )
    template = row?.texto
  }

  // Busca nome do produto mais recente do cliente para personalizar mensagem
  const nomeProduto = produtoId
    ? (await queryOne<{ nome: string }>(`SELECT nome FROM produtos WHERE id = $1`, [produtoId]))?.nome ?? 'nosso produto'
    : 'nosso produto'

  return gerarLinkWhatsApp(telefone, clienteNome, nomeProduto, template)
}

// ── Geração da lista ───────────────────────────────────────────────────────

export async function gerarListaDiaria(): Promise<{
  data: string
  total: number
  alta: number
  media: number
  baixa: number
}> {
  const hoje = new Date().toISOString().slice(0, 10)
  console.log(`[Lista] Iniciando geração para ${hoje}...`)

  // 1. Calcula e salva scores; zera clientes sem compras
  const scores = await calcularScores()
  await salvarScores(scores)
  await zerarScoresClientesSemCompras()

  // 2. Apaga lista existente para hoje
  await pool.query(`DELETE FROM lista_diaria WHERE data = $1`, [hoje])

  if (scores.length === 0) {
    console.log('[Lista] Nenhum candidato encontrado.')
    return { data: hoje, total: 0, alta: 0, media: 0, baixa: 0 }
  }

  // 3. Busca limite configurado
  const configLimite = await queryOne<{ valor: string }>(
    `SELECT valor FROM configuracoes WHERE chave = 'limite_lista_diaria'`
  )
  const limite = Number(configLimite?.valor ?? 30)

  // 4. Seleciona top N por score e insere na lista_diaria
  const topScores = [...scores]
    .sort((a, b) => b.score - a.score)
    .slice(0, limite)

  if (topScores.length === 0) {
    return { data: hoje, total: 0, alta: 0, media: 0, baixa: 0 }
  }

  const placeholders = topScores.map((_, i) => {
    const b = i * 5
    return `($1::date, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}::jsonb, $${b + 6})`
  }).join(', ')

  const params: unknown[] = [hoje]
  for (const s of topScores) {
    params.push(s.cliente_id, s.prioridade, s.score, JSON.stringify(s.motivos), 'pendente')
  }

  await pool.query(`
    INSERT INTO lista_diaria (data, cliente_id, prioridade, score, motivos, status_contato)
    VALUES ${placeholders}
    ON CONFLICT (data, cliente_id) DO NOTHING
  `, params)

  const alta  = topScores.filter(s => s.prioridade === 'alta').length
  const media = topScores.filter(s => s.prioridade === 'media').length
  const baixa = topScores.filter(s => s.prioridade === 'baixa').length

  console.log(
    `[Lista] Gerada para ${hoje}: ${topScores.length} itens` +
    ` | alta: ${alta} | média: ${media} | baixa: ${baixa}`
  )

  return { data: hoje, total: topScores.length, alta, media, baixa }
}

// ── Leitura da lista ───────────────────────────────────────────────────────

export async function buscarListaHoje(
  filtros: { prioridade?: string; data?: string } = {}
): Promise<ListaHojeResult> {
  const data = filtros.data ?? new Date().toISOString().slice(0, 10)

  const whereExtra = filtros.prioridade
    ? `AND ld.prioridade = '${filtros.prioridade}'`
    : ''

  const itensRaw = await query<{
    id: string
    cliente_id: string
    nome: string
    email: string
    telefone_formatado: string | null
    produto_id: string | null
    produto_comprado: string | null
    data_compra: string | null
    prioridade: string
    score: number
    motivos: string
    status: string
    status_contato: string
    observacao: string | null
    contatado_em: string | null
    trilha_nome: string | null
    trilha_cor: string | null
    trilha_etapa: number | null
  }>(`
    SELECT
      ld.id,
      ld.cliente_id,
      c.nome,
      c.email,
      c.telefone_formatado,
      p.id                                        AS produto_id,
      p.nome                                      AS produto_comprado,
      co_last.data_compra,
      ld.prioridade,
      ld.score,
      ld.motivos::text                            AS motivos,
      COALESCE(sc.status, 'novo')                 AS status,
      ld.status_contato,
      ld.observacao,
      ld.contatado_em,
      t_cad.nome                                  AS trilha_nome,
      t_cad.cor                                   AS trilha_cor,
      ct_ativo.etapa_atual                        AS trilha_etapa
    FROM lista_diaria ld
    JOIN clientes c ON c.id = ld.cliente_id
    LEFT JOIN status_clientes sc ON sc.cliente_id = ld.cliente_id
    -- última compra do cliente
    LEFT JOIN LATERAL (
      SELECT co.produto_id, co.data_compra
      FROM compras co
      WHERE co.cliente_id = ld.cliente_id AND co.status IN ('COMPLETE', 'APPROVED')
      ORDER BY co.data_compra DESC
      LIMIT 1
    ) co_last ON true
    LEFT JOIN produtos p ON p.id = co_last.produto_id
    -- trilha de cadência ativa (a mais recente, se houver)
    LEFT JOIN LATERAL (
      SELECT ct.trilha_id, ct.etapa_atual
      FROM clientes_trilha ct
      WHERE ct.cliente_id = ld.cliente_id AND ct.status = 'ativo'
      ORDER BY ct.created_at DESC
      LIMIT 1
    ) ct_ativo ON true
    LEFT JOIN trilhas_cadencia t_cad ON t_cad.id = ct_ativo.trilha_id
    WHERE ld.data = $1
    ${whereExtra}
    ORDER BY ld.score DESC
  `, [data])

  const agora = Date.now()

  // Gera links WhatsApp em paralelo (lotes de 10 para não sobrecarregar o pool)
  const itens: ItemListaDiaria[] = []
  for (let i = 0; i < itensRaw.length; i += 10) {
    const lote = itensRaw.slice(i, i + 10)
    const loteComLinks = await Promise.all(lote.map(async row => {
      const link = await resolverLinkWhatsApp(
        row.telefone_formatado,
        row.nome,
        row.produto_id
      )

      let motivos: string[] = []
      try { motivos = JSON.parse(row.motivos ?? '[]') } catch {}

      const diasDesdeCompra = row.data_compra
        ? Math.floor((agora - new Date(row.data_compra).getTime()) / (1000 * 60 * 60 * 24))
        : null

      return {
        id: row.id,
        cliente_id: row.cliente_id,
        nome: row.nome,
        email: row.email,
        telefone_formatado: row.telefone_formatado,
        produto_comprado: row.produto_comprado,
        data_compra: row.data_compra,
        dias_desde_compra: diasDesdeCompra,
        status: row.status,
        prioridade: row.prioridade,
        score: row.score,
        motivos,
        link_whatsapp: link,
        status_contato: row.status_contato,
        observacao: row.observacao,
        contatado_em: row.contatado_em,
        trilha_nome:  row.trilha_nome  ?? null,
        trilha_cor:   row.trilha_cor   ?? null,
        trilha_etapa: row.trilha_etapa ?? null,
      }
    }))
    itens.push(...loteComLinks)
  }

  const alta  = itens.filter(i => i.prioridade === 'alta').length
  const media = itens.filter(i => i.prioridade === 'media').length
  const baixa = itens.filter(i => i.prioridade === 'baixa').length

  return { data, total: itens.length, alta, media, baixa, itens }
}
