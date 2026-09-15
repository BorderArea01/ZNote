import React, {useEffect, useRef, useState} from 'react';
import {CheckCheck} from 'lucide-react';

// Observe only the original entry, avoiding scroll listeners and preserving
// the existing selection/anchor logic in Workspace.
export function SelectionEntry({selecting, disabled, onToggle}) {
  const entry = useRef(null);
  const [above, setAbove] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(([item]) => {
      setAbove(!item.isIntersecting && item.boundingClientRect.bottom < 0);
    });
    observer.observe(entry.current);
    return () => observer.disconnect();
  }, []);
  return <>
    <button ref={entry} className="text-button" disabled={disabled} onClick={onToggle}>
      {selecting ? '退出选择' : '选择内容'}
    </button>
    {above && !selecting && <button className="floating-action-dock floating-selection-entry" aria-label="在当前位置多选" disabled={disabled} onClick={onToggle}>
      <CheckCheck size={18}/><span>多选</span>
    </button>}
  </>;
}
