/**
 * Seed: cria as 6 trilhas de cadência com suas etapas.
 * Execute: npx ts-node -e "require('./apps/api/src/db/seed-trilhas.ts')"
 * Ou de dentro de apps/api: npx ts-node src/db/seed-trilhas.ts
 */
import dotenv from 'dotenv'
dotenv.config({ path: '../../.env' })
dotenv.config({ path: '../../../.env' })
dotenv.config()

import { pool, queryOne } from './index'

// ── Definição das trilhas ──────────────────────────────────────────────────

interface EtapaInput {
  dia: number
  nome: string
  mensagem: string
}

interface TrilhaInput {
  nome: string
  produto_entrada_nome?: string
  cor: string
  tipo_pipeline?: 'ativo' | 'reativacao'
  etapas: EtapaInput[]
}

const TRILHAS: TrilhaInput[] = [
  {
    nome: 'Totalmente Generoso → Conduta Masculina',
    produto_entrada_nome: 'Totalmente Generoso',
    cor: '#8B5CF6',
    etapas: [
      {
        dia: 1, nome: 'Boas-vindas',
        mensagem: 'Olá {nome}! Vi que você acabou de pegar o Totalmente Generoso. Boa escolha! Esse livro muda a forma como você se relaciona com as pessoas. Se tiver qualquer dúvida sobre o conteúdo, pode me chamar 👊',
      },
      {
        dia: 3, nome: 'Verificar experiência',
        mensagem: 'E aí {nome}, conseguiu começar a leitura? Qual parte você achou mais impactante até agora?',
      },
      {
        dia: 7, nome: 'Primeira apresentação',
        mensagem: '{nome}, homens que leram o Totalmente Generoso e depois pegaram o Conduta Masculina relatam uma transformação muito mais profunda — porque um complementa o outro. O Generoso te ensina a se relacionar, o Conduta te ensina a liderar. Posso te contar mais sobre isso?',
      },
      {
        dia: 14, nome: 'Follow-up + prova social',
        mensagem: 'Oi {nome}! Passando para saber como está sendo sua jornada com o Totalmente Generoso. Tenho visto muitos alunos que combinaram ele com o Conduta Masculina e os resultados foram impressionantes. Quer que eu te mostre como funciona?',
      },
      {
        dia: 21, nome: 'Ângulo diferente + urgência',
        mensagem: '{nome}, vou ser direto: o Conduta Masculina é o programa mais completo que temos. Homens que passaram por ele relatam mudanças reais em relacionamento, liderança e autoconfiança. Ainda dá tempo de entrar. Quer saber como?',
      },
      {
        dia: 30, nome: 'Última tentativa',
        mensagem: 'Última vez que apareço por aqui, {nome} 😄 Se um dia você sentir que chegou a hora de dar o próximo passo na sua jornada como homem, o Conduta Masculina vai estar aqui. Qualquer coisa é só chamar 👊',
      },
    ],
  },
  {
    nome: 'Fraqueza Masculina → Conduta Masculina',
    produto_entrada_nome: 'A Fraqueza Masculina Não é Tolerada',
    cor: '#EF4444',
    etapas: [
      {
        dia: 1, nome: 'Boas-vindas',
        mensagem: 'Olá {nome}! Vi que você pegou o A Fraqueza Masculina Não é Tolerada. Esse é um dos conteúdos mais diretos que temos. Qualquer dúvida sobre o material, pode me chamar!',
      },
      {
        dia: 3, nome: 'Verificar experiência',
        mensagem: 'E aí {nome}, como está sendo a leitura da Fraqueza Masculina? Alguma parte que te tocou mais até agora?',
      },
      {
        dia: 7, nome: 'Primeira apresentação',
        mensagem: '{nome}, quem leu a Fraqueza Masculina e avançou para o Conduta Masculina diz que finalmente entendeu como colocar tudo em prática. O livro abre os olhos, o Conduta dá o caminho completo. Posso te explicar melhor?',
      },
      {
        dia: 14, nome: 'Follow-up + prova social',
        mensagem: 'Oi {nome}! Como você está aplicando o que aprendeu na Fraqueza Masculina? Tenho acompanhado homens que deram o próximo passo com o Conduta e a mudança é notável. Quer saber mais?',
      },
      {
        dia: 21, nome: 'Ângulo diferente + urgência',
        mensagem: '{nome}, a Fraqueza Masculina te mostrou o problema. O Conduta Masculina te dá a solução completa — passo a passo. É o programa que fecha o ciclo. Ainda dá tempo de entrar 👊',
      },
      {
        dia: 30, nome: 'Última tentativa',
        mensagem: '{nome}, essa é minha última mensagem por aqui. Quando você sentir que é a hora de ir além do livro e ter um programa completo de transformação, o Conduta Masculina vai estar aqui. Abraço 🤝',
      },
    ],
  },
  {
    nome: 'Existe Vida Após o Fim → Conduta Masculina',
    produto_entrada_nome: 'Existe Vida Após o Fim',
    cor: '#10B981',
    etapas: [
      {
        dia: 1, nome: 'Boas-vindas',
        mensagem: 'Olá {nome}! Vi que você pegou o Existe Vida Após o Fim. Esse é um material muito poderoso para quem está num momento de reconstrução. Estou aqui se precisar de apoio 🤝',
      },
      {
        dia: 3, nome: 'Verificar experiência',
        mensagem: 'E aí {nome}, como está sendo o processo? O Existe Vida Após o Fim costuma gerar reflexões importantes. Como você está se sentindo?',
      },
      {
        dia: 7, nome: 'Primeira apresentação',
        mensagem: '{nome}, muitos homens que passaram pelo Existe Vida usaram o Conduta Masculina como o próximo passo — para não só superar, mas se tornar uma versão muito melhor. É a reconstrução completa. Faz sentido pra você?',
      },
      {
        dia: 14, nome: 'Follow-up + prova social',
        mensagem: 'Oi {nome}! Passando para ver como você está. Homens que combinaram o Existe Vida com o Conduta Masculina descrevem como renasceram de vez. É um processo poderoso. Quer que eu te conte mais?',
      },
      {
        dia: 21, nome: 'Ângulo diferente + urgência',
        mensagem: '{nome}, a reconstrução tem etapas. O Existe Vida te dá clareza. O Conduta Masculina te dá identidade e direção. Juntos, são transformadores. Ainda está aberto para novos alunos 👊',
      },
      {
        dia: 30, nome: 'Última tentativa',
        mensagem: '{nome}, última mensagem por aqui. Sua jornada de reconstrução merece continuar com tudo. Quando estiver pronto para o próximo nível, o Conduta Masculina vai estar aqui esperando. Força 💪',
      },
    ],
  },
  {
    nome: 'Workshop Inabalável → Conduta Masculina',
    produto_entrada_nome: 'Workshop Inabalável',
    cor: '#F59E0B',
    etapas: [
      {
        dia: 1, nome: 'Boas-vindas',
        mensagem: 'Olá {nome}! Seja bem-vindo ao Inabalável! Esse workshop vai te dar uma base sólida. Qualquer dúvida durante o processo, é só chamar 💪',
      },
      {
        dia: 3, nome: 'Verificar experiência',
        mensagem: 'E aí {nome}, como está sendo o Workshop Inabalável? Já conseguiu aplicar alguma coisa no dia a dia?',
      },
      {
        dia: 7, nome: 'Primeira apresentação',
        mensagem: '{nome}, o Inabalável te dá a mentalidade. O Conduta Masculina te dá a estrutura completa para aplicar isso em todas as áreas da sua vida — relacionamentos, liderança, propósito. São programas que se completam perfeitamente. Quer saber mais?',
      },
      {
        dia: 14, nome: 'Follow-up + prova social',
        mensagem: 'Oi {nome}! Como você está aplicando o Inabalável? Homens que combinaram ele com o Conduta Masculina relatam que a mentalidade do workshop ganhou um novo nível de profundidade. Posso te contar como funciona?',
      },
      {
        dia: 21, nome: 'Ângulo diferente + urgência',
        mensagem: '{nome}, ser inabalável é o começo. O Conduta Masculina é onde você constrói o homem completo — com método, consistência e resultado real. Ainda tem vagas 👊',
      },
      {
        dia: 30, nome: 'Última tentativa',
        mensagem: '{nome}, última vez por aqui. A base que você construiu no Inabalável merece uma estrutura à altura. Quando sentir que é a hora, o Conduta Masculina vai estar aqui. Valeu pela jornada 🤝',
      },
    ],
  },
  {
    nome: 'Masterclass Atraente → Conduta Masculina',
    produto_entrada_nome: 'Masterclass Atraente',
    cor: '#3B82F6',
    etapas: [
      {
        dia: 1, nome: 'Boas-vindas',
        mensagem: 'Olá {nome}! Vi que você entrou para a Masterclass Atraente. Esse é um passo importante na sua jornada. Qualquer dúvida, estou aqui 👊',
      },
      {
        dia: 3, nome: 'Verificar experiência',
        mensagem: 'E aí {nome}, como está sendo a Masterclass? Algum insight que te marcou até agora?',
      },
      {
        dia: 7, nome: 'Primeira apresentação',
        mensagem: '{nome}, o que você está aprendendo na Masterclass é a base. O Conduta Masculina é onde homens como você aplicam isso de forma completa e estruturada — com um programa desenhado para transformação real. Posso te mostrar como funciona?',
      },
      {
        dia: 14, nome: 'Follow-up + prova social',
        mensagem: 'Oi {nome}! Como está sendo sua experiência com a Masterclass? Tenho visto alunos que combinaram ela com o Conduta Masculina e o resultado foi muito além do esperado. Quer saber mais?',
      },
      {
        dia: 21, nome: 'Ângulo diferente + urgência',
        mensagem: '{nome}, a Masterclass te deu a visão. O Conduta Masculina te dá o mapa completo. É a diferença entre saber o que mudar e saber exatamente como mudar. Ainda dá tempo 💪',
      },
      {
        dia: 30, nome: 'Última tentativa',
        mensagem: '{nome}, última mensagem por aqui. Quando você sentir que está pronto para o programa mais completo de desenvolvimento masculino que existe, o Conduta vai estar aqui. Abraço 🤝',
      },
    ],
  },
  {
    nome: 'Não Mais Cara Bonzinho → Conduta Masculina',
    produto_entrada_nome: 'Desafio Não Mais do Cara Bonzinho',
    cor: '#EC4899',
    etapas: [
      {
        dia: 1, nome: 'Boas-vindas',
        mensagem: 'Olá {nome}! Bem-vindo ao Desafio Não Mais do Cara Bonzinho! Esse desafio vai mudar a forma como você age e se posiciona. Estou aqui para te apoiar nessa jornada 💪',
      },
      {
        dia: 3, nome: 'Verificar experiência',
        mensagem: 'E aí {nome}, como está sendo o desafio? Já sentiu alguma mudança na forma como você responde às situações?',
      },
      {
        dia: 7, nome: 'Primeira apresentação',
        mensagem: '{nome}, o Desafio te tira do modo passivo. O Conduta Masculina é o próximo nível — onde você constrói uma identidade masculina sólida de vez. Quem fez os dois diz que foi a combinação perfeita. Posso te contar mais?',
      },
      {
        dia: 14, nome: 'Follow-up + prova social',
        mensagem: 'Oi {nome}! Como você está aplicando o que aprendeu no Desafio? Homens que avançaram para o Conduta Masculina relatam que finalmente pararam de ceder e começaram a liderar. É o passo natural 👊',
      },
      {
        dia: 21, nome: 'Ângulo diferente + urgência',
        mensagem: '{nome}, parar de ser o cara bonzinho é o começo. Construir um caráter masculino completo é o próximo passo. O Conduta Masculina é exatamente isso — com método e resultado comprovado. Ainda dá tempo de entrar 💪',
      },
      {
        dia: 30, nome: 'Última tentativa',
        mensagem: '{nome}, última mensagem por aqui. A transformação que você começou no Desafio merece continuar. Quando estiver pronto para o programa completo, o Conduta Masculina vai estar aqui esperando. Força 🤝',
      },
    ],
  },
]

