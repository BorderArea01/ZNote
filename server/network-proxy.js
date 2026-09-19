import { execFileSync } from 'node:child_process';
import HttpsProxyAgent from 'https-proxy-agent';

// The desktop browser can be configured to use Clash while a Node process
// started from a shortcut does not inherit the browser's proxy environment.
// Keep proxy discovery opt-in on non-Windows hosts, and on Windows mirror the
// user-level WinINet proxy when it is explicitly enabled. The destination is
// still DNS-validated by each caller before this agent is used.
let cached;

function readWindowsProxy() {
  if (process.platform !== 'win32') return '';
  try {
    const enabled = execFileSync('reg', [
      'query',
      'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings',
      '/v',
      'ProxyEnable',
    ], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    if (!/ProxyEnable\s+REG_DWORD\s+0x1\b/i.test(enabled)) return '';
    const server = execFileSync('reg', [
      'query',
      'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings',
      '/v',
      'ProxyServer',
    ], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    const value = server.match(/ProxyServer\s+REG_SZ\s+([^\r\n]+)/i)?.[1]?.trim() || '';
    if (!value || /^(?:auto|direct)$/i.test(value)) return '';
    // WinINet accepts `http=host:port;https=host:port`. Use the HTTPS route
    // when present, otherwise the single proxy value used by Clash.
    const selected = value.split(';').map(part => part.trim()).find(part => /^https?=/i.test(part))?.replace(/^https?=/i, '') || value;
    if (!selected || /^(?:auto|direct)$/i.test(selected)) return '';
    return /^https?:\/\//i.test(selected) ? selected : `http://${selected}`;
  } catch {
    return '';
  }
}

export function proxyUrl() {
  if (cached !== undefined) return cached;
  const configured = process.env.ZNOTE_HTTP_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY || '';
  cached = configured.trim() || readWindowsProxy();
  return cached;
}

export function proxyAgent() {
  const value = proxyUrl();
  return value ? new HttpsProxyAgent(value) : undefined;
}

export function resetProxyCache() {
  cached = undefined;
}
