-- Migration 009: delay de 40 dias para livros físicos no Fluxo Ativo

-- 1. Adiciona coluna entrega_fisica na tabela produtos
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS entrega_fisica BOOLEAN DEFAULT false;

-- 2. Marca livros físicos conhecidos
UPDATE produtos SET entrega_fisica = true
WHERE nome ILIKE '%totalmente generoso%'
   OR nome ILIKE '%fraqueza masculina%'
   OR nome ILIKE '%existe vida após%'
   OR nome ILIKE '%existe vida apos%';

-- 3. Atualiza mensagem da Etapa 1 das trilhas de livros físicos para refletir D+40
UPDATE etapas_cadencia ec
SET mensagem_whatsapp = CASE
  WHEN pe.nome ILIKE '%totalmente generoso%' THEN
    'Oi {nome}! Tudo bem? Você deve ter recebido o Totalmente Generoso faz um tempo. Conseguiu ler? Queria saber o que você achou 📖'
  WHEN pe.nome ILIKE '%fraqueza masculina%' THEN
    'Oi {nome}! Você deve ter recebido A Fraqueza Masculina faz um tempo. Como foi a leitura? Alguma parte que te marcou? 📖'
  WHEN pe.nome ILIKE '%existe vida%' THEN
    'Oi {nome}! Você deve ter recebido o Existe Vida Após o Fim faz um tempo. Como está sendo a leitura? Esse é um conteúdo muito poderoso 🙏'
  ELSE ec.mensagem_whatsapp
END,
nome = CASE
  WHEN pe.entrega_fisica = true THEN 'Acompanhamento D+40'
  ELSE ec.nome
END
FROM trilhas_cadencia t
JOIN produtos pe ON pe.id = t.produto_entrada_id
WHERE ec.trilha_id = t.id
  AND ec.numero_etapa = 1
  AND ec.ativa = true
  AND pe.entrega_fisica = true;

-- 4. Adia data_proxima_etapa para clientes já inscritos na Etapa 1 de trilhas de livros físicos
--    que ainda não chegaram ao D+40 contado desde a compra
UPDATE clientes_trilha ct
SET data_proxima_etapa = (
  SELECT MIN(c.data_compra) + INTERVAL '40 days'
  FROM compras c
  JOIN trilhas_cadencia t ON t.id = ct.trilha_id
  WHERE c.cliente_id = ct.cliente_id
    AND c.produto_id = t.produto_entrada_id
)
WHERE ct.etapa_atual = 1
  AND ct.status = 'ativo'
  AND (ct.tipo_pipeline = 'ativo' OR ct.tipo_pipeline IS NULL)
  AND EXISTS (
    SELECT 1 FROM trilhas_cadencia t
    JOIN produtos p ON p.id = t.produto_entrada_id
    WHERE t.id = ct.trilha_id
      AND p.entrega_fisica = true
  )
  AND ct.data_proxima_etapa < NOW() + INTERVAL '40 days';