// ── Trilhas de REATIVAÇÃO ──────────────────────────────────────────────────

const TRILHAS_REATIVACAO: TrilhaInput[] = [
  {
    nome: 'Reativação - Workshop/Masterclass/Desafio',
    cor: '#F97316',
    tipo_pipeline: 'reativacao',
    etapas: [
      {
        dia: 1, nome: 'Reabertura',
        mensagem: 'Oi {nome}! Tudo bem? Faz um tempo que a gente não se fala. Vi que você passou pelo {produto} e queria saber como foi sua experiência com o conteúdo 🤝',
      },
      {
        dia: 7, nome: 'Diagnóstico',
        mensagem: '{nome}, você chegou a aplicar alguma coisa do {produto} no dia a dia? Pergunto porque dependendo de onde você está, tenho algo que pode ser o próximo passo certo pra você.',
      },
      {
        dia: 14, nome: 'Convite suave',
        mensagem: '{nome}, tenho acompanhado homens que fizeram o {produto} e depois avançaram para o Conduta Masculina — e o salto foi enorme. É um programa completo de desenvolvimento masculino. Posso te contar mais sobre ele?',
      },
      {
        dia: 21, nome: 'Última tentativa',
        mensagem: '{nome}, última mensagem por aqui. Se um dia você quiser dar o próximo passo na sua jornada, o Conduta Masculina vai estar aqui. Qualquer coisa é só chamar. Abraço 🤝',
      },
    ],
  },
  {
    nome: 'Reativação - Livros',
    cor: '#8B5CF6',
    tipo_pipeline: 'reativacao',
    etapas: [
      {
        dia: 1, nome: 'Reabertura',
        mensagem: 'Oi {nome}! Tudo bem? Vi aqui que você tem o {produto} e queria saber se você chegou a ler. Como foi? 📖',
      },
      {
        dia: 10, nome: 'Diagnóstico',
        mensagem: '{nome}, pergunta rápida: o {produto} te ajudou de alguma forma prática? Dependendo da sua resposta, tenho uma indicação que pode fazer muito sentido pra você agora.',
      },
      {
        dia: 20, nome: 'Convite suave',
        mensagem: '{nome}, homens que leram o {produto} e avançaram para o Conduta Masculina dizem que foi a combinação mais transformadora que já fizeram. Um complementa o outro de forma única. Posso te contar como funciona?',
      },
      {
        dia: 30, nome: 'Última tentativa',
        mensagem: '{nome}, não quero tomar mais seu tempo. Mas se um dia você sentir que é hora de ir além e ter um programa completo de desenvolvimento, o Conduta Masculina vai estar aqui. Abraço 💪',
      },
    ],
  },
  {
    nome: 'Reativação - Múltiplos Produtos',
    cor: '#EF4444',
    tipo_pipeline: 'reativacao',
    etapas: [
      {
        dia: 1, nome: 'Reabertura VIP',
        mensagem: 'Oi {nome}! Tudo bem? Vi aqui que você tem vários dos nossos materiais — isso mostra que você leva seu desenvolvimento a sério. Queria entender como está sendo sua jornada 🙏',
      },
      {
        dia: 5, nome: 'Diagnóstico direto',
        mensagem: '{nome}, você que já passou por mais de um dos nossos conteúdos está bem posicionado para o próximo nível. O Conduta Masculina foi feito exatamente para quem chegou onde você chegou. Posso te apresentar?',
      },
      {
        dia: 12, nome: 'Oferta direta',
        mensagem: '{nome}, vou ser direto: quem tem o perfil que você tem — que investiu em mais de um conteúdo — é exatamente quem mais aproveita o Conduta Masculina. Posso te mandar mais detalhes?',
      },
      {
        dia: 20, nome: 'Última tentativa',
        mensagem: '{nome}, última mensagem. Quando sentir que é a hora de consolidar tudo que você já aprendeu num programa completo, o Conduta vai estar aqui. 💪',
      },
    ],
  },
  {
    nome: 'Reativação - Order Bump',
    cor: '#6B7280',
    tipo_pipeline: 'reativacao',
    etapas: [
      {
        dia: 1, nome: 'Reabertura leve',
        mensagem: 'Oi {nome}! Tudo bem? Vi que você pegou o {produto} e queria saber se teve a chance de acessar o conteúdo 😊',
      },
      {
        dia: 14, nome: 'Apresentação',
        mensagem: '{nome}, para quem tem o {produto}, o próximo passo natural seria o Conduta Masculina — um programa completo que aprofunda tudo isso. Você teria interesse em saber mais?',
      },
      {
        dia: 28, nome: 'Última tentativa',
        mensagem: '{nome}, última mensagem por aqui. Se quiser dar um próximo passo mais completo na sua jornada, o Conduta Masculina vai estar aqui. Abraço 🤝',
      },
    ],
  },
]

