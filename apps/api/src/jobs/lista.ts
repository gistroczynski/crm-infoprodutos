import { gerarListaDiaria } from '../services/lista'

export async function executarGeracaoLista(): Promise<void> {
  console.log('[Cron/Lista] Iniciando geração da lista diária...')
  try {
    const resultado = await gerarListaDiaria()
    console.log(
      `[Cron/Lista] Lista gerada: ${resultado.alta} de alta prioridade,` +
      ` ${resultado.media} de média, ${resultado.baixa} de baixa` +
      ` | total: ${resultado.total}`
    )
  } catch (err) {
    console.error('[Cron/Lista] Erro ao gerar lista diária:', err)
  }
}
