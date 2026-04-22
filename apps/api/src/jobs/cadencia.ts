import { buscarListaReativacaoDia } from '../services/reativacao'
import { popularFilaReativacao }   from '../services/reativacao'

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
