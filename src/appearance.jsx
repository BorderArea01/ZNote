import { HelpHint } from './HelpHint.jsx';
import React, { createContext, useContext, useEffect, useState } from 'react';
import { Check } from 'lucide-react';

export const styles = [
  { id: 'minimal', name: '简约', description: '干净留白，专注内容' },
  { id: 'glass', name: '毛玻璃', description: '通透面板，柔和光晕' },
  { id: 'cyber', name: '赛博朋克', description: '霓虹青紫，几何网格' },
  { id: 'paper', name: '纸感', description: '暖色纸张，安静阅读' },
  { id: 'glitch', name: '建筑故障', description: '晴空建筑，水平像素撕裂' },
];
export const palettes = [
  { id: 'forest', name: '松林绿', color: '#287464' },
  { id: 'ocean', name: '海湾蓝', color: '#2867af' },
  { id: 'violet', name: '鸢尾紫', color: '#7553b3' },
  { id: 'rose', name: '玫瑰粉', color: '#ac4d70' },
  { id: 'amber', name: '琥珀橙', color: '#a36520' },
  { id: 'slate', name: '石墨灰', color: '#566478' },
];
const defaults = { style: 'minimal', palette: 'forest', motion: 'dynamic' };
function normalize(value) {
  return { style: styles.some(s => s.id === value?.style) ? value.style : defaults.style,
    palette: palettes.some(p => p.id === value?.palette) ? value.palette : defaults.palette,
    motion: value?.motion === 'still' ? 'still' : 'dynamic' };
}
const AppearanceContext = createContext(null);
export function AppearanceProvider({ children }) {
  useEffect(()=>window.ZNoteAppearance?.subscribe?.(detail=>window.dispatchEvent(new CustomEvent('znote:native-appearance',{detail}))),[]);
  const [appearance, setAppearance] = useState(() => {
    try { return normalize(JSON.parse(localStorage.getItem('znote-appearance'))); } catch { return defaults; }
  });
  useEffect(() => {
    document.documentElement.dataset.style = appearance.style;
    document.documentElement.dataset.palette = appearance.palette;
    document.documentElement.dataset.motion = appearance.motion;
    try { localStorage.setItem('znote-appearance', JSON.stringify(appearance)); } catch {}
    const sync=()=>{
      const glitch=appearance.style==='glitch';
      document.querySelector('link[rel="icon"]')?.setAttribute('href',glitch?'/themes/glitch/icon.svg?v=9':'/icon.svg');
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content',glitch?'#1859a8':'#287464');
      queueMicrotask(()=>{try{window.ZNoteAppearance?.set?.(JSON.stringify({style:document.documentElement.dataset.style,palette:document.documentElement.dataset.palette,motion:document.documentElement.dataset.motion,mode:localStorage.getItem('znote-theme')||'system'}));}catch{}});
    };sync();window.addEventListener('znote:theme-changed',sync);
    return()=>window.removeEventListener('znote:theme-changed',sync);
  }, [appearance]);
  useEffect(()=>{const changed=e=>{if(styles.some(s=>s.id===e.detail?.style))setAppearance(a=>({...a,style:e.detail.style,...(['dynamic','still'].includes(e.detail?.motion)?{motion:e.detail.motion}:{})}));};window.addEventListener('znote:native-appearance',changed);return()=>window.removeEventListener('znote:native-appearance',changed);},[]);
  return <AppearanceContext.Provider value={{ appearance, setAppearance }}>{children}</AppearanceContext.Provider>;
}
export function AppearanceSettings() {
  const { appearance, setAppearance } = useContext(AppearanceContext);
  return <div className="appearance-settings">
    <div className="inline-heading"><p className="appearance-label">界面风格</p><HelpHint label="界面风格">建筑故障以晴空摄影为底，将容器材质切成横向条带，拉伸、错位、分色并重组，碎片向外飘散。布局和点击位置保持稳定，原始媒体不加滤镜；原有主题可随时切回。</HelpHint></div>
    <div className="style-presets" role="group" aria-label="界面风格">
      {styles.map(style => <button key={style.id} className="style-preset" aria-label={`风格：${style.name}`} aria-pressed={appearance.style === style.id} onClick={() => setAppearance(a => ({ ...a, style: style.id }))}>
        <span className={`style-sample sample-${style.id}`} aria-hidden="true"><i /><span><b /><em /><em /></span></span>
        <span className="preset-title">{style.name}{appearance.style === style.id && <Check size={14} />}</span>

      </button>)}
    </div>
    {appearance.style === 'glitch' ? <>
      <div className="inline-heading"><p className="appearance-label">主题动效</p><HelpHint label="主题动效">动态模式仅在鼠标掠过时播放一次横向撕裂，手机触碰和键盘操作也有反馈，结束后恢复完整轮廓；闲置不播放。系统开启减少动态效果时保持静态。此设置用于知识库页面，安卓原生浮窗的更新单独发布。</HelpHint></div>
      <div className="palette-presets" role="group" aria-label="主题动效">
        {[['dynamic','动态'],['still','静态']].map(([motion,label])=><button key={motion} aria-pressed={appearance.motion===motion} onClick={()=>setAppearance(a=>({...a,motion}))}>{label}{appearance.motion===motion&&<Check size={13}/>}</button>)}
      </div>
    </> : null}
    {['minimal', 'glass'].includes(appearance.style) ? <>
      <p className="appearance-label">预设色调</p>
      <div className="palette-presets" role="group" aria-label="预设色调">
        {palettes.map(palette => <button key={palette.id} aria-label={`色调：${palette.name}`} aria-pressed={appearance.palette === palette.id} onClick={() => setAppearance(a => ({ ...a, palette: palette.id }))}>
          <span className="palette-dot" style={{ backgroundColor: palette.color }} aria-hidden="true" />{palette.name}{appearance.palette === palette.id && <Check size={13} />}
        </button>)}
      </div>
    </> : null}
  </div>;
}

export function ThemeScene(){return <div className="glitch-scene" aria-hidden="true"><span className="glitch-scene-grid"/><span className="glitch-scene-mark">Z</span><span className="glitch-scene-caption">ZNOTE / SIGNAL ARCHITECTURE</span><i/><i/><i/></div>;}
