/**
 * EAGLE Cadastro — /api/trocar-senha
 * POST { token, nova_senha }
 * Troca a própria senha e remove o flag de senha provisória.
 */

import { neon } from '@neondatabase/serverless';
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { ipBloqueado } from './_ipGuard.js';

export const config = { maxDuration: 30 };

function hashSenha(senha, salt) {
  return pbkdf2Sync(senha, salt, 100000, 32, 'sha256').toString('hex');
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

  const { token, nova_senha } = req.body || {};
  if (!token) return res.status(401).json({ error: 'Token obrigatório.' });
  if (!nova_senha || nova_senha.length < 4) {
    return res.status(400).json({ error: 'A nova senha deve ter ao menos 4 caracteres.' });
  }
  if (nova_senha === '1234') {
    return res.status(400).json({ error: 'Escolha uma senha diferente da padrão.' });
  }

  try {
    const sql = neon(DB);
    const [sess] = await sql`
      SELECT usuario_id FROM sessoes WHERE token = ${token} AND expira_em > NOW()
    `;
    if (!sess) return res.status(401).json({ error: 'Sessão inválida.' });

    const salt = randomBytes(16).toString('hex');
    const hash = hashSenha(nova_senha, salt);
    await sql`
      UPDATE usuarios
      SET senha_hash = ${hash}, senha_salt = ${salt}, senha_provisoria = false
      WHERE id = ${sess.usuario_id}
    `;

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[EAGLE trocar-senha]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
