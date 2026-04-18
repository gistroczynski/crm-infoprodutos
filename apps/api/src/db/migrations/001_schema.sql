-- =============================================================================
-- CRM Infoprodutos - Schema inicial
-- Executar no Supabase SQL Editor ou via psql
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- -----------------------------------------------------------------------------
-- PRODUTOS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS produtos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotmart_id VARCHAR(100) UNIQUE,
  nome VARCHAR(255) NOT NULL,
  tipo VARCHAR(50) CHECK (tipo IN ('entrada', 'order_bump', 'upsell', 'principal')),
  preco DECIMAL(10,2),
  ativo BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- CLIENTES
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clientes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotmart_id VARCHAR(100) UNIQUE,
  nome VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  telefone_raw VARCHAR(50),
  telefone_formatado VARCHAR(20),
  telefone_valido BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- COMPRAS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS compras (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotmart_transaction_id VARCHAR(100) UNIQUE,
  cliente_id UUID REFERENCES clientes(id),
  produto_id UUID REFERENCES produtos(id),
  valor DECIMAL(10,2),
  status VARCHAR(50),
  data_compra TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- LEAD SCORES
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lead_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id UUID REFERENCES clientes(id) UNIQUE,
  score INTEGER DEFAULT 0 CHECK (score >= 0 AND score <= 100),
  prioridade VARCHAR(20) CHECK (prioridade IN ('alta', 'media', 'baixa')),
  motivos JSONB DEFAULT '[]',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- STATUS CLIENTES
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS status_clientes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id UUID REFERENCES clientes(id) UNIQUE,
  status VARCHAR(50) CHECK (status IN ('novo', 'nutricao', 'pronto', 'inativo')),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- REGRAS DE PRIORIZAÇÃO
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS regras_priorizacao (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome VARCHAR(255) NOT NULL,
  descricao TEXT,
  condicao_tipo VARCHAR(100) NOT NULL,
  condicao_valor JSONB,
  pontos INTEGER NOT NULL,
  ativa BOOLEAN DEFAULT true,
  ordem INTEGER DEFAULT 0
);

-- -----------------------------------------------------------------------------
-- LISTA DIÁRIA
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lista_diaria (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  data DATE NOT NULL DEFAULT CURRENT_DATE,
  cliente_id UUID REFERENCES clientes(id),
  prioridade VARCHAR(20),
  score INTEGER,
  motivos JSONB,
  status_contato VARCHAR(50) DEFAULT 'pendente',
  contatado_em TIMESTAMPTZ,
  observacao TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(data, cliente_id)
);

-- -----------------------------------------------------------------------------
-- MENSAGENS TEMPLATE
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mensagens_template (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome VARCHAR(255) NOT NULL,
  produto_id UUID REFERENCES produtos(id),
  texto TEXT NOT NULL,
  ativa BOOLEAN DEFAULT true
);

-- -----------------------------------------------------------------------------
-- CONFIGURAÇÕES
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS configuracoes (
  chave VARCHAR(100) PRIMARY KEY,
  valor TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- ÍNDICES
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_compras_cliente ON compras(cliente_id);
CREATE INDEX IF NOT EXISTS idx_compras_data ON compras(data_compra);
CREATE INDEX IF NOT EXISTS idx_lista_diaria_data ON lista_diaria(data);
CREATE INDEX IF NOT EXISTS idx_lead_scores_score ON lead_scores(score DESC);

-- -----------------------------------------------------------------------------
-- REGRAS PADRÃO
-- -----------------------------------------------------------------------------
INSERT INTO regras_priorizacao (nome, descricao, condicao_tipo, condicao_valor, pontos, ordem) VALUES
('Compra recente (até 3 dias)', 'Cliente comprou nos últimos 3 dias', 'dias_desde_compra_max', '{"dias": 3}', 40, 1),
('Janela quente (7-14 dias)', 'Cliente comprou entre 7 e 14 dias atrás', 'dias_desde_compra_entre', '{"min": 7, "max": 14}', 20, 2),
('Múltiplos produtos', 'Cliente comprou 2 ou mais produtos', 'quantidade_compras_min', '{"quantidade": 2}', 30, 3),
('Sem produto principal', 'Cliente não tem o produto principal', 'sem_produto_tipo', '{"tipo": "principal"}', 25, 4),
('Acesso expirando (7 dias)', 'Acesso a produto expira em até 7 dias', 'acesso_expirando_dias', '{"dias": 7}', 30, 5),
('Inativo há muito tempo', 'Sem compra há mais de 90 dias', 'dias_desde_compra_min', '{"dias": 90}', -20, 6)
ON CONFLICT DO NOTHING;

-- -----------------------------------------------------------------------------
-- CONFIGURAÇÕES PADRÃO
-- -----------------------------------------------------------------------------
INSERT INTO configuracoes (chave, valor) VALUES
('limite_lista_diaria', '30'),
('score_alta_prioridade', '70'),
('score_media_prioridade', '40'),
('produto_principal_id', ''),
('ddi_padrao', '55')
ON CONFLICT (chave) DO NOTHING;
