import { build } from "esbuild";
import { copyFile, readFile, readdir, writeFile } from "node:fs/promises";
await build({
  entryPoints: ["extensions/clipper/article-source.js"],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "chrome120",
  outfile: "extensions/clipper/vendor/article-extract.js",
  minify: true,
  legalComments: "eof",
});
const pageBundle=await build({entryPoints:['extensions/clipper/article.js'],bundle:true,format:'esm',platform:'browser',target:'chrome120',
  outfile:'extensions/clipper/vendor/article-page.js',minify:true,legalComments:'eof',metafile:true});
const packages=[...new Set(Object.keys(pageBundle.metafile.inputs).map(path=>path.match(/node_modules\/((?:@[^/]+\/)?[^/]+)\//)?.[1]).filter(Boolean))].sort();
const notices=[];
for(const name of packages){
  const base='node_modules/'+name, info=JSON.parse(await readFile(base+'/package.json','utf8'));
  const files=(await readdir(base)).filter(file=>/^(license|licence|copying)(\.|$)/i.test(file));
  if(!files.length)throw Error('Bundled dependency license missing: '+name);
  notices.push(`${name} ${info.version}\n${(await Promise.all(files.map(file=>readFile(base+'/'+file,'utf8')))).join('\n')}`);
}
await writeFile('extensions/clipper/vendor/markdown-LICENSES.txt',notices.join('\n\n---\n\n'));
for (const [src, dest] of [
  ["@mozilla/readability/LICENSE.md", "readability-LICENSE.md"],
  ["turndown/LICENSE", "turndown-LICENSE"],
  ["turndown-plugin-gfm/LICENSE", "turndown-gfm-LICENSE"],
])
  await copyFile("node_modules/" + src, "extensions/clipper/vendor/" + dest);
