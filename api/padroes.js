/**
 * EAGLE Cadastro — /api/padroes
 * Persiste padrões aprendidos no banco Neon Postgres.
 *
 * GET  ?token=...                              → lista todos os padrões
 * POST { token, campo, padrao, tipo, descricao } → insere ou atualiza padrão
 * DELETE { token, id }                         → remove padrão pelo id
 */

import { neon } from '@neondatabase/serverless';
import { ipBloqueado } from './_ipGuard.js';

export const config = { maxDuration: 15 };

async function initDB(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS padroes_aprendidos (
      id           SERIAL PRIMARY KEY,
      campo        TEXT NOT NULL,
      padrao       TEXT NOT NULL,
      tipo         TEXT NOT NULL DEFAULT 'regex',
      descricao    TEXT,
      contador_uso INTEGER DEFAULT 0,
      criado_em    TIMESTAMPTZ DEFAULT NOW()
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
  // ── CORS ──────────────────────────────────────────────────────────────────
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (ipBloqueado(req, res)) return;

  const DB = process.env.DATABASE_URL;
  if (!DB) return res.status(500).json({ error: 'DATABASE_URL não configurada.' });

  try {
    const sql = neon(DB);
    await initDB(sql);

    // ── GET ───────────────────────────────────────────────────────────────
    if (req.method === 'GET') {
      const token = req.query?.token;
      const usuarioId = await validarToken(sql, token);
      if (!usuarioId) return res.status(401).json({ error: 'Token inválido ou expirado.' });

      const padroes = await sql`
        SELECT id, campo, padrao, tipo, descricao, contador_uso, criado_em
        FROM padroes_aprendidos
        ORDER BY criado_em DESC
      `;
      return res.status(200).json(padroes);
    }

    // ── POST ──────────────────────────────────────────────────────────────
    if (req.method === 'POST') {
      const { token, campo, padrao, tipo, descricao } = req.body || {};
      const usuarioId = await validarToken(sql, token);
      if (!usuarioId) return res.status(401).json({ error: 'Token inválido ou expirado.' });

      if (!campo || !padrao) {
        return res.status(400).json({ error: 'Parâmetros campo e padrao são obrigatórios.' });
      }

      const [row] = await sql`
        INSERT INTO padroes_aprendidos (campo, padrao, tipo, descricao)
        VALUES (${campo}, ${padrao}, ${tipo || 'regex'}, ${descricao || null})
        ON CONFLICT (campo, padrao)
          DO UPDATE SET
            tipo      = EXCLUDED.tipo,
            descricao = EXCLUDED.descricao,
            contador_uso = padroes_aprendidos.contador_uso + 1
        RETURNING id
      `;
      return res.status(200).json({ id: row.id });
    }

    // ── DELETE ────────────────────────────────────────────────────────────
    if (req.method === 'DELETE') {
      const { token, id } = req.body || {};
      const usuarioId = await validarToken(sql, token);
      if (!usuarioId) return res.status(401).json({ error: 'Token inválido ou expirado.' });

      if (!id) return res.status(400).json({ error: 'Parâmetro id é obrigatório.' });

      await sql`DELETE FROM padroes_aprendidos WHERE id = ${id}`;
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Método não permitido' });
  } catch (err) {
    console.error('[EAGLE padroes] erro:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
