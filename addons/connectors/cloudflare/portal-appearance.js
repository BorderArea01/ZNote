export const portalAppearanceScript=`
const appearanceButton=document.getElementById('appearance');let appearanceState={};
function applyAppearance(value){let a=value;try{a=a||JSON.parse(window.ZNoteAppearance?.snapshot?.()||'null')||JSON.parse(localStorage.getItem('znote-appearance')||'null');}catch{}a=a||{};const glitch=a.style==='glitch';document.documentElement.dataset.style=glitch?'glitch':'minimal';const mode=['light','dark','system'].includes(a.mode)?a.mode:'system';document.documentElement.dataset.theme=mode==='system'?(matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light'):mode;appearanceState={...a,mode};appearanceButton.setAttribute('aria-pressed',String(glitch));appearanceButton.textContent=glitch?'经典外观':'建筑故障';try{localStorage.setItem('znote-appearance',JSON.stringify(a));}catch{}}
appearanceButton.onclick=()=>{const a={style:document.documentElement.dataset.style==='glitch'?'minimal':'glitch',mode:appearanceState.mode||'system'};applyAppearance(a);try{window.ZNoteAppearance?.set?.(JSON.stringify(a));}catch{}};
window.addEventListener('znote:native-appearance',e=>applyAppearance(e.detail));window.ZNoteAppearance?.subscribe?.(applyAppearance);matchMedia('(prefers-color-scheme:dark)').addEventListener('change',()=>applyAppearance());applyAppearance();
`;
export const portalAppearanceCss=`
#appearance{margin-left:auto;flex-shrink:0;font-size:11px}#online{margin-left:0}
html[data-style=glitch]{background:#111b29;color:#e9f0f8}html[data-style=glitch] main{--panel:#192738;--field:#203146;--edge:#405872;--text:#e9f0f8;--muted:#afc1d6}
html[data-style=glitch] header{padding:24px 16px;background:linear-gradient(90deg,#10243ac7,#10243a40),url('/themes/glitch/architecture-mobile.webp') center/cover;border-radius:7px}
html[data-style=glitch] main{--signal-fill:var(--panel)}
html[data-style=glitch] .logo{background:url('/themes/glitch/icon.svg') center/contain no-repeat;border:0;font-size:0}
html[data-style=glitch] :is(form,section>section){background:var(--panel);border-color:var(--edge);border-radius:10px}
html[data-style=glitch] :is(input,select,textarea){background:var(--field);color:var(--text);border-color:var(--edge)}html[data-style=glitch] button{background:#1859a8;border-color:#4281c8;color:#fff}
html[data-style=glitch] :is(label,.job p,footer){color:var(--muted)}html[data-style=glitch] a{color:var(--text)}html[data-style=glitch] :is(header p,#online){color:#e3edfa}
html[data-style=glitch][data-theme=light]{background:#edf2f7;color:#192d45}html[data-style=glitch][data-theme=light] main{--panel:#fcfdff;--field:#e6edf5;--edge:#bdccdd;--text:#192d45;--muted:#4c6179}
html[data-style=glitch][data-theme=light] header{color:#fff}html[data-style=glitch][data-theme=light] #status{color:#945b24}
`;
