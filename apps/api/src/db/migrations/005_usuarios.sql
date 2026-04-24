-- =============================================================================
-- Usuários do CRM com perfis comercial e admin
-- =============================================================================

CREATE TABLE IF NOT EXISTS usuarios (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  nome       VARCHAR(255) NOT NULL,
  email      VARCHAR(255) UNIQUE NOT NULL,
  senha_hash VARCHAR(255) NOT NULL,
  perfil     VARCHAR(20)  CHECK (perfil IN ('comercial', 'admin')),
  ativo      BOOLEAN      DEFAULT true,
  created_at TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_usuarios_email ON usuarios(email);
