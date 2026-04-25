-- Adiciona valor_liquido (valor que o produtor recebe após taxas da Hotmart)
-- e moeda (BRL/USD) para suportar separação de faturamento por moeda.
ALTER TABLE compras ADD COLUMN IF NOT EXISTS valor_liquido DECIMAL(10,2);
ALTER TABLE compras ADD COLUMN IF NOT EXISTS moeda VARCHAR(10) DEFAULT 'BRL';

-- Compras do CSV já contêm o valor líquido (o produtor informa o que recebeu)
UPDATE compras SET valor_liquido = valor WHERE hotmart_transaction_id IS NULL;
