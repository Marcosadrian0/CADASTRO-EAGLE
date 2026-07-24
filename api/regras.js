/**
 * EAGLE Cadastro — /api/regras
 * Regras de preenchimento customizadas por gatilho de texto.
 *
 * GET    ?token=...                 → lista todas as regras ativas
 * POST   { token, descricao, gatilho, acoes }  → cria regra
 * DELETE { token, id }             → remove regra
 * PATCH  { token, id, ativo }      → ativa/desativa
 */

import { neon } from '@neondatabase/serverless';
import { ipBloqueado } from './_ipGuard.js';

export const config = { maxDuration: 15 };

async function initDB(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS regras_custom (
      id         SERIAL PRIMARY KEY,
      descricao  TEXT NOT NULL,
      gatilho    TEXT NOT NULL,
      acoes      JSONB NOT NULL DEFAULT '[]',
      ativo      BOOLEAN NOT NULL DEFAULT TRUE,
      criado_em  TIMESTAMPTZ DEFAULT NOW(),
      criado_por INTEGER
    )
  `;
}

async function validarToken(sql, token) {
  if (!token) return null;
  const [sess] = await sql`
    SELECT usuario_id FROM sessoes WHERE token = ${token} AND expira_em > NOW()
  `;
  return sess ? sess.usuario_id : null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (ipBloqueado(req, res)) return;

  const DB = process.env.DATABASE_URL;
  if (!DB) return res.status(500).json({ error: 'DATABASE_URL não configurada.' });

  try {
    const sql = neon(DB);
    await initDB(sql);

    if (req.method === 'GET') {
      const { token } = req.query;
      const uid = await validarToken(sql, token);
      if (!uid) return res.status(401).json({ error: 'Sessão inválida.' });

      const regras = await sql`
        SELECT id, descricao, gatilho, acoes, ativo, criado_em
        FROM regras_custom
        ORDER BY criado_em DESC
      `;
      return res.status(200).json(regras);
    }

    if (req.method === 'POST') {
      const { token, descricao, gatilho, acoes } = req.body || {};
      const uid = await validarToken(sql, token);
      if (!uid) return res.status(401).json({ error: 'Sessão inválida.' });
      if (!descricao || !gatilho || !Array.isArray(acoes) || acoes.length === 0) {
        return res.status(400).json({ error: 'descricao, gatilho e acoes são obrigatórios.' });
      }
      const [row] = await sql`
        INSERT INTO regras_custom (descricao, gatilho, acoes, criado_por)
        VALUES (${descricao}, ${gatilho}, ${JSON.stringify(acoes)}, ${uid})
        RETURNING id
      `;
      return res.status(200).json({ id: row.id });
    }

    if (req.method === 'DELETE') {
      const { token, id } = req.body || {};
      const uid = await validarToken(sql, token);
      if (!uid) return res.status(401).json({ error: 'Sessão inválida.' });
      if (!id) return res.status(400).json({ error: 'id obrigatório.' });
      await sql`DELETE FROM regras_custom WHERE id = ${id}`;
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'PATCH') {
      const { token, id, ativo } = req.body || {};
      const uid = await validarToken(sql, token);
      if (!uid) return res.status(401).json({ error: 'Sessão inválida.' });
      if (!id) return res.status(400).json({ error: 'id obrigatório.' });
      await sql`UPDATE regras_custom SET ativo = ${!!ativo} WHERE id = ${id}`;
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Método não permitido' });
  } catch (err) {
    console.error('[EAGLE regras] erro:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
