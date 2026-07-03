/**
 * EAGLE Cadastro — /api/historico
 * Retorna lista de processos e estatísticas de acurácia por campo.
 */

import { neon } from '@neondatabase/serverless';

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método não permitido' });

  const DB = process.env.DATABASE_URL;
  if (!DB) return res.status(500).json({ error: 'DATABASE_URL não configurada.' });

  try {
    const sql = neon(DB);

    const processos = await sql`
      SELECT p.id, p.npu, p.arquivo_nome, p.data_upload, p.status, u.nome AS usuario_nome
      FROM processos p
      LEFT JOIN usuarios u ON u.id = p.usuario_id
      ORDER BY p.data_upload DESC
      LIMIT 100
    `;

    const stats = await sql`
      SELECT
        campo,
        COUNT(*)::int                                         AS total,
        SUM(CASE WHEN acertou THEN 1 ELSE 0 END)::int        AS acertos,
        ROUND(
          100.0 * SUM(CASE WHEN acertou THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0)
        )::int                                                AS pct
      FROM validacoes
      GROUP BY campo
      ORDER BY pct ASC
    `;

    const erros = await sql`
      SELECT campo, valor_extraido, valor_correto, COUNT(*)::int AS ocorrencias
      FROM validacoes
      WHERE acertou = false AND valor_correto IS NOT NULL AND valor_correto <> ''
      GROUP BY campo, valor_extraido, valor_correto
      ORDER BY ocorrencias DESC
      LIMIT 30
    `;

    const acuraciaEvolucao = await sql`
      SELECT
        TO_CHAR(DATE_TRUNC('week', data_validacao), 'DD/MM') AS semana,
        COUNT(*)::int AS total,
        SUM(CASE WHEN acertou THEN 1 ELSE 0 END)::int AS acertos,
        ROUND(100.0 * SUM(CASE WHEN acertou THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0))::int AS pct
      FROM validacoes
      WHERE data_validacao > NOW() - INTERVAL '8 weeks'
      GROUP BY DATE_TRUNC('week', data_validacao)
      ORDER BY DATE_TRUNC('week', data_validacao)
    `;

    const acuraciaFields = await sql`
      SELECT campo,
        COUNT(*)::int AS total,
        SUM(CASE WHEN acertou THEN 1 ELSE 0 END)::int AS acertos,
        ROUND(100.0 * SUM(CASE WHEN acertou THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0))::int AS pct
      FROM validacoes
      WHERE data_validacao > NOW() - INTERVAL '30 days'
      GROUP BY campo
      ORDER BY pct ASC
      LIMIT 8
    `;

    return res.status(200).json({ processos, stats, erros, acuraciaEvolucao, acuraciaFields });
  } catch (err) {
    console.error('[EAGLE DB] historico:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
