/**
 * EAGLE Cadastro — /api/datajud
 * Proxy serverless para a API Pública do DataJud CNJ.
 * Recebe { npu, tribunal } e repassa o resultado do CNJ.
 */

import { ipBloqueado } from './_ipGuard.js';

export const config = { maxDuration: 15 };

const DATAJUD_KEY_FALLBACK =
  'cDZHYzlZa0JadVREZDJCendFbGFDZzo2MDExMTcxMWIzYmFiOTBhMTVkNTg=';

const TRIBUNAIS_PERMITIDOS = new Set([
  'tjac','tjal','tjam','tjap','tjba','tjce','tjdft','tjes','tjgo',
  'tjma','tjmg','tjms','tjmt','tjpa','tjpb','tjpe','tjpi','tjpr',
  'tjrj','tjrn','tjro','tjrr','tjrs','tjsc','tjse','tjsp','tjto',
  'trf1','trf2','trf3','trf4','trf5','trf6',
  'tst','trt1','trt2','trt3','trt4','trt5','trt6','trt7','trt8',
  'trt9','trt10','trt11','trt12','trt13','trt14','trt15','trt16',
  'trt17','trt18','trt19','trt20','trt21','trt22','trt23','trt24',
  'stj','stf','tse','tsmil','stm',
]);

export default async function handler(req, res) {
  // ── CORS ──────────────────────────────────────────────────────────────────
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (ipBloqueado(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  const { npu, tribunal } = req.body || {};

  if (!npu || !tribunal) {
    return res.status(400).json({ error: 'Parâmetros npu e tribunal são obrigatórios.' });
  }

  const tribunalNorm = String(tribunal).toLowerCase().trim();
  if (!TRIBUNAIS_PERMITIDOS.has(tribunalNorm)) {
    return res.status(400).json({ error: `Tribunal não reconhecido: ${tribunal}` });
  }

  const apiKey = process.env.DATAJUD_API_KEY || DATAJUD_KEY_FALLBACK;
  const url = `https://api-publica.datajud.cnj.jus.br/api_publica_${tribunalNorm}/_search`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `ApiKey ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: {
          match: { numeroProcesso: npu },
        },
      }),
    });

    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (err) {
    console.error('[EAGLE DataJud] erro:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
