import{readFile,writeFile,mkdir}from'node:fs/promises';import{dirname,resolve,join}from'node:path';import{fileURLToPath}from'node:url';import{execFileSync}from'node:child_process';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..'),dir=join(root,'data/cloudflare-collector/pages-deploy');await mkdir(dir,{recursive:true});
const config=JSON.parse(await readFile(join(root,'data/cloudflare-collector/pages.json'),'utf8'));
const {account_id,...pagesConfig}=config;await writeFile(join(dir,'wrangler.json'),JSON.stringify(pagesConfig,null,2));
// Pages requires a conventional config basename in its own working directory.
// Keep framework auto-detection and generated configuration away from ZNote.
execFileSync(process.execPath,['--max-old-space-size=256',join(root,'addons/connectors/cloudflare/node_modules/wrangler/bin/wrangler.js'),'pages','deploy',config.pages_build_output_dir,'--project-name',config.name,'--branch','main','--commit-dirty=true'],{cwd:dir,stdio:'inherit',windowsHide:true,env:{...process.env,CLOUDFLARE_ACCOUNT_ID:account_id,WRANGLER_SEND_METRICS:'false'}});
