/**
 * EAGLE Cadastro — API Serverless (Vercel)
 * Proxy seguro para a Anthropic API.
 * A ANTHROPIC_API_KEY fica APENAS nas variáveis de ambiente do Vercel,
 * nunca exposta no browser.
 */

import { ipBloqueado } from './_ipGuard.js';

export const config = { maxDuration: 60 };

// Rate limiting simples: máximo 10 req/min por IP
const _rateLimitMap = new Map();
function checarRateLimit(req) {
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  const agora = Date.now();
  const janela = 60_000; // 1 minuto
  const limite = 10;
  const entrada = _rateLimitMap.get(ip) || { count: 0, inicio: agora };
  if (agora - entrada.inicio > janela) {
    _rateLimitMap.set(ip, { count: 1, inicio: agora });
    return false;
  }
  if (entrada.count >= limite) return true; // bloqueado
  entrada.count++;
  _rateLimitMap.set(ip, entrada);
  return false;
}

export default async function handler(req, res) {
  // ── CORS ──────────────────────────────────────────────────────────────────
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (ipBloqueado(req, res)) return;
  if (checarRateLimit(req)) return res.status(429).json({ error: 'Muitas requisições. Aguarde um momento.' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  // ── API Key ────────────────────────────────────────────────────────────────
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY não configurada no Vercel.' });
  }

  const { tipo, pdf_b64, texto, instrucoes, prompt_aprendizado } = req.body || {};

  // ── Roteamento por tipo de chamada ─────────────────────────────────────────
  try {
    if (tipo === 'extrair_pdf' && pdf_b64 && instrucoes) {
      // Estratégia 1: PDF como documento base64
      return res.status(200).json(
        await chamarAnthropic(ANTHROPIC_KEY, {
          model: 'claude-sonnet-4-6',
          max_tokens: 2048,
          messages: [{
            role: 'user',
            content: [
              { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdf_b64 } },
              { type: 'text', text: instrucoes }
            ]
          }]
        }, true) // true = beta PDFs
      );
    }

    if (tipo === 'extrair_texto' && texto && instrucoes) {
      // Estratégia 2: texto puro (fallback)
      return res.status(200).json(
        await chamarAnthropic(ANTHROPIC_KEY, {
          model: 'claude-sonnet-4-6',
          max_tokens: 2048,
          messages: [{ role: 'user', content: instrucoes + '\n\nTEXTO:\n' + texto }]
        })
      );
    }

    if (tipo === 'aprender' && prompt_aprendizado) {
      // Aprendizado de padrões
      return res.status(200).json(
        await chamarAnthropic(ANTHROPIC_KEY, {
          model: 'claude-sonnet-4-6',
          max_tokens: 400,
          messages: [{ role: 'user', content: prompt_aprendizado }]
        })
      );
    }

    return res.status(400).json({ error: 'Parâmetros inválidos. Informe tipo + dados correspondentes.' });

  } catch (err) {
    console.error('[EAGLE API] Erro:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

async function chamarAnthropic(apiKey, body, usarBetaPDF = false) {
  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  };
  if (usarBetaPDF) headers['anthropic-beta'] = 'pdfs-2024-09-25';

  const MAX_TENTATIVAS = 3;
  const ESPERAS = [1000, 2000, 4000];

  for (let tentativa = 0; tentativa < MAX_TENTATIVAS; tentativa++) {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (resp.ok) {
      const data = await resp.json();
      if (data.error) throw new Error(data.error?.message || 'Erro Anthropic');
      return data;
    }

    // Retry apenas em 429 (rate limit) e 529 (overloaded)
    if ((resp.status === 429 || resp.status === 529) && tentativa < MAX_TENTATIVAS - 1) {
      await new Promise(r => setTimeout(r, ESPERAS[tentativa]));
      continue;
    }

    const data = await resp.json().catch(() => ({}));
    throw new Error(data.error?.message || `HTTP ${resp.status}`);
  }
}
