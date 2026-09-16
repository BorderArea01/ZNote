(() => {
  let last;
  document.addEventListener('contextmenu',event=>{const img=event.composedPath().find(n=>n?.tagName==='IMG');last=img?{sources:[img.src,img.currentSrc],time:Date.now(),candidates:globalThis.ZNoteCandidates(img)}:null;},true);
  chrome.runtime.onMessage.addListener((message,sender,reply)=>{if(sender.id!==chrome.runtime.id||message.type!=='image-candidates')return;reply(last&&Date.now()-last.time<60000&&last.sources.includes(message.srcUrl)?last.candidates:[]);});
})();
