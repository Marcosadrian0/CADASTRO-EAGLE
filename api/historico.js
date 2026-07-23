/**
 * EAGLE Cadastro — /api/historico
 * Retorna lista de processos e estatísticas de acurácia por campo.
 */

import { neon } from '@neondatabase/serverless';
import { ipBloqueado } from './_ipGuard.js';

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (ipBloqueado(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método não permitido' });

  const DB = process.env.DATABASE_URL;
  if (!DB) return res.status(500).json({ error: 'DATABASE_URL não configurada.' });

  try {
    const sql = neon(DB);

    const [processos, stats, erros, acuraciaEvolucao, acuraciaFields, acuraciaOperadores, tiposDocumento] = await Promise.all([
      sql`
        SELECT p.id, p.npu, p.arquivo_nome, p.data_upload, p.status, u.nome AS usuario_nome,
               p.campos->>'tipo_documento' AS tipo_documento
        FROM processos p
        LEFT JOIN usuarios u ON u.id = p.usuario_id
        WHERE p.status = 'validado'
        ORDER BY p.data_upload DESC
        LIMIT 500
      `,
      sql`
        SELECT campo, COUNT(*)::int AS total,
          SUM(CASE WHEN acertou THEN 1 ELSE 0 END)::int AS acertos,
          ROUND(100.0 * SUM(CASE WHEN acertou THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0))::int AS pct
        FROM validacoes GROUP BY campo ORDER BY pct ASC
      `,
      sql`
        SELECT campo, valor_extraido, valor_correto, COUNT(*)::int AS ocorrencias
        FROM validacoes
        WHERE acertou = false AND valor_correto IS NOT NULL AND valor_correto <> ''
        GROUP BY campo, valor_extraido, valor_correto
        ORDER BY ocorrencias DESC LIMIT 30
      `,
      sql`
        SELECT TO_CHAR(DATE_TRUNC('week', data_validacao), 'DD/MM') AS semana,
          COUNT(*)::int AS total,
          SUM(CASE WHEN acertou THEN 1 ELSE 0 END)::int AS acertos,
          ROUND(100.0 * SUM(CASE WHEN acertou THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0))::int AS pct
        FROM validacoes WHERE data_validacao > NOW() - INTERVAL '8 weeks'
        GROUP BY DATE_TRUNC('week', data_validacao) ORDER BY DATE_TRUNC('week', data_validacao)
      `,
      sql`
        SELECT campo, COUNT(*)::int AS total,
          SUM(CASE WHEN acertou THEN 1 ELSE 0 END)::int AS acertos,
          ROUND(100.0 * SUM(CASE WHEN acertou THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0))::int AS pct
        FROM validacoes WHERE data_validacao > NOW() - INTERVAL '30 days'
        GROUP BY campo ORDER BY pct ASC LIMIT 8
      `,
      sql`
        SELECT u.nome AS operador,
          COUNT(DISTINCT p.id)::int AS total_processos,
          COUNT(v.id)::int AS total_validacoes,
          SUM(CASE WHEN v.acertou THEN 1 ELSE 0 END)::int AS acertos,
          ROUND(100.0 * SUM(CASE WHEN v.acertou THEN 1 ELSE 0 END) / NULLIF(COUNT(v.id), 0))::int AS pct
        FROM processos p
        JOIN usuarios u ON u.id = p.usuario_id
        LEFT JOIN validacoes v ON v.processo_id = p.id
        WHERE p.status = 'validado'
        GROUP BY u.nome ORDER BY pct DESC NULLS LAST
      `,
      sql`
        SELECT COALESCE(campos->>'tipo_documento', 'Não identificado') AS tipo,
          COUNT(*)::int AS total
        FROM processos WHERE status = 'validado'
        GROUP BY campos->>'tipo_documento' ORDER BY total DESC
      `
    ]);

    return res.status(200).json({ processos, stats, erros, acuraciaEvolucao, acuraciaFields, acuraciaOperadores, tiposDocumento });
  } catch (err) {
    console.error('[EAGLE DB] historico:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
