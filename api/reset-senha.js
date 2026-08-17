/**
 * EAGLE Cadastro — /api/reset-senha
 * Redefine a senha de um usuário pelo nome.
 * Protegido por IP (VPN) e por variável de ambiente RESET_SECRET.
 *
 * POST { secret, usuario, nova_senha }
 *   => { ok: true } ou { error: "..." }
 *
 * Uso temporário para recuperação de acesso. Remova ou desative
 * a variável RESET_SECRET no Vercel após o uso.
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

  const RESET_SECRET = process.env.RESET_SECRET;
  if (!RESET_SECRET) return res.status(503).json({ error: 'Endpoint desativado.' });

  const DB = process.env.DATABASE_URL;
  if (!DB) return res.status(500).json({ error: 'DATABASE_URL não configurada.' });

  const { secret, usuario, nova_senha } = req.body || {};

  if (!secret || secret !== RESET_SECRET) {
    return res.status(403).json({ error: 'Secret inválido.' });
  }
  if (!usuario || !nova_senha) {
    return res.status(400).json({ error: 'usuario e nova_senha são obrigatórios.' });
  }
  if (nova_senha.length < 4) {
    return res.status(400).json({ error: 'Senha deve ter ao menos 4 caracteres.' });
  }

  try {
    const sql = neon(DB);
    const [user] = await sql`SELECT id FROM usuarios WHERE LOWER(usuario) = LOWER(${usuario})`;
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });

    const salt = randomBytes(16).toString('hex');
    const hash = hashSenha(nova_senha, salt);
    await sql`UPDATE usuarios SET senha_hash = ${hash}, senha_salt = ${salt}, ativo = true WHERE id = ${user.id}`;

    console.warn('[EAGLE] reset-senha executado para:', usuario);
    return res.status(200).json({ ok: true, mensagem: `Senha de "${usuario}" redefinida com sucesso.` });
  } catch (err) {
    console.error('[EAGLE reset-senha]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
