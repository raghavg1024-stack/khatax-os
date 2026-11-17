/** Reject cross-site mutations; permit Next's local URL canonicalization only for loopback aliases. */
export function isSameOriginRequest(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true; // CLI/server clients do not send browser Origin headers.
  try {
    const url = new URL(request.url);
    const host = request.headers.get("host");
    const target = host ? new URL(`${url.protocol}//${host}`) : url;
    if (target.username || target.password || (host && (target.pathname !== "/" || target.search || target.hash)))
      return false;
    const loopback = (hostname: string) => ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
    const localAlias = loopback(url.hostname) && loopback(target.hostname) && url.port === target.port;
    if (target.host !== url.host && !localAlias) return false;
    return origin === target.origin;
  } catch {
    return false;
  }
}
