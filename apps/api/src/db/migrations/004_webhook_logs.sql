-- =============================================================================
-- Webhook logs — rastreia todos os eventos recebidos pelo endpoint /hotmart
-- =============================================================================

CREATE TABLE IF NOT EXISTS webhook_logs (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  evento     VARCHAR(100),
  payload    JSONB,
  processado BOOLEAN     DEFAULT false,
  erro       TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_logs_created ON webhook_logs(created_at DESC);
