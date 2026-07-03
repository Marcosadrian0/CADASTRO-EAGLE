/**
 * EAGLE — Restrição de acesso por IP
 * Apenas IPs da VPN autorizada podem acessar qualquer endpoint da API.
 */

const IPS_PERMITIDOS = new Set([
  '186.193.236.194',
  '179.191.112.34',
]);

/**
 * Extrai o IP real do request, considerando proxies/Vercel.
 */
function resolverIP(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    // x-forwarded-for pode ser "ip1, ip2, ip3" — o primeiro é o cliente real
    return forwarded.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || req.connection?.remoteAddress || '';
}

/**
 * Retorna true se o acesso deve ser bloqueado.
 * Usa no início de cada handler: if (ipBloqueado(req, res)) return;
 */
export function ipBloqueado(req, res) {
  // OPTIONS (preflight CORS) sempre passa para não quebrar o browser
  if (req.method === 'OPTIONS') return false;

  const ip = resolverIP(req);
  if (IPS_PERMITIDOS.has(ip)) return false;

  console.warn('[EAGLE] Acesso bloqueado — IP não autorizado:', ip);
  res.status(403).json({ error: 'Acesso não autorizado. Conecte-se à VPN.' });
  return true;
}
