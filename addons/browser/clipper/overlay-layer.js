// A non-modal browser top layer escapes page stacking contexts without locking
// page scrolling or focus. Native page dialogs still own their interaction scope.
(() => {
  if(globalThis.ZNoteOverlayLayer)return;
  globalThis.ZNoteOverlayLayer=class {
    constructor(host,{visible=()=>true}={}) {
      this.host=host;this.visible=visible;
      this.observer=new MutationObserver(()=>{if(!host.isConnected)this.raise();});
      host.setAttribute('popover','manual');
      for(const [key,value] of Object.entries({border:'0',padding:'0',margin:'0',background:'transparent',inset:'auto',top:'0',left:'0',width:'0',height:'0',overflow:'visible','pointer-events':'none'}))host.style.setProperty(key,value,'important');
      this.changed=event=>{
        if(event.target===host||host.contains(event.target)||!visible())return;
        queueMicrotask(()=>{if(host.isConnected&&visible())this.raise();});
      };
      document.addEventListener('toggle',this.changed,true);
      document.addEventListener('fullscreenchange',this.changed);
      this.raise();
    }
    raise() {
      const host=this.host;
      const anchor=[...document.querySelectorAll('dialog:modal')].at(-1)||document.fullscreenElement||document.documentElement;
      const focused=host.shadowRoot?.activeElement;
      // A popover outside the active modal would be visible but inert. Move its
      // host into that modal before promoting it; never change the page's dialog.
      if(host.parentNode!==anchor)anchor.append(host);
      this.observer.disconnect();
      // Watch only direct children of ancestors, not every mutation on the page.
      // SPA dialogs can be removed altogether; do not lose our host with them.
      for(let parent=anchor;parent;parent=parent.parentNode)this.observer.observe(parent,{childList:true});
      if(typeof host.showPopover==='function') {
        if(host.matches(':popover-open'))host.hidePopover();
        host.showPopover();
        if(focused?.isConnected)focused.focus({preventScroll:true});
      }
    }
    dispose() {
      this.observer.disconnect();
      document.removeEventListener('toggle',this.changed,true);
      document.removeEventListener('fullscreenchange',this.changed);
      if(this.host.matches(':popover-open'))this.host.hidePopover();
    }
  };
})();
