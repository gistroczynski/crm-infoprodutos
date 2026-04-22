-- =============================================================================
-- CRM Infoprodutos - Trilhas de Cadência
-- =============================================================================

CREATE TABLE IF NOT EXISTS trilhas_cadencia (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome              VARCHAR(255) NOT NULL,
  descricao         TEXT,
  produto_entrada_id UUID REFERENCES produtos(id),
  produto_destino_id UUID REFERENCES produtos(id),
  ativa             BOOLEAN DEFAULT true,
  cor               VARCHAR(20) DEFAULT '#3B82F6',
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS etapas_cadencia (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trilha_id      UUID REFERENCES trilhas_cadencia(id) ON DELETE CASCADE,
  numero_etapa   INTEGER NOT NULL,
  nome           VARCHAR(255) NOT NULL,
  dia_envio      INTEGER NOT NULL,
  mensagem_whatsapp TEXT NOT NULL,
  objetivo       VARCHAR(255),
  ativa          BOOLEAN DEFAULT true,
  ordem          INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS clientes_trilha (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id          UUID REFERENCES clientes(id),
  trilha_id           UUID REFERENCES trilhas_cadencia(id),
  etapa_atual         INTEGER DEFAULT 1,
  data_entrada        TIMESTAMPTZ DEFAULT NOW(),
  data_proxima_etapa  TIMESTAMPTZ,
  status              VARCHAR(50) DEFAULT 'ativo',
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(cliente_id, trilha_id)
);

CREATE TABLE IF NOT EXISTS historico_cadencia (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_trilha_id UUID REFERENCES clientes_trilha(id),
  etapa_id         UUID REFERENCES etapas_cadencia(id),
  status_contato   VARCHAR(50),
  observacao       TEXT,
  data_contato     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clientes_trilha_proxima ON clientes_trilha(data_proxima_etapa);
CREATE INDEX IF NOT EXISTS idx_clientes_trilha_status  ON clientes_trilha(status);
CREATE INDEX IF NOT EXISTS idx_etapas_trilha_numero    ON etapas_cadencia(trilha_id, numero_etapa);
