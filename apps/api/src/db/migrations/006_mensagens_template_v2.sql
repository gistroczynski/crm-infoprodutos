-- Adiciona colunas que faltavam na mensagens_template
ALTER TABLE mensagens_template
  ADD COLUMN IF NOT EXISTS contexto    VARCHAR(100)  NOT NULL DEFAULT 'geral',
  ADD COLUMN IF NOT EXISTS is_sistema  BOOLEAN       NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS updated_at  TIMESTAMPTZ            DEFAULT NOW();

-- Seed de templates padrão do sistema
INSERT INTO mensagens_template (nome, contexto, texto, is_sistema, ativa) VALUES

('Boas-vindas — Lista Diária',
 'lista_diaria',
 'Olá {nome}! 😊

Vi que você tem interesse em {produto} e queria dar um oi!

Posso te ajudar com alguma dúvida ou apresentar o que temos disponível?

Estou à disposição!',
 true, true),

('Acompanhamento — Sem Order Bump',
 'sem_order_bump',
 'Oi {nome}! Tudo bem? 👋

Percebi que você está aproveitando {produto} — ótima escolha!

Temos um complemento especial que combina muito bem com o que você já tem. Posso te apresentar rapidinho?',
 true, true),

('Ascensão — Sem Upsell',
 'sem_upsell',
 'Olá {nome}! 🌟

Você já está há {dias} dias conosco e deve estar vendo bons resultados com {produto}.

Tenho uma oportunidade que pode potencializar ainda mais sua jornada. Posso te contar sobre ela?',
 true, true),

('Reativação — Lead Antigo',
 'reativacao',
 'Oi {nome}! Quanto tempo! 😊

Faz um tempo que não nos falamos. Como estão os resultados com {produto}?

Tenho novidades que acho que vão te interessar. Posso compartilhar?',
 true, true),

('Follow-up — Sem resposta',
 'geral',
 'Oi {nome}, tudo bem? 🙂

Só passando para saber se recebeu minha mensagem anterior sobre {produto}.

Sem compromisso — só quero garantir que você tem todas as informações que precisa!',
 true, true)

ON CONFLICT DO NOTHING;
