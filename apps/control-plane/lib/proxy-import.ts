export type ParsedProxyInput = {
  type: 'http' | 'https' | 'socks4' | 'socks5';
  host: string;
  port: number;
  username?: string;
  password?: string;
};

export function parseProxyLine(line: string): ParsedProxyInput | null {
  const value = line.trim();
  if (!value || value.startsWith('#')) return null;

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    const url = new URL(value);
    const scheme = normalizeType(url.protocol.replace(':', ''));
    return {
      type: scheme,
      host: url.hostname,
      port: Number(url.port),
      username: url.username ? decodeURIComponent(url.username) : undefined,
      password: url.password ? decodeURIComponent(url.password) : undefined
    };
  }

  const parts = value.split(':');
  if (parts.length === 4) {
    return {
      type: 'http',
      host: parts[0],
      port: Number(parts[1]),
      username: parts[2],
      password: parts[3]
    };
  }

  if (parts.length === 2) {
    return {
      type: 'http',
      host: parts[0],
      port: Number(parts[1])
    };
  }

  throw new Error('Proxy must be URL, host:port, or Webshare host:port:user:pass');
}

export function parseProxyBulk(text: string) {
  const proxies = [];
  const errors = [];

  for (const [index, line] of text.split(/\r?\n/).entries()) {
    try {
      const parsed = parseProxyLine(line);
      if (parsed) proxies.push(parsed);
    } catch (error) {
      errors.push({
        line: index + 1,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return { proxies, errors };
}

function normalizeType(type: string): ParsedProxyInput['type'] {
  if (type === 'http' || type === 'https' || type === 'socks4' || type === 'socks5') return type;
  throw new Error(`Unsupported proxy scheme: ${type}`);
}
