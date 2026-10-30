// Preload only for the guarded desktop packaging command. electron-builder's
// archive API has no thread-count option; bound its 7-Zip invocation in memory
// without modifying installed dependencies or changing unrelated processes.
const Module=require('node:module'),fs=require('node:fs');
const previous=Module._extensions['.js'];
Module._extensions['.js']=function(module,file){
 if(file.replaceAll('\\','/').endsWith('/app-builder-lib/out/targets/archive.js')){
  const source=fs.readFileSync(file,'utf8'),needle='const args = debug7zArgs("a");';
  if(!source.includes(needle))throw Error('Desktop archive worker limit requires review for this builder version');
  module._compile(source.replace(needle,needle+' args.push("-mmt=1");'),file);
 }else previous(module,file);
};
