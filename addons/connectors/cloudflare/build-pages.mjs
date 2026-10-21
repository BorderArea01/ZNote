import{build}from'esbuild';import{readFile,writeFile,mkdir}from'node:fs/promises';import{dirname,resolve,join}from'node:path';import{fileURLToPath}from'node:url';import{portalHtml}from'./portal.js';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..'),dir=join(root,'artifacts/remote-access/pages');await mkdir(dir,{recursive:true});
await build({entryPoints:[join(root,'addons/connectors/cloudflare/worker.js')],bundle:true,format:'esm',platform:'browser',target:'es2022',outfile:join(dir,'_worker.js'),legalComments:'eof'});
await writeFile(join(dir,'index.html'),portalHtml);
const worker=JSON.parse(await readFile(join(root,'data/cloudflare-collector/wrangler.json'),'utf8'));
await writeFile(join(root,'data/cloudflare-collector/pages.json'),JSON.stringify({name:worker.name,account_id:worker.account_id,pages_build_output_dir:dir,compatibility_date:worker.compatibility_date,d1_databases:worker.d1_databases},null,2));
console.log('Built Pages inbox with the same D1 queue and compatible capture API.');
