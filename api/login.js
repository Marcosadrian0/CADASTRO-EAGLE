/**
 * EAGLE Cadastro — /api/login
 * POST { usuario, senha } => { token, nome, perfil, abas, trocar_senha? }
 * DELETE { token } => logout
 *
 * Senha padrão "1234": aceita independente da senha atual, reseta a conta
 * como provisória e retorna trocar_senha:true. O frontend exibe modal de
 * troca obrigatória antes de liberar o acesso.
 */

import { neon } from '@neondatabase/serverless';
import { randomBytes, pbkdf2Sync } from 'node:crypto';
import { ipBloqueado } from './_ipGuard.js';

export const config = { maxDuration: 30 };

function hashSenha(senha, salt) {
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
  await sql`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS senha_salt TEXT`;
  await sql`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS senha_provisoria BOOLEAN DEFAULT false`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (ipBloqueado(req, res)) return;

  const DB = process.env.DATABASE_URL;
  if (!DB) return res.status(500).json({ error: 'DATABASE_URL não configurada.' });

  try {
    const sql = neon(DB);
    await initDB(sql);

    // Seed: cria admin padrão se tabela vazia
    const [{ count }] = await sql`SELECT COUNT(*)::int AS count FROM usuarios`;
    if (count === 0) {
      const seedSalt = randomBytes(16).toString('hex');
      const hash = hashSenha('1234', seedSalt);
      await sql`
        INSERT INTO usuarios (usuario, senha_hash, senha_salt, senha_provisoria, nome, perfil, abas)
        VALUES ('marcos.oliveira', ${hash}, ${seedSalt}, true, 'Marcos Oliveira', 'admin', 'analise,acuracia,faturamento,usuarios')
      `;
    }

    // PATCH — troca de senha
    if (req.method === 'PATCH') {
      const { token, nova_senha } = req.body || {};
      if (!token) return res.status(401).json({ error: 'Token obrigatório.' });
      if (!nova_senha || nova_senha.length < 4) return res.status(400).json({ error: 'A nova senha deve ter ao menos 4 caracteres.' });
      if (nova_senha === '1234') return res.status(400).json({ error: 'Escolha uma senha diferente da padrão.' });
      const [sess] = await sql`SELECT usuario_id FROM sessoes WHERE token = ${token} AND expira_em > NOW()`;
      if (!sess) return res.status(401).json({ error: 'Sessão inválida.' });
      const salt = randomBytes(16).toString('hex');
      const hash = hashSenha(nova_senha, salt);
      await sql`UPDATE usuarios SET senha_hash = ${hash}, senha_salt = ${salt}, senha_provisoria = false WHERE id = ${sess.usuario_id}`;
      return res.status(200).json({ ok: true });
    }

    // DELETE — logout
    if (req.method === 'DELETE') {
      const { token } = req.body || {};
      if (token) await sql`DELETE FROM sessoes WHERE token = ${token}`;
      return res.status(200).json({ ok: true });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

    const { usuario, senha } = req.body || {};
    if (!usuario || !senha) return res.status(400).json({ error: 'Usuário e senha obrigatórios.' });

    const [user] = await sql`
      SELECT id, senha_hash, senha_salt, senha_provisoria, nome, perfil, abas
      FROM usuarios
      WHERE LOWER(usuario) = LOWER(${usuario}) AND ativo = true
    `;
    if (!user) return res.status(401).json({ error: 'Credenciais inválidas.' });

    if (senha === '1234') {
      // Senha padrão: aceita sempre — reseta como provisória para forçar troca
      const novoSalt = randomBytes(16).toString('hex');
      const novoHash = hashSenha('1234', novoSalt);
      await sql`
        UPDATE usuarios SET senha_hash = ${novoHash}, senha_salt = ${novoSalt}, senha_provisoria = true
        WHERE id = ${user.id}
      `;
      user.senha_provisoria = true;
    } else {
      // Verificação normal
      if (!user.senha_salt) return res.status(401).json({ error: 'Credenciais inválidas.' });
      const hash = hashSenha(senha, user.senha_salt);
      if (hash !== user.senha_hash) return res.status(401).json({ error: 'Credenciais inválidas.' });
    }

    // Garante que admin tenha a aba faturamento
    if (user.perfil === 'admin' && !user.abas.split(',').map(s => s.trim()).includes('faturamento')) {
      const novasAbas = user.abas + ',faturamento';
      await sql`UPDATE usuarios SET abas = ${novasAbas} WHERE id = ${user.id}`;
      user.abas = novasAbas;
    }

    await sql`DELETE FROM sessoes WHERE usuario_id = ${user.id} AND expira_em < NOW()`;
    const token = randomBytes(32).toString('hex');
    const expira = new Date(Date.now() + 8 * 60 * 60 * 1000);
    await sql`INSERT INTO sessoes (token, usuario_id, expira_em) VALUES (${token}, ${user.id}, ${expira})`;

    return res.status(200).json({
      token,
      nome: user.nome,
      perfil: user.perfil,
      abas: user.abas.split(',').map(s => s.trim()),
      trocar_senha: user.senha_provisoria === true,
    });
  } catch (err) {
    console.error('[EAGLE login]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
