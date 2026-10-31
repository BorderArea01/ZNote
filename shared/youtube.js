// Strict single-video URL matching, shared by server and browser.
export function youtubeVideoId(value) {
  try {
    const u = new URL(value);
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.port) return '';
    const host = u.hostname.toLowerCase();
    const id = host === 'youtu.be' ? u.pathname.slice(1) :
      ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(host)
        ? u.pathname === '/watch' ? u.searchParams.get('v') : u.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)\/?$/)?.[1] : '';
    return /^[\w-]{11}$/.test(id || '') ? id : '';
  } catch { return ''; }
}
export const youtubeVideoUrl = value => {
  const id = youtubeVideoId(value);
  return id ? 'https://www.youtube.com/watch?v=' + id : '';
};
