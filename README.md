# CRM Infoprodutos

Sistema de CRM para gestão de clientes e vendas integrado com a Hotmart. Permite acompanhar a jornada do cliente (Entrada → Order Bump → Upsell), gerar listas diárias de contato priorizadas por score, visualizar relatórios de performance e sincronizar automaticamente com a API Hotmart.

## Tecnologias

| Camada   | Stack                                      |
|----------|--------------------------------------------|
| API      | Node.js 18 + Express + TypeScript          |
| Frontend | React 18 + Vite + Tailwind CSS + Recharts  |
| Banco    | PostgreSQL (Supabase ou auto-hospedado)    |
| Integração | Hotmart OAuth2 + Webhooks               |

## Pré-requisitos

- Node.js 18+
- npm 9+
- PostgreSQL 14+ (ou conta no Supabase)
- Conta Hotmart com acesso à API

## Configuração rápida

```bash
# 1. Clone e entre na pasta
git clone <repo-url> crm-infoprodutos
cd crm-infoprodutos

# 2. Instale as dependências
npm install

# 3. Configure o ambiente da API
cp apps/api/.env.example apps/api/.env
# Edite apps/api/.env com suas credenciais

# 4. Execute as migrations
psql $DATABASE_URL < apps/api/sql/schema.sql

# 5. Inicie o servidor de desenvolvimento
npm run dev
```

Ou use o script automatizado:
```bash
bash setup.sh
```

## Variáveis de ambiente (apps/api/.env)

| Variável                | Obrigatória | Descrição                                      |
|-------------------------|-------------|------------------------------------------------|
| `DATABASE_URL`          | Sim         | Connection string PostgreSQL (`postgresql://user:pass@host:5432/db`) |
| `HOTMART_CLIENT_ID`     | Não*        | Client ID da aplicação Hotmart                 |
| `HOTMART_CLIENT_SECRET` | Não*        | Client Secret da aplicação Hotmart             |
| `HOTMART_BASIC`         | Não*        | Token Basic para OAuth2 Hotmart (`base64(id:secret)`) |
| `PORT`                  | Não         | Porta da API (padrão: `3001`)                  |
| `VITE_API_URL`          | Não         | URL da API para o frontend (padrão: `http://localhost:3001`) |

*Necessário para sincronização com a Hotmart.

## Deploy em produção

### Backend — Railway

1. Conecte o repositório no [Railway](https://railway.app)
2. Crie um serviço apontando para `apps/api`
3. Configure as variáveis de ambiente
4. O Railway detecta automaticamente o `package.json` e usa `npm run build && npm start`

### Frontend — Vercel

1. Importe o repositório no [Vercel](https://vercel.com)
2. Configure **Root Directory** como `apps/web`
3. Adicione a variável de ambiente `VITE_API_URL` apontando para a URL da sua API no Railway
4. Deploy automático a cada push

### Configuração do Webhook Hotmart

1. No painel Hotmart: **Ferramentas → Webhooks → Novo webhook**
2. URL: `https://sua-api.railway.app/api/webhook`
3. Eventos: `PURCHASE_COMPLETE`, `PURCHASE_APPROVED`
4. Salve e teste o webhook

## Desenvolvimento

```bash
npm run dev          # Inicia API (porta 3001) + Frontend (porta 5173) simultaneamente
npm run dev:api      # Apenas API
npm run dev:web      # Apenas Frontend
npm run build        # Build de produção (ambos)
```

## Estrutura do projeto

```
crm-infoprodutos/
├── apps/
│   ├── api/                 # Express API
│   │   ├── src/
│   │   │   ├── routes/      # Endpoints REST
│   │   │   ├── jobs/        # Jobs (sync Hotmart, geração lista)
│   │   │   ├── services/    # Lógica de negócio
│   │   │   ├── middleware/  # Auth, validação, erros
│   │   │   └── db/          # Queries SQL
│   │   └── sql/             # Migrations
│   └── web/                 # React SPA
│       └── src/
│           ├── pages/       # Telas
│           ├── components/  # Componentes reutilizáveis
│           ├── hooks/       # React hooks
│           ├── services/    # Chamadas API
│           └── lib/         # Utilitários
└── packages/
    └── shared/              # Tipos compartilhados (TS)
```
