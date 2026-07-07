/**
 * EAGLE Cadastro — /api/validar
 * Salva o feedback campo-a-campo do usuário para aprendizado.
 */

import { neon } from '@neondatabase/serverless';
import { ipBloqueado } from './_ipGuard.js';

export const config = { maxDuration: 30 };

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
    await sql`ALTER TABLE processos ADD COLUMN IF NOT EXISTS concluido_em TIMESTAMPTZ`;
    const { processo_id, validacoes } = req.body || {};

    if (!processo_id || !Array.isArray(validacoes)) {
      return res.status(400).json({ error: 'processo_id e validacoes são obrigatórios.' });
    }

    for (const v of validacoes) {
      await sql`
        INSERT INTO validacoes (processo_id, campo, valor_extraido, valor_correto, acertou)
        VALUES (
          ${processo_id},
          ${v.campo},
          ${v.valor_extraido || null},
          ${v.valor_correto || null},
          ${v.acertou}
        )
        ON CONFLICT DO NOTHING
      `;
    }

    await sql`
      UPDATE processos SET status = 'validado', concluido_em = NOW() WHERE id = ${processo_id}
    `;

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[EAGLE DB] validar:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
