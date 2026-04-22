-- =============================================================================
-- CRM Infoprodutos - Pipelines: Fluxo Ativo + Reativação
-- =============================================================================

-- Tipo de pipeline nas trilhas
ALTER TABLE trilhas_cadencia
  ADD COLUMN IF NOT EXISTS tipo_pipeline VARCHAR(20) DEFAULT 'ativo'
    CHECK (tipo_pipeline IN ('ativo', 'reativacao'));

-- Tipo de pipeline em cada inscrição
ALTER TABLE clientes_trilha
  ADD COLUMN IF NOT EXISTS tipo_pipeline VARCHAR(20) DEFAULT 'ativo';

-- Fila priorizada de reativação (~9.000 leads antigos)
CREATE TABLE IF NOT EXISTS fila_reativacao (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id              UUID REFERENCES clientes(id) UNIQUE,
  produto_principal_comprado VARCHAR(255),
  tipo_produto            VARCHAR(50),
  -- livro | workshop | masterclass | desafio | order_bump | multiplos
  dias_desde_compra       INTEGER,
  score_prioridade        INTEGER DEFAULT 0,
  status                  VARCHAR(50) DEFAULT 'aguardando',
  -- aguardando | em_cadencia | convertido | descartado
  data_entrada_fila       TIMESTAMPTZ DEFAULT NOW(),
  data_inicio_cadencia    TIMESTAMPTZ,
  created_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fila_reativacao_score  ON fila_reativacao(score_prioridade DESC);
CREATE INDEX IF NOT EXISTS idx_fila_reativacao_status ON fila_reativacao(status);

-- Configs comerciais (inserção segura — não sobrescreve se já existir)
INSERT INTO configuracoes (chave, valor) VALUES
  ('limite_fluxo_ativo',    '30'),
  ('limite_reativacao_diaria', '15'),
  ('dias_lead_antigo',      '30')
ON CONFLICT (chave) DO NOTHING;
