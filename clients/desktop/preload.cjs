const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('znoteLauncher',{
  state:()=>ipcRenderer.invoke('launcher:state'),
  connect:address=>ipcRenderer.invoke('launcher:connect',address),
  local:()=>ipcRenderer.invoke('launcher:local'),
  media:()=>ipcRenderer.invoke('launcher:media'),
  feedback:()=>ipcRenderer.invoke('launcher:feedback')
});
