import { build } from "esbuild";
import { copyFile } from "node:fs/promises";
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
for (const [src, dest] of [
  ["@mozilla/readability/LICENSE.md", "readability-LICENSE.md"],
  ["turndown/LICENSE", "turndown-LICENSE"],
  ["turndown-plugin-gfm/LICENSE", "turndown-gfm-LICENSE"],
])
  await copyFile("node_modules/" + src, "extensions/clipper/vendor/" + dest);
