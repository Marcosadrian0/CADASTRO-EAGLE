/**
 * EAGLE Cadastro — /api/buscar-npu
 * Busca campos do último processo validado com determinado NPU.
 */
import { neon } from '@neondatabase/serverless';
import { ipBloqueado } from './_ipGuard.js';

export const config = { maxDuration: 15 };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (ipBloqueado(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método não permitido' });

  const DB = process.env.DATABASE_URL;
  if (!DB) return res.status(500).json({ error: 'DATABASE_URL não configurada.' });

  const { npu, token } = req.query;
  if (!npu) return res.status(400).json({ error: 'npu obrigatório.' });

  const sql = neon(DB);

  // Verificar sessão
  const [sess] = await sql`SELECT usuario_id FROM sessoes WHERE token = ${token} AND expira_em > NOW()`;
  if (!sess) return res.status(403).json({ error: 'Sessão inválida.' });

  try {
    const [proc] = await sql`
      SELECT campos, data_upload, status FROM processos
      WHERE npu = ${npu} AND status = 'validado'
      ORDER BY data_upload DESC LIMIT 1
    `;
    if (!proc) return res.status(404).json({ found: false });
    return res.status(200).json({ found: true, campos: proc.campos, data_upload: proc.data_upload });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
