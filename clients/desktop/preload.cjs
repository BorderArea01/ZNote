const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('znoteLauncher',{
  state:()=>ipcRenderer.invoke('launcher:state'),
  connect:address=>ipcRenderer.invoke('launcher:connect',address),
  local:()=>ipcRenderer.invoke('launcher:local'),
  media:()=>ipcRenderer.invoke('launcher:media'),
  feedback:()=>ipcRenderer.invoke('launcher:feedback'),
  appearance:value=>ipcRenderer.invoke('launcher:appearance',value),
  onAppearance:callback=>{const listener=(_event,value)=>callback(value);ipcRenderer.on('appearance:changed',listener);return()=>ipcRenderer.removeListener('appearance:changed',listener);}
});
