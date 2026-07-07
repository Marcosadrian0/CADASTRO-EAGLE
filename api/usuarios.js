/**
 * EAGLE Cadastro — /api/usuarios
 * GET  ?token=...              => lista todos os usuários (admin)
 * POST { token, ...dados }     => cria usuário (admin)
 * PUT  { token, id, ...dados } => atualiza usuário (admin)
 * DELETE { token, id }         => desativa usuário (admin)
 */

import { neon } from '@neondatabase/serverless';
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { ipBloqueado } from './_ipGuard.js';

export const config = { maxDuration: 30 };

function gerarSalt() {
  return randomBytes(16).toString('hex');
}

function hashSenha(senha, salt) {
  return pbkdf2Sync(senha, salt, 100000, 32, 'sha256').toString('hex');
}

async function validarAdmin(sql, token) {
  if (!token) return null;
  const [row] = await sql`
    SELECT u.id, u.perfil FROM sessoes s
    JOIN usuarios u ON u.id = s.usuario_id
    WHERE s.token = ${token} AND s.expira_em > NOW() AND u.ativo = true AND u.perfil = 'admin'
  `;
  return row || null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (ipBloqueado(req, res)) return;

  const DB = process.env.DATABASE_URL;
  if (!DB) return res.status(500).json({ error: 'DATABASE_URL não configurada.' });

  const sql = neon(DB);
  await sql`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS senha_salt TEXT`;
  const token = req.query.token || req.body?.token;
  const admin = await validarAdmin(sql, token);
  if (!admin) return res.status(403).json({ error: 'Acesso negado. Apenas administradores.' });

  if (req.method === 'GET') {
    const rows = await sql`
      SELECT id, usuario, nome, perfil, abas, ativo, criado_em FROM usuarios ORDER BY id
    `;
    return res.status(200).json(rows);
  }

  if (req.method === 'POST') {
    const { usuario, senha, nome, perfil = 'operador', abas = 'analise' } = req.body || {};
    if (!usuario || !senha || !nome) return res.status(400).json({ error: 'usuario, senha e nome são obrigatórios.' });
    const salt = gerarSalt();
    const hash = hashSenha(senha, salt);
    try {
      const [row] = await sql`
        INSERT INTO usuarios (usuario, senha_hash, senha_salt, nome, perfil, abas)
        VALUES (${usuario}, ${hash}, ${salt}, ${nome}, ${perfil}, ${abas})
        RETURNING id
      `;
      return res.status(201).json({ id: row.id });
    } catch (err) {
      if (err.message.includes('unique')) return res.status(409).json({ error: 'Usuário já existe.' });
      throw err;
    }
  }

  if (req.method === 'PUT') {
    const { id, nome, perfil, abas, senha, ativo } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id obrigatório.' });
    if (senha) {
      const salt = gerarSalt();
      const hash = hashSenha(senha, salt);
      await sql`UPDATE usuarios SET senha_hash = ${hash}, senha_salt = ${salt} WHERE id = ${id}`;
    }
    if (nome !== undefined) await sql`UPDATE usuarios SET nome = ${nome} WHERE id = ${id}`;
    if (perfil !== undefined) await sql`UPDATE usuarios SET perfil = ${perfil} WHERE id = ${id}`;
    if (abas !== undefined) await sql`UPDATE usuarios SET abas = ${abas} WHERE id = ${id}`;
    if (ativo !== undefined) await sql`UPDATE usuarios SET ativo = ${ativo} WHERE id = ${id}`;
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'DELETE') {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id obrigatório.' });
    if (id === admin.id) return res.status(400).json({ error: 'Não é possível remover o próprio usuário.' });
    await sql`UPDATE usuarios SET ativo = false WHERE id = ${id}`;
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Método não permitido' });
}
