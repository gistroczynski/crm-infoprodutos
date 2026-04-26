import { buscarListaReativacaoDia, popularFilaReativacao } from '../services/reativacao'
import { inscreverClienteNaTrilhaAutomaticamente }        from '../services/cadencia'
import { pool, query }                                     from '../db'

export async function executarListaReativacao(): Promise<void> {
  console.log('[Jobs/Cadencia] Pré-aquecendo lista de reativação...')
  try {
    const itens = await buscarListaReativacaoDia()
    console.log(`[Jobs/Cadencia] Reativação: ${itens.length} clientes prontos para hoje.`)
  } catch (err) {
    console.error('[Jobs/Cadencia] Erro na lista de reativação:', err)
    throw err
  }
}

export async function executarPopularFilaReativacao(): Promise<void> {
  console.log('[Jobs/Cadencia] Popular fila de reativação (job semanal)...')
  try {
    const resultado = await popularFilaReativacao()
    console.log(
      `[Jobs/Cadencia] Fila atualizada — adicionados: ${resultado.adicionados}` +
      ` | já na fila: ${resultado.ja_na_fila} | sem telefone: ${resultado.sem_telefone}`
    )
  } catch (err) {
    console.error('[Jobs/Cadencia] Erro ao popular fila de reativação:', err)
    throw err
  }
}

export async function executarAtualizarPrioridades(): Promise<void> {
  console.log('[Jobs/Cadencia] Atualizando prioridades fluxo ativo e reativação...')

  // Fluxo ativo
  const deletadoAtivo = await pool.query(`
    DELETE FROM clientes_trilha
    WHERE etapa_atual = 1 AND status = 'ativo'
      AND (tipo_pipeline = 'ativo' OR tipo_pipeline IS NULL)
  `)
  const removidosAtivo = deletadoAtivo.rowCount ?? 0

  const clientes = await query<{ cliente_id: string; produto_id: string }>(`
    SELECT DISTINCT ON (co.cliente_id) co.cliente_id, co.produto_id
    FROM compras co
    WHERE (co.data_compra AT TIME ZONE 'America/Sao_Paulo')::date
            >= (NOW() AT TIME ZONE 'America/Sao_Paulo')::date - INTERVAL '30 days'
      AND co.status IN ('COMPLETE', 'COMPLETED', 'APPROVED')
    ORDER BY co.cliente_id, co.data_compra DESC
  `)

  let reinseridosAtivo = 0
  for (const c of clientes) {
    const trilhaId = await inscreverClienteNaTrilhaAutomaticamente(c.cliente_id, c.produto_id)
    if (trilhaId) reinseridosAtivo++
  }

  if (reinseridosAtivo > 0) {
    await pool.query(`
      UPDATE clientes_trilha
      SET data_proxima_etapa = NOW()
      WHERE etapa_atual = 1 AND status = 'ativo'
        AND (tipo_pipeline = 'ativo' OR tipo_pipeline IS NULL)
        AND data_proxima_etapa > NOW()
    `)
  }

  // Reativação
  const deletadoReativacao = await pool.query(`
    DELETE FROM clientes_trilha
    WHERE etapa_atual = 1 AND status = 'ativo' AND tipo_pipeline = 'reativacao'
  `)
  const removidosReativacao = deletadoReativacao.rowCount ?? 0

  const reativacao = await popularFilaReativacao()

  console.log(
    `[Jobs/Cadencia] Prioridades atualizadas automaticamente` +
    ` | fluxo ativo: -${removidosAtivo} / +${reinseridosAtivo}` +
    ` | reativação: -${removidosReativacao} / +${reativacao.adicionados}`
  )
}
