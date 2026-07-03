/**
 * EAGLE Cadastro — /api/salvar
 * Salva um processo analisado no banco Neon Postgres.
 */

import { neon } from '@neondatabase/serverless';
import { ipBloqueado } from './_ipGuard.js';

export const config = { maxDuration: 30 };

async function initDB(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS processos (
      id           SERIAL PRIMARY KEY,
      npu          TEXT,
      arquivo_nome TEXT,
      data_upload  TIMESTAMPTZ DEFAULT NOW(),
      campos       JSONB NOT NULL DEFAULT '{}',
      status       TEXT DEFAULT 'pendente',
      usuario_id   INTEGER REFERENCES usuarios(id) ON DELETE SET NULL
    )
  `;
  // migração: adiciona coluna se ainda não existir
  await sql`
    ALTER TABLE processos ADD COLUMN IF NOT EXISTS usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS validacoes (
      id             SERIAL PRIMARY KEY,
      processo_id    INTEGER REFERENCES processos(id) ON DELETE CASCADE,
      campo          TEXT NOT NULL,
      valor_extraido TEXT,
      valor_correto  TEXT,
      acertou        BOOLEAN NOT NULL,
      data_validacao TIMESTAMPTZ DEFAULT NOW()
    )
  `;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (ipBloqueado(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  const DB = process.env.DATABASE_URL;
  if (!DB) return res.status(500).json({ error: 'DATABASE_URL não configurada.' });

  try {
    const sql = neon(DB);
    await initDB(sql);

    const { arquivo_nome, campos, token } = req.body || {};
    const npu = campos?.npu || null;

    // resolve usuario_id a partir do token de sessão
    let usuarioId = null;
    if (token) {
      const [sess] = await sql`
        SELECT usuario_id FROM sessoes WHERE token = ${token} AND expira_em > NOW()
      `;
      if (sess) usuarioId = sess.usuario_id;
    }

    const result = await sql`
      INSERT INTO processos (npu, arquivo_nome, campos, usuario_id)
      VALUES (${npu}, ${arquivo_nome || null}, ${JSON.stringify(campos || {})}, ${usuarioId})
      RETURNING id
    `;

    return res.status(200).json({ id: result[0].id });
  } catch (err) {
    console.error('[EAGLE DB] salvar:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
