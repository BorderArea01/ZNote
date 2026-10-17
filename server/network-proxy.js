import { execFileSync } from 'node:child_process';
import HttpsProxyAgent from 'https-proxy-agent';

// The desktop browser can be configured to use Clash while a Node process
// started from a shortcut does not inherit the browser's proxy environment.
// Keep proxy discovery opt-in on non-Windows hosts, and on Windows mirror the
// user-level WinINet proxy when it is explicitly enabled. The destination is
// still DNS-validated by each caller before this agent is used.
export function windowsProxyServer(value) {
  const parts=value.split(';').map(part=>part.trim());
  const selected=parts.find(part=>/^https=/i.test(part))?.replace(/^https=/i,'')
    ||parts.find(part=>/^http=/i.test(part))?.replace(/^http=/i,'')
    ||(!value.includes('=')?value.trim():'');
  if(!selected||/^(?:auto|direct)$/i.test(selected))return '';
  return /^https?:\/\//i.test(selected)?selected:`http://${selected}`;
}

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
    return windowsProxyServer(value);
  } catch {
    return '';
  }
}

export function createProxyResolver({env=process.env,readSystem=readWindowsProxy,now=Date.now,ttlMs=5000}={}) {
  let cached,expires=0;
  return {
    url(){
      // Explicit process configuration wins, and is checked on every call.
      const configured=['ZNOTE_HTTP_PROXY','HTTPS_PROXY','HTTP_PROXY','ALL_PROXY'].map(key=>(env[key]||'').trim()).find(Boolean);
      if(configured)return configured;
      const time=now();
      if(cached===undefined||time>=expires){cached=readSystem();expires=time+ttlMs;}
      return cached;
    },
    reset(){cached=undefined;expires=0;},
  };
}
const resolver=createProxyResolver();
export const proxyUrl=()=>resolver.url();

export function proxyAgent() {
  const value = proxyUrl();
  return value ? new HttpsProxyAgent(value) : undefined;
}

export function resetProxyCache() {
  resolver.reset();
}
