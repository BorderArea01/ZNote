// Share sheets often supply a sentence followed by a short URL, not a bare URL.
export function sharedUrls(text) {
  return [...new Set((String(text || '').match(/https?:\/\/[^\s<>"\u200b]+/gi) || []).map(v => v.replace(/[，。；！、）】》」』,;!?)]+$/u, '')).filter(v => {
    try { const u = new URL(v); return !u.username && !u.password && v.length <= 4096; } catch { return false; }
  }))];
}