// ── Runner ─────────────────────────────────────────────────────────────────

async function criarTrilha(
  trilha: TrilhaInput,
  destinoId: string | null
): Promise<boolean> {
  const existente = await queryOne<{ id: string }>(
    `SELECT id FROM trilhas_cadencia WHERE nome = $1`, [trilha.nome]
  )
  if (existente) {
    console.log(`[Seed] Trilha já existe, pulando: "${trilha.nome}"`)
    return false
  }

  let entradaId: string | null = null
  if (trilha.produto_entrada_nome) {
    const entrada = await queryOne<{ id: string }>(`
      SELECT id FROM produtos WHERE nome ILIKE $1 LIMIT 1
    `, [`%${trilha.produto_entrada_nome}%`])
    if (!entrada) {
      console.warn(`[Seed] Produto de entrada não encontrado: "${trilha.produto_entrada_nome}" — criada sem vínculo`)
    }
    entradaId = entrada?.id ?? null
  }

  const novaTrilha = await queryOne<{ id: string }>(`
    INSERT INTO trilhas_cadencia (nome, produto_entrada_id, produto_destino_id, cor, tipo_pipeline)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id
  `, [trilha.nome, entradaId, destinoId, trilha.cor, trilha.tipo_pipeline ?? 'ativo'])

  if (!novaTrilha) {
    console.error(`[Seed] Falha ao criar trilha: "${trilha.nome}"`)
    return false
  }

  for (let i = 0; i < trilha.etapas.length; i++) {
    const etapa = trilha.etapas[i]
    await pool.query(`
      INSERT INTO etapas_cadencia (trilha_id, numero_etapa, nome, dia_envio, mensagem_whatsapp, ordem)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [novaTrilha.id, i + 1, etapa.nome, etapa.dia, etapa.mensagem, i])
  }

  console.log(`[Seed] Trilha criada: "${trilha.nome}" (${trilha.etapas.length} etapas | pipeline: ${trilha.tipo_pipeline ?? 'ativo'})`)
  return true
}

async function seed() {
  console.log('[Seed] Iniciando seed de trilhas de cadência...')

  const destino = await queryOne<{ id: string }>(`
    SELECT id FROM produtos WHERE nome ILIKE '%Conduta Masculina%' LIMIT 1
  `)
  if (!destino) {
    console.warn('[Seed] Produto "Conduta Masculina" não encontrado.')
  }

  let criadas = 0
  let puladas = 0

  for (const trilha of [...TRILHAS, ...TRILHAS_REATIVACAO]) {
    const criada = await criarTrilha(trilha, destino?.id ?? null)
    if (criada) criadas++
    else puladas++
  }

  console.log(`\n[Seed] Concluído — criadas: ${criadas} | puladas: ${puladas}`)
  await pool.end()
}

seed().catch(err => {
  console.error('[Seed] Erro:', err)
  process.exit(1)
})
