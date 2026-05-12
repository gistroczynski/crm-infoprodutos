-- Migration 010: ajuste de clientes já inscritos e mensagens das trilhas de livros físicos

-- 1. Adia data_proxima_etapa para clientes em Etapa 1 de trilhas de livros físicos
--    que compraram há menos de 40 dias e ainda não foram contatados
UPDATE clientes_trilha ct
SET data_proxima_etapa = (
  SELECT c.data_compra + INTERVAL '40 days'
  FROM compras c
  JOIN trilhas_cadencia t ON t.id = ct.trilha_id
  WHERE c.cliente_id = ct.cliente_id
    AND c.produto_id = t.produto_entrada_id
  ORDER BY c.data_compra DESC
  LIMIT 1
)
WHERE ct.etapa_atual = 1
  AND ct.status = 'ativo'
  AND ct.tipo_pipeline = 'ativo'
  AND ct.data_proxima_etapa > NOW() - INTERVAL '40 days'
  AND EXISTS (
    SELECT 1 FROM trilhas_cadencia t
    JOIN produtos p ON p.id = t.produto_entrada_id
    WHERE t.id = ct.trilha_id
      AND p.entrega_fisica = true
  );

-- 2. Atualiza mensagem da Etapa 1 das trilhas de Totalmente Generoso
UPDATE etapas_cadencia ec
SET mensagem_whatsapp = 'Oi {nome}! Tudo bem? Você deve ter recebido o Totalmente Generoso faz um tempo. Conseguiu ler? Queria saber o que você achou 📖'
FROM trilhas_cadencia t
JOIN produtos pe ON pe.id = t.produto_entrada_id
WHERE ec.trilha_id = t.id
  AND ec.numero_etapa = 1
  AND ec.ativa = true
  AND (pe.nome ILIKE '%totalmente generoso%' OR pe.nome ILIKE '%implacável%' OR pe.nome ILIKE '%implacavel%');

-- 3. Atualiza mensagem da Etapa 1 das trilhas de Fraqueza Masculina
UPDATE etapas_cadencia ec
SET mensagem_whatsapp = 'Oi {nome}! Você deve ter recebido A Fraqueza Masculina faz um tempo. Como foi a leitura? Alguma parte que te marcou? 📖'
FROM trilhas_cadencia t
JOIN produtos pe ON pe.id = t.produto_entrada_id
WHERE ec.trilha_id = t.id
  AND ec.numero_etapa = 1
  AND ec.ativa = true
  AND pe.nome ILIKE '%fraqueza masculina%';
