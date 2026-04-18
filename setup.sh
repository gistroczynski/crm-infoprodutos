#!/usr/bin/env bash
# ── setup.sh — Configuração inicial do CRM Infoprodutos ─────────────────────
set -e

BOLD="\033[1m"
GREEN="\033[0;32m"
YELLOW="\033[0;33m"
RED="\033[0;31m"
RESET="\033[0m"

info()    { echo -e "${GREEN}[✓]${RESET} $1"; }
warn()    { echo -e "${YELLOW}[!]${RESET} $1"; }
error()   { echo -e "${RED}[✗]${RESET} $1"; exit 1; }
section() { echo -e "\n${BOLD}── $1 ──${RESET}"; }

echo -e "${BOLD}CRM Infoprodutos — Setup${RESET}"
echo "────────────────────────────────────"

# ── 1. Verificar Node.js ──────────────────────────────────────────────────

section "Verificando pré-requisitos"

NODE_VERSION=$(node --version 2>/dev/null | sed 's/v//' | cut -d. -f1)
if [[ -z "$NODE_VERSION" ]]; then
  error "Node.js não encontrado. Instale o Node.js 18+ em https://nodejs.org"
fi
if [[ "$NODE_VERSION" -lt 18 ]]; then
  error "Node.js 18+ é necessário. Versão atual: $(node --version)"
fi
info "Node.js $(node --version)"

# npm
if ! command -v npm &>/dev/null; then
  error "npm não encontrado."
fi
info "npm $(npm --version)"

# ── 2. Instalar dependências ──────────────────────────────────────────────

section "Instalando dependências"
npm install
info "Dependências instaladas"

# ── 3. Configurar variáveis de ambiente ───────────────────────────────────

section "Configurando variáveis de ambiente"

ENV_FILE="apps/api/.env"
ENV_EXAMPLE="apps/api/.env.example"

if [[ ! -f "$ENV_FILE" ]]; then
  if [[ -f "$ENV_EXAMPLE" ]]; then
    cp "$ENV_EXAMPLE" "$ENV_FILE"
    warn "Arquivo $ENV_FILE criado a partir do exemplo."
    warn "Edite $ENV_FILE com suas credenciais antes de continuar."
  else
    cat > "$ENV_FILE" <<'EOF'
# ── Banco de dados ────────────────────────────────────────────────────────
DATABASE_URL=postgresql://user:password@localhost:5432/crm_infoprodutos

# ── Hotmart OAuth2 ────────────────────────────────────────────────────────
# Obtenha em: painel Hotmart → Ferramentas → Credenciais
HOTMART_CLIENT_ID=
HOTMART_CLIENT_SECRET=
HOTMART_BASIC=

# ── Servidor ──────────────────────────────────────────────────────────────
PORT=3001
EOF
    warn "Arquivo $ENV_FILE criado com valores de exemplo."
    warn "Edite $ENV_FILE com suas credenciais antes de continuar."
  fi
else
  info "$ENV_FILE já existe."
fi

# ── 4. Verificar conexão com banco ────────────────────────────────────────

section "Verificando banco de dados"

if [[ -z "${DATABASE_URL}" ]]; then
  # Tenta carregar do .env
  if [[ -f "$ENV_FILE" ]]; then
    export $(grep -v '^#' "$ENV_FILE" | grep DATABASE_URL | xargs) 2>/dev/null || true
  fi
fi

if [[ -z "${DATABASE_URL}" ]]; then
  warn "DATABASE_URL não configurado em $ENV_FILE — pulando verificação do banco."
else
  if command -v psql &>/dev/null; then
    if psql "$DATABASE_URL" -c "SELECT 1" &>/dev/null 2>&1; then
      info "Conexão com o banco de dados OK"
    else
      warn "Não foi possível conectar ao banco. Verifique DATABASE_URL em $ENV_FILE"
    fi
  else
    warn "psql não encontrado — pulando verificação de conectividade do banco."
  fi
fi

# ── 5. Próximos passos ────────────────────────────────────────────────────

section "Tudo pronto!"

echo ""
echo -e "  ${BOLD}Próximos passos:${RESET}"
echo ""
echo -e "  1. Edite ${YELLOW}apps/api/.env${RESET} com suas credenciais"
echo -e "  2. Execute as migrations: ${YELLOW}psql \$DATABASE_URL < apps/api/sql/schema.sql${RESET}"
echo -e "  3. Inicie o servidor:     ${YELLOW}npm run dev${RESET}"
echo -e "  4. Acesse o frontend:     ${YELLOW}http://localhost:5173${RESET}"
echo -e "  5. Configure o webhook no painel Hotmart apontando para:"
echo -e "     ${YELLOW}http://localhost:3001/api/webhook${RESET} (dev)"
echo ""
echo -e "  Documentação completa: ${YELLOW}README.md${RESET}"
echo ""
