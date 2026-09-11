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

  // ── Sistema de contexto jurídico SBK ───────────────────────────────────────
  const SYSTEM_JURIDICO = `Você é um especialista em análise de petições judiciais brasileiras trabalhando para o escritório SBK.
Sua tarefa é extrair dados processuais do documento e retornar APENAS um JSON válido, sem markdown, sem explicações.

CAMPOS E FORMATOS ESPERADOS:
- npu: Número único CNJ no formato NNNNNNN-DD.AAAA.J.TT.OOOO (ex: 1234567-89.2024.8.26.0001)
- uf: Sigla do estado (ex: SP, MG, RJ)
- comarca: Município sede do tribunal (ex: São Paulo, Campinas)
- data_ajuizamento: Data no formato DD/MM/AAAA
- valor_causa: Valor em reais sem símbolo de moeda (ex: 15000.00)
- vara_cartorio: Nome da vara ou cartório (ex: 3ª Vara Cível de São Paulo)
- numero_origem: Número de origem ou processo anterior, se existir
- tipo_justica: EXATAMENTE um de: ESTADUAL, FEDERAL, TRABALHISTA
  (dica: use o dígito J do NPU — 4=FEDERAL, 5=TRABALHISTA, 8=ESTADUAL)
- rito: EXATAMENTE um de: Procedimento Comum Cível, Juizado Especial Cível, Juizado Especial, Cumprimento de Sentença, Execução, Mandado de Segurança, Ação Civil Pública
- fase_processual: EXATAMENTE um de: Conhecimento, Cumprimento de Sentença, Execução, Inicial, Recursal
- tipo_documento: EXATAMENTE um de: Petição Inicial, Contestação, Recurso, Agravo, Embargos, Sentença
- desconto_conta: "Sim" se há desconto em conta bancária ou margem consignada, "Não" caso contrário
- autor_nome: Nome completo do autor/requerente principal
- autor_cpf: CPF do autor no formato XXX.XXX.XXX-XX
- advogado_nome: Nome do advogado do autor
- advogado_uf: UF da OAB do advogado do autor
- advogado_oab: Número da OAB do advogado do autor
- reus: Array de objetos com nome e cnpj de cada réu/requerido

OBJETO PRINCIPAL — escolha EXATAMENTE um dos valores abaixo, ou deixe vazio se não identificado:
AF DESCONTO IRREGULAR, AF/PLANO DESCONTO IRREGULAR, ANULATÓRIA PROCON, BANCO DO BRASIL (JAIR), BANCO DO BRASIL (JURÍDICO), BANCO DO BRASIL (MATRIZ), BANCO ITAÚ (MATRIZ), BLOQUEIO DE MARGEM, BRADESCO (MATRIZ), CAIXA INTERNO, CARTÃO DE CRÉDITO CONSIGNADO, CRÉDITO TRABALHADOR, DÉBITO EM CONTA - ASSISTÊNCIA VERBIN, EMPRÉSTIMO CONSIGNADO, EXECUÇÃO DE TÍTULOS EXTRAJUDICIAIS, EXECUÇÃO FISCAL ESTADUAL, EXECUÇÃO FISCAL MUNICIPAL, FLUXO COM VERIFICAÇÃO, FLUXO SIMPLES, FUTURO NÃO É PARTE, HOMOLOGAÇÃO DE ACORDO, INDENIZATÓRIA, INSCRIÇÃO INDEVIDA SPC/SERASA, PLANO DESCONTO IRREGULAR, PRODUÇÃO DE PROVAS, REVISIONAL DE JUROS, SANTANDER (JURÍDICO), SEGURO PRESTAMISTA IRREGULAR, SINISTROS, SUPERENDIVIDAMENTO, TRABALHISTA FUNCIONÁRIO, TRABALHISTA TEMPORÁRIO, TRABALHISTA TERCEIRO, USUCAPIÃO

CAUSA RAIZ — escolha EXATAMENTE um dos valores abaixo, ou deixe vazio se não identificado:
AF, CLIENTE NÃO RECONHECE A VENDA, CRÉDITO TRABALHADOR, DÉBITO EM CONTA - ASSISTÊNCIA VERBIN, IPTU, MULTA PROCON, NEGATIVA CANCELAMENTO, PROPOSTA COMERCIAL DIFERENTE, PRÓPRIO, RESERVA DE MARGEM, SUPERENDIVIDAMENTO, TERCEIRO, TRABALHISTA

FORMATOS DE DOCUMENTOS COMUNS:
- PROJUDI/portal judicial: a primeira página tem cabecalho com "Por: NOME DO ADVOGADO" — esse nome é o advogado, NUNCA o autor. O autor e réus estão nas páginas seguintes da petição.
- Petição clássica: o autor se qualifica no primeiro parágrafo ("NOME, brasileiro(a), portador(a) do CPF...").
- Portal TJSP/ESAJ: partes listadas no cabeçalho com labels "REQUERENTE:" e "REQUERIDO:".

REGRAS ABSOLUTAS:
1. Retorne SOMENTE o JSON, sem texto antes ou depois
2. Campos não encontrados devem ser string vazia "" (nunca null)
3. O array reus deve ter ao menos um item se houver réu identificado
4. Infira tipo_justica a partir do dígito J do NPU quando possível
5. "Por: NOME" no cabeçalho de portais = advogado, nunca autor
6. Réus são pessoas jurídicas (empresas/bancos) ou físicas no polo passivo — leia todos os réus listados`;

  // ── Roteamento por tipo de chamada ─────────────────────────────────────────
  try {
    if (tipo === 'extrair_pdf' && pdf_b64) {
      // PDF escaneado: envia como documento base64
      const instrucaoFinal = `Extraia os dados processuais deste documento e retorne o JSON conforme as instruções do sistema:\n{"npu":"","uf":"","comarca":"","data_ajuizamento":"","valor_causa":"","vara_cartorio":"","numero_origem":"","tipo_justica":"","rito":"","fase_processual":"","tipo_documento":"","objeto_principal":"","causa_raiz":"","desconto_conta":"","autor_nome":"","autor_cpf":"","advogado_nome":"","advogado_uf":"","advogado_oab":"","reus":[{"nome":"","cnpj":""}]}`;
      return res.status(200).json(
        await chamarAnthropic(ANTHROPIC_KEY, {
          model: 'claude-sonnet-4-6',
          max_tokens: 2048,
          system: SYSTEM_JURIDICO,
          messages: [{
            role: 'user',
            content: [
              { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdf_b64 } },
              { type: 'text', text: instrucaoFinal }
            ]
          }]
        }, true)
      );
    }

    if (tipo === 'extrair_texto' && texto) {
      // Texto extraído do PDF: análise com contexto completo
      const textoTruncado = texto.length > 12000 ? texto.substring(0, 12000) + '\n[texto truncado]' : texto;
      return res.status(200).json(
        await chamarAnthropic(ANTHROPIC_KEY, {
          model: 'claude-sonnet-4-6',
          max_tokens: 2048,
          system: SYSTEM_JURIDICO,
          messages: [{
            role: 'user',
            content: `Extraia os dados processuais do texto abaixo e retorne o JSON:\n{"npu":"","uf":"","comarca":"","data_ajuizamento":"","valor_causa":"","vara_cartorio":"","numero_origem":"","tipo_justica":"","rito":"","fase_processual":"","tipo_documento":"","objeto_principal":"","causa_raiz":"","desconto_conta":"","autor_nome":"","autor_cpf":"","advogado_nome":"","advogado_uf":"","advogado_oab":"","reus":[{"nome":"","cnpj":""}]}\n\nTEXTO DA PETIÇÃO:\n${textoTruncado}`
          }]
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
