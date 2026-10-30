import{build}from'esbuild';import{readFile,writeFile,mkdir,copyFile,stat}from'node:fs/promises';import{createHash}from'node:crypto';import{dirname,resolve,join}from'node:path';import{fileURLToPath}from'node:url';import{portalHtml}from'./portal.js';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..'),dir=join(root,'artifacts/remote-access/pages');await mkdir(dir,{recursive:true});
const themeDir=join(dir,'themes/glitch');await mkdir(themeDir,{recursive:true});for(const file of['architecture-mobile.webp','icon.svg','fragments.css','fragment-masks.css'])await copyFile(join(root,'public/themes/glitch',file),join(themeDir,file));
await build({entryPoints:[join(root,'addons/connectors/cloudflare/worker.js')],bundle:true,format:'esm',platform:'browser',target:'es2022',outfile:join(dir,'_worker.js'),legalComments:'eof'});
await writeFile(join(dir,'index.html'),portalHtml);
// Optional public release artifacts only. Never copy collector configuration,
// credentials, databases, or media into Pages static assets.
let release;try{release=JSON.parse(await readFile(join(root,'data/cloudflare-collector/client-release.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
if(release){
 if(!/^\d+\.\d+\.\d+(?:-beta\.\d+)?$/.test(release.version))throw Error('Invalid Android release version');
 const downloads=join(dir,'downloads');await mkdir(downloads,{recursive:true});const manifest={version:release.version};
 for(const [key,suffix]of[['apk','android.apk'],['source','source.zip']]){
  const file=resolve(root,release[key]);if(!file.startsWith(join(root,'artifacts')+'/')&&!file.startsWith(join(root,'artifacts')+'\\'))throw Error('Release source must be inside artifacts');
  const bytes=await readFile(file);if(bytes.length>24*1024*1024)throw Error('Release artifact exceeds static file budget');
  const digest=createHash('sha256').update(bytes).digest('hex');if(digest!==release[key+'_sha256'])throw Error('Release artifact digest mismatch');
  const name='ZNote-'+release.version+'-'+suffix;await copyFile(file,join(downloads,name));manifest[key]='/downloads/'+name;manifest[key+'_sha256']=digest;manifest[key+'_size']=bytes.length;
 }
 await writeFile(join(downloads,'latest.json'),JSON.stringify(manifest));
}
const designPreviews=['mobile-ui','overlay-ui'].map(name=>({name,source:join(root,'docs/design',name),files:['index.html','styles.css','app.js']}));
// A local plugin may keep a public, fictional-data design preview alongside
// its ignored source. Copy only these three built assets, never plugin data.
const characterPreview=join(root,'plugins/character-studio/design/dist');
const characterPreviewStat=await stat(characterPreview).catch(error=>{if(error.code==='ENOENT')return null;throw error});
if(characterPreviewStat?.isDirectory())designPreviews.push({name:'character-layouts',source:characterPreview,files:['index.html','ui.css','ui.js']});
for(const preview of designPreviews){
 const target=join(dir,'design',preview.name);await mkdir(target,{recursive:true});
 for(const name of preview.files)await copyFile(join(preview.source,name),join(target,name));
}
await writeFile(join(dir,'_routes.json'),JSON.stringify({version:1,include:['/*'],exclude:['/downloads/*','/themes/*',...designPreviews.flatMap(({name})=>['/design/'+name,'/design/'+name+'/*'])]}));
await writeFile(join(dir,'_headers'),['/downloads/*',...designPreviews.map(({name})=>'/design/'+name+'/*')].map(path=>path+'\n  Cache-Control: no-store\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n').join(''));
const worker=JSON.parse(await readFile(join(root,'data/cloudflare-collector/wrangler.json'),'utf8'));
await writeFile(join(root,'data/cloudflare-collector/pages.json'),JSON.stringify({name:worker.name,account_id:worker.account_id,pages_build_output_dir:dir,compatibility_date:worker.compatibility_date,d1_databases:worker.d1_databases},null,2));
console.log('Built Pages inbox with the same D1 queue and compatible capture API.');
