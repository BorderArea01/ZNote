import {readFile,access,mkdir,realpath} from 'node:fs/promises';
import {resolve,dirname,relative,join,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createWriteStream} from 'node:fs';
import archiver from 'archiver';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const inside=(base,path)=>{const rel=relative(base,path);return !rel.startsWith('..'+sep)&&rel!=='..'&&!/^(?:[a-z]:|\/)/i.test(rel);};
const json=async path=>JSON.parse(await readFile(path,'utf8'));
export function extensionId(key){return createHash('sha256').update(Buffer.from(key,'base64')).digest('hex').slice(0,32).replace(/[0-9a-f]/g,c=>String.fromCharCode(97+parseInt(c,16)));}
export async function loadAddons(project=root){
  const browser=join(project,'addons/browser'),list=[];
  for(const [base,privateOnly]of [[browser,false],[join(browser,'private'),true]]){
    let catalog;try{catalog=await json(join(base,'catalog.json'));}catch(error){if(privateOnly&&error.code==='ENOENT')continue;throw error;}
    if(catalog.schemaVersion!==1||!Array.isArray(catalog.plugins))throw Error('不支持的插件目录格式');
    for(const entry of catalog.plugins){
      const file=resolve(base,entry);if(!inside(base,file)||(!privateOnly&&inside(join(browser,'private'),file)))throw Error('插件登记越出所属目录');
      const spec=await json(file),path=dirname(file),extension=resolve(path,spec.extension||'.');
      if(spec.schemaVersion!==1||!/^[a-z][a-z0-9-]{0,40}$/.test(spec.id)||typeof spec.name!=='string'||!['public','private'].includes(spec.visibility)||privateOnly!==(spec.visibility==='private')||!inside(path,extension)||list.some(p=>p.id===spec.id))throw Error('插件登记无效或编号重复：'+entry);
      const actualBase=await realpath(path),actualExtension=await realpath(extension).catch(()=>extension);
      if(!inside(actualBase,actualExtension))throw Error('插件加载目录越出自身目录');
      list.push({...spec,path,extension,file});
    }
  }
  return list;
}
export async function checkAddon(addon){
  const manifest=await json(join(addon.extension,'manifest.json'));
  if(manifest.manifest_version!==3||!/^\d+(?:\.\d+){0,3}$/.test(manifest.version)||manifest.version.split('.').some(n=>Number(n)>65535))throw Error(addon.id+'：扩展版本无效');
  if(!manifest.key)throw Error(addon.id+'：缺少固定扩展公钥');
  const id=extensionId(manifest.key);if(!addon.expectedId||id!==addon.expectedId)throw Error(addon.id+'：扩展 ID 与登记不一致，禁止覆盖安装');
  if(addon.visibility==='private'&&manifest.update_url)throw Error(addon.id+'：私人插件不能携带商店自动更新地址');
  const files=[...(addon.assets||[]),manifest.background?.service_worker,manifest.action?.default_popup,manifest.options_page,manifest.options_ui?.page,...Object.values(manifest.icons||{}),...(manifest.content_scripts||[]).flatMap(s=>[...(s.js||[]),...(s.css||[])])].filter(Boolean);
  for(const file of files){const path=resolve(addon.extension,file);if(!inside(addon.extension,path))throw Error(addon.id+'：资源路径越界');await access(path);}
  return {id:addon.id,name:addon.name,visibility:addon.visibility,version:manifest.version_name||manifest.version,extensionId:id,path:addon.extension,capabilities:addon.capabilities||[]};
}
async function build(addon,pack=false){
  let current;try{current=await json(join(addon.extension,'manifest.json'));}catch(error){if(error.code!=='ENOENT')throw error;}
  if(current&&extensionId(current.key||'')!==addon.expectedId)throw Error('现有扩展 ID 与登记不一致，构建已停止：'+addon.id);
  const cwd=resolve(addon.path,addon.build?.cwd||'.');if(!inside(root,cwd))throw Error('构建目录必须位于当前项目');
  const pkg=await json(join(cwd,'package.json'));if(!pkg.scripts?.[addon.build?.script])throw Error('插件没有登记有效构建命令');
  const npm=process.env.npm_execpath;if(!npm)throw Error('请通过 npm run addons -- build/pack 调用');
  await new Promise((yes,no)=>{const child=spawn(process.execPath,[npm,'run',addon.build.script,'--',...(pack?[]:['--no-pack'])],{cwd,stdio:'inherit',windowsHide:true});child.once('error',no);child.once('exit',code=>code===0?yes():no(Error('插件构建失败：'+addon.id)));});
  return checkAddon(addon);
}
async function main(){
  const [command='list',target,...flags]=process.argv.slice(2),addons=await loadAddons(),selected=!target||target==='all'||target==='--json'?addons:addons.filter(p=>p.id===target);
  if(!selected.length)throw Error('没有找到插件：'+target);
  if(!['list','check','build','pack'].includes(command))throw Error('用法：npm run addons -- list | check [id] | build <id> | pack <id>');
  if(['build','pack'].includes(command)&&(!target||target==='all'))throw Error('构建或打包请指定插件编号');
  const report=[];
  for(const addon of selected){
    try{
      const info=command==='list'||command==='check'?await checkAddon(addon):await build(addon,command==='pack');
      if(command==='pack'&&addon.visibility==='public'){
        const folder=join(root,'artifacts/browser-addons');await mkdir(folder,{recursive:true});const output=join(folder,addon.id+'-'+info.version+'.zip');
        const stream=createWriteStream(output),zip=archiver('zip',{zlib:{level:6}}),done=new Promise((yes,no)=>{stream.once('close',yes);stream.once('error',no);zip.once('error',no);zip.once('warning',no);});zip.pipe(stream);zip.directory(addon.extension,false);await zip.finalize();await done;info.package=output;
      }
      report.push({...info,status:'ok'});
    }catch(error){report.push({id:addon.id,name:addon.name,visibility:addon.visibility,status:'error',error:error.message});if(command!=='list')process.exitCode=1;}
  }
  if(flags.includes('--json')||target==='--json')console.log(JSON.stringify(report,null,2));else for(const p of report)console.log(`${p.status==='ok'?'✓':'!'} ${p.id} · ${p.name} · ${p.visibility} · ${p.version||p.error}\n  ${p.path||''}${p.package?'\n  '+p.package:''}`);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
