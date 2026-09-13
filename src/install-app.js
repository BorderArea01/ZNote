let offer=null;const listeners=new Set();
export const installOffer=()=>offer;
export const subscribeInstall=listener=>{listeners.add(listener);return()=>listeners.delete(listener)};
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();offer=event;for(const listener of listeners)listener(offer)});
window.addEventListener('appinstalled',()=>{offer=null;for(const listener of listeners)listener(null)});
export async function installApp(){const current=offer;if(!current)return;await current.prompt();await current.userChoice;offer=null;for(const listener of listeners)listener(null)}
if('serviceWorker' in navigator&&window.isSecureContext){const register=()=>navigator.serviceWorker.register('/sw.js').catch(()=>{});if(document.readyState==='complete')register();else window.addEventListener('load',register,{once:true});}
