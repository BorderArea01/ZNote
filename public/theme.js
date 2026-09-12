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
document.documentElement.dataset.style = ['minimal', 'glass', 'cyber', 'paper'].includes(appearance?.style) ? appearance.style : 'minimal';
document.documentElement.dataset.palette = ['forest', 'ocean', 'violet', 'rose', 'amber', 'slate'].includes(appearance?.palette) ? appearance.palette : 'forest';
