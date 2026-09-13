import React, { useEffect, useRef } from "react";
import { X } from "lucide-react";
import {useAppBack} from './back-navigation.js';
export function IconButton({ label, children, ...props }) {
  return (
    <button
      type="button"
      className="icon-button"
      aria-label={label}
      title={label}
      {...props}
    >
      {children}
    </button>
  );
}

export function Dialog({ title, onClose, children, className = "" }) {
  const ref = useRef();
  const backdropPress = useRef(false);
  useAppBack(()=>{
    if([...document.querySelectorAll('[role="dialog"]')].at(-1)!==ref.current)return false;
    return Promise.resolve(onClose());
  },true,100);
  useEffect(() => {
    const previous = document.activeElement;
    // A nested viewer may have already claimed focus during the same mount.
    if (!ref.current?.contains(document.activeElement)) ref.current?.focus();
    const listener = (e) => {
      if (e.target.closest('[role="dialog"]') !== ref.current) return;
      if (e.key !== "Tab") return;
      const all = [
        ...ref.current.querySelectorAll(
          'button, input, select, textarea, a[href], [tabindex="0"]',
        ),
      ].filter((el) => !el.disabled && el.offsetParent !== null);
      const first = all[0],
        last = all.at(-1);
      if (
        e.shiftKey &&
        (document.activeElement === first ||
          document.activeElement === ref.current)
      ) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    const element=ref.current;
    element?.addEventListener("keydown", listener);
    return () => { element?.removeEventListener('keydown',listener);if(previous?.isConnected)previous.focus(); };
  }, []);
  useEffect(() => {
    // A disabled or removed action button may return focus to the page body.
    // Escape must still dismiss only the topmost dialog in that case.
    const escape = e => {
      if (e.key !== 'Escape' || e.isComposing || e.defaultPrevented || e.target.closest?.('[role="dialog"]')) return;
      const dialogs = document.querySelectorAll('.dialog[role="dialog"]');
      if (dialogs[dialogs.length - 1] !== ref.current) return;
      e.preventDefault(); onClose();
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [onClose]);
  return (
    <div className="dialog-shade"
      onPointerDown={e=>{backdropPress.current=e.target===e.currentTarget&&e.button===0;}}
      onPointerCancel={()=>{backdropPress.current=false;}}
      onClick={e=>{const outside=backdropPress.current&&e.target===e.currentTarget;backdropPress.current=false;if(outside){e.stopPropagation();ref.current?.focus({preventScroll:true});onClose();}}}
    >
      <section
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`dialog ${className}`}
        onKeyDown={e=>{if(e.key==='Escape'&&!e.nativeEvent.isComposing&&e.target.closest('[role="dialog"]')===ref.current){e.preventDefault();e.stopPropagation();onClose();}}}
      >
        <header className="dialog-header">
          <h2>{title}</h2>
          <IconButton label="关闭窗口" onClick={onClose}>
            <X size={20} />
          </IconButton>
        </header>
        {children}
      </section>
    </div>
  );
}
