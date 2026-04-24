/**
 * Seed: cria os dois usuários iniciais do CRM.
 * Execute: npm run seed:usuarios
 */
import dotenv from 'dotenv'
dotenv.config({ path: '../../.env' })
dotenv.config()

import bcrypt from 'bcryptjs'
import { pool, queryOne } from './index'

const USUARIOS = [
  { nome: 'Comercial', email: 'comercial@ogc.com', senha: 'comercial123', perfil: 'comercial' },
  { nome: 'Admin',     email: 'admin@ogc.com',     senha: 'admin123',     perfil: 'admin'     },
] as const

async function seed() {
  console.log('[Seed] Criando usuários iniciais...')
  for (const u of USUARIOS) {
    const existente = await queryOne('SELECT id FROM usuarios WHERE email = $1', [u.email])
    if (existente) {
      console.log(`[Seed] Usuário já existe: ${u.email}`)
      continue
    }
    const hash = await bcrypt.hash(u.senha, 10)
    await pool.query(
      'INSERT INTO usuarios (nome, email, senha_hash, perfil) VALUES ($1, $2, $3, $4)',
      [u.nome, u.email, hash, u.perfil]
    )
    console.log(`[Seed] Usuário criado: ${u.email} (perfil: ${u.perfil})`)
  }
  console.log('[Seed] Concluído.')
  await pool.end()
}

seed().catch(err => { console.error(err); process.exit(1) })
