/**
 * EAGLE Cadastro — /api/backup
 * Exporta todos os processos com seus campos como JSON (admin).
 */

import { neon } from '@neondatabase/serverless';
import { ipBloqueado } from './_ipGuard.js';

export const config = { maxDuration: 30 };

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
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (ipBloqueado(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método não permitido' });

  const DB = process.env.DATABASE_URL;
  if (!DB) return res.status(500).json({ error: 'DATABASE_URL não configurada.' });

  const sql = neon(DB);
  const token = req.query.token;
  const admin = await validarAdmin(sql, token);
  if (!admin) return res.status(403).json({ error: 'Acesso negado. Apenas administradores.' });

  try {
    const processos = await sql`
      SELECT
        p.id, p.npu, p.arquivo_nome, p.data_upload, p.status,
        p.campos,
        u.nome AS usuario_nome
      FROM processos p
      LEFT JOIN usuarios u ON u.id = p.usuario_id
      ORDER BY p.data_upload DESC
    `;

    const validacoes = await sql`
      SELECT processo_id, campo, valor_extraido, valor_correto, acertou, data_validacao
      FROM validacoes
      ORDER BY processo_id, campo
    `;

    const validacoesPorProcesso = {};
    for (const v of validacoes) {
      if (!validacoesPorProcesso[v.processo_id]) validacoesPorProcesso[v.processo_id] = [];
      validacoesPorProcesso[v.processo_id].push({
        campo: v.campo,
        valor_extraido: v.valor_extraido,
        valor_correto: v.valor_correto,
        acertou: v.acertou,
        data_validacao: v.data_validacao,
      });
    }

    const backup = processos.map(p => ({
      id: p.id,
      npu: p.npu,
      arquivo_nome: p.arquivo_nome,
      data_upload: p.data_upload,
      status: p.status,
      usuario_nome: p.usuario_nome,
      campos: p.campos,
      validacoes: validacoesPorProcesso[p.id] || [],
    }));

    const agora = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Disposition', `attachment; filename="eagle-backup-${agora}.json"`);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(200).send(JSON.stringify({ exportado_em: new Date().toISOString(), total: backup.length, processos: backup }, null, 2));
  } catch (err) {
    console.error('[EAGLE DB] backup:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
