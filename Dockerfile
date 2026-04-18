FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
COPY apps/api/package*.json ./apps/api/
COPY packages/shared/package*.json ./packages/shared/

RUN npm install

COPY . .

RUN npm run build --workspace=apps/api

EXPOSE 3001

CMD ["node", "apps/api/dist/index.js"]
