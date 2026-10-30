try {
  // The phone's native chrome owns its device preference; no credential or
  // server access is exposed by this appearance-only bridge.
  const native=JSON.parse(window.ZNoteAppearance?.snapshot?.()||'null');
  if(['minimal','glass','cyber','paper','glitch'].includes(native?.style)){
    const previous=JSON.parse(localStorage.getItem('znote-appearance')||'null')||{};
    localStorage.setItem('znote-appearance',JSON.stringify({...previous,style:native.style}));
    if(['light','dark','system'].includes(native.mode))localStorage.setItem('znote-theme',native.mode);
  }
}catch{}
try {
  const stored = localStorage.getItem("znote-theme");
  const choice = ['light', 'dark', 'system'].includes(stored) ? stored : 'system';
  document.documentElement.dataset.theme =
    choice === "system"
      ? matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : choice;
} catch {}
// Apply the saved style before the first paint, including the login page.
let appearance;
try { appearance = JSON.parse(localStorage.getItem('znote-appearance')); } catch {}
document.documentElement.dataset.style = ['minimal', 'glass', 'cyber', 'paper', 'glitch'].includes(appearance?.style) ? appearance.style : 'minimal';
document.documentElement.dataset.palette = ['forest', 'ocean', 'violet', 'rose', 'amber', 'slate'].includes(appearance?.palette) ? appearance.palette : 'forest';
if(document.documentElement.dataset.style==='glitch')document.querySelector('link[rel="icon"]')?.setAttribute('href','/themes/glitch/icon.svg');
