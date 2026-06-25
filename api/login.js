/**
 * EAGLE Cadastro — /api/login
 * POST { usuario, senha } => { token, nome, perfil, abas }
 * DELETE { token } => logout
 * Seeds admin on first call if users table is empty.
 */

import { neon } from '@neondatabase/serverless';
import { randomBytes, pbkdf2Sync } from 'node:crypto';

export const config = { maxDuration: 30 };

function hashSenha(senha) {
  const salt = 'eagle_sbk_2026';
  return pbkdf2Sync(senha, salt, 100000, 32, 'sha256').toString('hex');
}

async function initDB(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS usuarios (
      id         SERIAL PRIMARY KEY,
      usuario    TEXT UNIQUE NOT NULL,
      senha_hash TEXT NOT NULL,
      nome       TEXT NOT NULL,
      perfil     TEXT NOT NULL DEFAULT 'operador',
      abas       TEXT NOT NULL DEFAULT 'analise',
      ativo      BOOLEAN NOT NULL DEFAULT true,
      criado_em  TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS sessoes (
      token      TEXT PRIMARY KEY,
      usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
      expira_em  TIMESTAMPTZ NOT NULL,
      criado_em  TIMESTAMPTZ DEFAULT NOW()
    )
  `;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const DB = process.env.DATABASE_URL;
  if (!DB) return res.status(500).json({ error: 'DATABASE_URL não configurada.' });

  try {
    const sql = neon(DB);
    await initDB(sql);

    // Seed admin se tabela vazia
    const rows0 = await sql`SELECT COUNT(*)::int AS count FROM usuarios`;
    if (rows0[0].count === 0) {
      const hash = hashSenha('1234');
      await sql`
        INSERT INTO usuarios (usuario, senha_hash, nome, perfil, abas)
        VALUES ('marcos.oliveira', ${hash}, 'Marcos Oliveira', 'admin', 'analise,acuracia,usuarios')
      `;
    }

    // DELETE — logout
    if (req.method === 'DELETE') {
      const { token } = req.body || {};
      if (token) await sql`DELETE FROM sessoes WHERE token = ${token}`;
      return res.status(200).json({ ok: true });
    }

    // POST — login
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

    const { usuario, senha } = req.body || {};
    if (!usuario || !senha) return res.status(400).json({ error: 'Usuário e senha obrigatórios.' });

    const hash = hashSenha(senha);
    const rows = await sql`
      SELECT id, nome, perfil, abas FROM usuarios
      WHERE usuario = ${usuario} AND senha_hash = ${hash} AND ativo = true
    `;
    const user = rows[0];
    if (!user) return res.status(401).json({ error: 'Usuário ou senha incorretos.' });

    await sql`DELETE FROM sessoes WHERE usuario_id = ${user.id} AND expira_em < NOW()`;

    const token = randomBytes(32).toString('hex');
    const expira = new Date(Date.now() + 8 * 60 * 60 * 1000);
    await sql`
      INSERT INTO sessoes (token, usuario_id, expira_em) VALUES (${token}, ${user.id}, ${expira})
    `;

    return res.status(200).json({
      token,
      nome: user.nome,
      perfil: user.perfil,
      abas: user.abas.split(',').map(s => s.trim()),
    });
  } catch (err) {
    console.error('[EAGLE login]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
