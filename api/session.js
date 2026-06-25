/**
 * EAGLE Cadastro — /api/session
 * GET /api/session?token=... => { nome, perfil, abas } ou 401
 */

import { neon } from '@neondatabase/serverless';

export const config = { maxDuration: 15 };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método não permitido' });

  const DB = process.env.DATABASE_URL;
  if (!DB) return res.status(500).json({ error: 'DATABASE_URL não configurada.' });

  const token = req.query.token;
  if (!token) return res.status(401).json({ error: 'Token ausente.' });

  const sql = neon(DB);
  try {
    const [row] = await sql`
      SELECT u.nome, u.perfil, u.abas
      FROM sessoes s
      JOIN usuarios u ON u.id = s.usuario_id
      WHERE s.token = ${token} AND s.expira_em > NOW() AND u.ativo = true
    `;
    if (!row) return res.status(401).json({ error: 'Sessão inválida ou expirada.' });
    return res.status(200).json({
      nome: row.nome,
      perfil: row.perfil,
      abas: row.abas.split(',').map(s => s.trim()),
    });
  } catch (err) {
    return res.status(401).json({ error: 'Sessão inválida.' });
  }
}
