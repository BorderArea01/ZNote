import {mkdir,cp,copyFile,readFile,writeFile,chmod,rm} from 'node:fs/promises';import {resolve,join} from 'node:path';import {spawnSync} from 'node:child_process';
const root=resolve('.'),dest=resolve('clients/desktop/runtime'),app=join(dest,'app');await mkdir(app,{recursive:true});
if(!process.version.startsWith('v24.'))throw Error('Build the desktop runtime with Node.js 24');
for(const dir of ['server','shared','dist','extensions','scripts'])await cp(join(root,dir),join(app,dir),{recursive:true});
for(const file of ['package.json','package-lock.json','LICENSE','LICENSING.md','THIRD_PARTY_NOTICES.md'])await copyFile(join(root,file),join(app,file));
await copyFile('clients/desktop/service.mjs',join(app,'desktop-service.mjs'));await copyFile(process.execPath,join(dest,process.platform==='win32'?'node.exe':'node'));await chmod(join(dest,process.platform==='win32'?'node.exe':'node'),0o755);
// Remove private integrations left in an existing desktop staging directory.
for(const relative of ['integrations','scripts/build-pixiv.mjs']){
const stale=resolve(app,relative);if(!stale.startsWith(app+String.fromCharCode(92))&&!stale.startsWith(app+'/'))throw Error('Unexpected runtime path');
await rm(stale,{recursive:true,force:true});
}
const npm=process.env.npm_execpath;if(!npm)throw Error('Run using npm run desktop:prepare');
// Native Sharp binaries are npm optional packages. Do not redistribute separately downloaded media executables.
const install=spawnSync(process.execPath,[npm,'ci','--omit=dev','--ignore-scripts','--no-audit','--no-fund'],{cwd:app,windowsHide:true,stdio:'inherit'});if(install.status!==0)throw Error('Runtime dependency install failed');
const license=await fetch(`https://raw.githubusercontent.com/nodejs/node/${process.version}/LICENSE`,{signal:AbortSignal.timeout(30000)});if(!license.ok)throw Error('Node.js license unavailable');await writeFile(join(dest,'NODE-LICENSE'),await license.text());
await writeFile(join(dest,'BUILD.json'),JSON.stringify({version:JSON.parse(await readFile('package.json','utf8')).version,node:process.version,platform:process.platform,arch:process.arch},null,2));
console.log('Packaged a separate Node runtime with production dependencies; media components remain optional.');
