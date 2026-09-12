import React, { createContext, useContext, useEffect, useState } from 'react';
import { Check } from 'lucide-react';

export const styles = [
  { id: 'minimal', name: '简约', description: '干净留白，专注内容' },
  { id: 'glass', name: '毛玻璃', description: '通透面板，柔和光晕' },
  { id: 'cyber', name: '赛博朋克', description: '霓虹青紫，几何网格' },
  { id: 'paper', name: '纸感', description: '暖色纸张，安静阅读' },
];
export const palettes = [
  { id: 'forest', name: '松林绿', color: '#287464' },
  { id: 'ocean', name: '海湾蓝', color: '#2867af' },
  { id: 'violet', name: '鸢尾紫', color: '#7553b3' },
  { id: 'rose', name: '玫瑰粉', color: '#ac4d70' },
  { id: 'amber', name: '琥珀橙', color: '#a36520' },
  { id: 'slate', name: '石墨灰', color: '#566478' },
];
const defaults = { style: 'minimal', palette: 'forest' };
function normalize(value) {
  return { style: styles.some(s => s.id === value?.style) ? value.style : defaults.style,
    palette: palettes.some(p => p.id === value?.palette) ? value.palette : defaults.palette };
}
const AppearanceContext = createContext(null);
export function AppearanceProvider({ children }) {
  const [appearance, setAppearance] = useState(() => {
    try { return normalize(JSON.parse(localStorage.getItem('znote-appearance'))); } catch { return defaults; }
  });
  useEffect(() => {
    document.documentElement.dataset.style = appearance.style;
    document.documentElement.dataset.palette = appearance.palette;
    try { localStorage.setItem('znote-appearance', JSON.stringify(appearance)); } catch {}
  }, [appearance]);
  return <AppearanceContext.Provider value={{ appearance, setAppearance }}>{children}</AppearanceContext.Provider>;
}
export function AppearanceSettings() {
  const { appearance, setAppearance } = useContext(AppearanceContext);
  return <div className="appearance-settings">
    <p className="appearance-label">界面风格</p>
    <div className="style-presets" role="group" aria-label="界面风格">
      {styles.map(style => <button key={style.id} className="style-preset" aria-label={`风格：${style.name}`} aria-pressed={appearance.style === style.id} onClick={() => setAppearance(a => ({ ...a, style: style.id }))}>
        <span className={`style-sample sample-${style.id}`} aria-hidden="true"><i /><span><b /><em /><em /></span></span>
        <span className="preset-title">{style.name}{appearance.style === style.id && <Check size={14} />}</span>
        <small>{style.description}</small>
      </button>)}
    </div>
    {['minimal', 'glass'].includes(appearance.style) ? <>
      <p className="appearance-label">预设色调</p>
      <div className="palette-presets" role="group" aria-label="预设色调">
        {palettes.map(palette => <button key={palette.id} aria-label={`色调：${palette.name}`} aria-pressed={appearance.palette === palette.id} onClick={() => setAppearance(a => ({ ...a, palette: palette.id }))}>
          <span className="palette-dot" style={{ backgroundColor: palette.color }} aria-hidden="true" />{palette.name}{appearance.palette === palette.id && <Check size={13} />}
        </button>)}
      </div>
    </> : <p>{appearance.style === 'cyber' ? '赛博朋克采用独立的霓虹青紫配色。' : '纸感采用独立的暖纸与墨棕配色。'}切回简约或毛玻璃后保留原先的色调。</p>}
  </div>;
}
