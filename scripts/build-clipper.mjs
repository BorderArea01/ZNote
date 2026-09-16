import { build } from "esbuild";
import { copyFile, readFile, readdir, writeFile } from "node:fs/promises";
await build({
  entryPoints: ["addons/browser/clipper/article-source.js"],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "chrome120",
  outfile: "addons/browser/clipper/vendor/article-extract.js",
  minify: true,
  legalComments: "eof",
});
const pageBundle=await build({entryPoints:['addons/browser/clipper/article.js'],bundle:true,format:'esm',platform:'browser',target:'chrome120',
  outfile:'addons/browser/clipper/vendor/article-page.js',minify:true,legalComments:'eof',metafile:true});
const packages=[...new Set(Object.keys(pageBundle.metafile.inputs).map(path=>path.match(/node_modules\/((?:@[^/]+\/)?[^/]+)\//)?.[1]).filter(Boolean))].sort();
const notices=[];
for(const name of packages){
  const base='node_modules/'+name, info=JSON.parse(await readFile(base+'/package.json','utf8'));
  const files=(await readdir(base)).filter(file=>/^(license|licence|copying)(\.|$)/i.test(file));
  if(!files.length)throw Error('Bundled dependency license missing: '+name);
  notices.push(`${name} ${info.version}\n${(await Promise.all(files.map(file=>readFile(base+'/'+file,'utf8')))).join('\n')}`);
}
await writeFile('addons/browser/clipper/vendor/markdown-LICENSES.txt',notices.join('\n\n---\n\n'));
for (const [src, dest] of [
  ["@mozilla/readability/LICENSE.md", "readability-LICENSE.md"],
  ["turndown/LICENSE", "turndown-LICENSE"],
  ["turndown-plugin-gfm/LICENSE", "turndown-gfm-LICENSE"],
])
  await copyFile("node_modules/" + src, "addons/browser/clipper/vendor/" + dest);

await copyFile('shared/video-details.js','addons/browser/clipper/video-details.js');
await copyFile('shared/gallery-group.js','addons/browser/clipper/gallery-group.js');
// Keep the page-world parser and observer in one entry, independent of the
// isolated-world loader and its globals.
await writeFile('addons/browser/clipper/vendor/douyin-network.js',
  (await readFile('addons/browser/clipper/douyin-records.js','utf8'))+'\n'+
  (await readFile('addons/browser/clipper/douyin-network.js','utf8')));
