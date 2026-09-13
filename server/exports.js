import archiver from "archiver";
import { backup, DatabaseSync } from "node:sqlite";
import { mkdtemp, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import { finished } from 'node:stream/promises';
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { z } from "zod";
import { originalStream } from "./storage.js";

export const exportQuery = z.object({
  mode: z
    .enum(["portable", "images", "markdown", "json", "html", "backup"])
    .default("portable"),
  collection: z.string().optional(),
  include_trash: z.enum(["true", "false"]).default("true"),
  layout: z.enum(['readable', 'legacy']).default('readable'),
});
const ext = (item) =>
  ({
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/avif": "avif",
    "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov",
  })[item.mime] || "bin";
const escape = (text) =>
  String(text).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const fileName = (item) => `${item.id}.${ext(item)}`;
export const safeName = (value) => String(value).normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^[. ]+|[. ]+$/g, '').slice(0, 60).replace(/[. ]+$/g, '') || '未命名';
const urlPath = path => path.split('/').map(part => part === '..' ? part : encodeURIComponent(part).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16))).join('/');
export function validateExportQuery(db, input) {
  const query = exportQuery.parse(input);
  if (query.mode === 'backup' && query.collection) throw Object.assign(Error('完整备份不支持按知识库筛选'), {status:400});
  if (query.collection && query.collection !== 'unfiled' && !db.prepare('SELECT id FROM collections WHERE id=?').get(query.collection)) throw Object.assign(Error('知识库不存在'), {status:404});
  return query;
}
export async function exportContent({ db, dir, req, res, serialize, progress = () => {}, readOriginal = originalStream }) {
  const query = exportQuery.parse(req.query);
  if (query.mode === "backup" && query.collection)
    throw Object.assign(new Error("完整备份不支持按知识库筛选"), {
      status: 400,
    });
  const all = query.mode === 'backup' ? [] : db.prepare("SELECT * FROM items").all();
  const allCollections = query.mode === 'backup' ? [] : db.prepare("SELECT * FROM collections").all();
  if (
    query.collection &&
    query.collection !== "unfiled" &&
    !allCollections.some((c) => c.id === query.collection)
  )
    throw Object.assign(new Error("知识库不存在"), { status: 404 });
  const collections = query.collection
    ? allCollections.filter((c) => c.id === query.collection)
    : allCollections;
  const selected = all.filter(
    (i) =>
      (query.mode !== 'images' || i.kind === 'image') &&
      (!query.collection ||
        (query.collection === "unfiled"
          ? !i.collection_id
          : i.collection_id === query.collection)) &&
      (query.include_trash === "true" || !i.deleted_at),
  );
  const notes = selected.filter((i) => i.kind === "note");
  const selectedIds = new Set(selected.map(i => i.id));
  const referencedIds = new Set(notes.flatMap(n => [...n.content.matchAll(/\/media\/([^/\s]+)\//g)].map(m => m[1])));
  const images = all.filter(
    (i) =>
      ['image', 'video'].includes(i.kind) &&
      (selectedIds.has(i.id) ||
        (query.mode !== "images" &&
          referencedIds.has(i.id))),
  );
  const items = [
    ...new Map([...selected, ...images].map((i) => [i.id, i])).values(),
  ];
  const paths = new Map();
  const used = new Set();
  for (const item of items) {
    const collection = allCollections.find(c => c.id === item.collection_id);
    const folder = collection ? `${safeName(collection.name)}-${collection.id.slice(0,8)}` : '未分类';
    const suffix = item.kind !== 'note' ? ext(item) : 'md';
    const title = safeName(item.title.replace(/\.(png|jpe?g|webp|gif|avif|mp4|webm|mov|md)$/i, ''));
    let path = query.layout === 'legacy'
      ? item.kind !== 'note' ? `${item.kind === 'video' ? 'videos' : 'images'}/${fileName(item)}` : `notes/${item.id}.md`
      : `${folder}/${item.kind === 'image' ? '图片' : item.kind === 'video' ? '视频' : '笔记'}/${title}-${item.id.slice(0,8)}.${suffix}`;
    if (used.has(path.toLocaleLowerCase())) path = path.replace(`-${item.id.slice(0,8)}.`, `-${item.id}.`);
    used.add(path.toLocaleLowerCase());
    paths.set(item.id, path);
  }
  const imagePath = item => paths.get(item.id);
  const manifest = {
    version: 2,
    mode: query.mode,
    exported_at: new Date().toISOString(),
    collections,
    items: items.map(item => ({ ...serialize(item), file: paths.get(item.id) })),
    attachment_ids: images
      .filter((i) => !selectedIds.has(i.id))
      .map((i) => i.id),
  };
  if (query.mode === "json") {
    res.attachment("znote-metadata.json");
    return res.json(manifest);
  }
  res.attachment(
    `znote-${query.mode}-${new Date().toISOString().slice(0, 10)}.zip`,
  );
  const archive = archiver("zip", { zlib: { level: 6 } });
  const delivered=finished(res);delivered.catch(()=>{});
  let processedEntries=0;
  archive.on('entry',()=>processedEntries++);
  let rejectFailure;
  const failure = new Promise((resolve, reject) => { rejectFailure = reject; });
  failure.catch(() => {});
  const streams = new Set();
  const stopStreams = () => {
    for (const stream of streams) stream.destroy();
  };
  archive.on("error", (error) => {
    rejectFailure(error);
    stopStreams();
    res.destroy(error);
  });
  // A missing file must fail the download, never yield a silently incomplete backup.
  archive.on("warning", error => archive.destroy(error));
  archive.on('progress', value => progress({entries:value.entries.processed, bytes:archive.pointer()}));
  const appendMedia = async (stream, name) => {
    streams.add(stream);
    let done;
    const entry = new Promise(resolve => { done = value => { if(value.name === name) resolve(); }; archive.on('entry', done); });
    stream.on('error', error => archive.destroy(error));
    try {
      // Archiver pipes appended streams immediately. Wait for each entry before
      // appending another, so decompression and open originals remain bounded.
      archive.append(stream, {name});
      await Promise.race([entry, failure]);
    } finally { archive.off('entry', done); stream.destroy(); streams.delete(stream); }
  };
  res.on("close", () => {
    if (!res.writableFinished) rejectFailure(Object.assign(new Error('Export stream closed before completion'), { status: 499 }));
    stopStreams();
    archive.abort();
  });
  let temp;
  try {
    if (query.mode === "backup") {
      // Media references are read from the completed snapshot. Originals are
      // immutable and written before rows commit, so concurrent writes are safe.
      temp = await mkdtemp(join(tmpdir(), "znote-backup-"));
      await backup(db, join(temp, "znote.sqlite"));
    }
    archive.pipe(res);
    if (query.mode === "backup") {
      archive.file(join(temp, "znote.sqlite"), { name: "data/znote.sqlite" });
      const snapshot = new DatabaseSync(join(temp, "znote.sqlite"), { readOnly: true });
      let snapshotImages;
      try { snapshotImages = snapshot.prepare("SELECT * FROM items WHERE kind IN ('image','video')").all(); }
      finally { snapshot.close(); }
      const archivedKeys = new Set();
      for (const item of snapshotImages) {
        if (archivedKeys.has(item.file_key)) continue;
        archivedKeys.add(item.file_key);
        archive.file(join(dir, "media", item.file_key), {
          name: `data/media/${item.file_key}`,
        });
        if (item.thumbnail_key)
          archive.file(join(dir, "media", item.thumbnail_key), {
            name: `data/media/${item.thumbnail_key}`,
          });
      }
      archive.append(
        "ZNote 0.4: Upload this ZIP in Settings > Backup and restore to preview and restore it. A pre-restore backup is created automatically. Alternatively stop the target service, extract data/ into a new directory, set DATA_DIR to that directory and start ZNote 0.4 or a compatible later version. Includes password/API token hashes and Webhook signing secrets. Keep this backup private.\n",
        { name: "RESTORE.txt" },
      );
    } else {
      const markdown = (content, note) =>
        images.reduce(
          (text, image) =>
            text
              .replaceAll(
                `/media/${image.id}/original`,
                urlPath(posix.relative(posix.dirname(paths.get(note.id)), imagePath(image))),
              )
              .replaceAll(
                `/media/${image.id}/thumbnail`,
                urlPath(posix.relative(posix.dirname(paths.get(note.id)), imagePath(image))),
              ),
          content,
        );
      if (query.mode !== "images")
        archive.append(JSON.stringify(manifest, null, 2), {
          name: "manifest.json",
        });
      const imageItems =
        query.mode === "markdown"
          ? images.filter((i) =>
              referencedIds.has(i.id),
            )
          : images;
      for (const item of imageItems) {
        const stream = readOriginal(dir, item);
        await appendMedia(stream, imagePath(item));
        if (query.layout === 'readable') archive.append(JSON.stringify({ ...serialize(item), file: imagePath(item) }, null, 2), { name: imagePath(item) + '.json' });
      }
      if (["portable", "markdown"].includes(query.mode))
        for (const note of notes)
          archive.append(markdown(note.content, note), {
            name: paths.get(note.id),
          });
      if (query.mode === "images")
        archive.append(
          JSON.stringify(
            {
              version: 2,
              images: images.map((i) => ({
                ...serialize(i),
                file: imagePath(i),
              })),
            },
            null,
            2,
          ),
          { name: "images.json" },
        );
      if (query.mode === "html") {
        const articles = selected
          .map((item) => {
            const body =
              item.kind === "image"
                ? `<img src="${urlPath(imagePath(item))}" alt="${escape(item.title)}"><p>${escape(item.content)}</p>`
                : item.kind === 'video'
                  ? `<video controls preload="metadata" style="max-width:100%" src="${urlPath(imagePath(item))}"></video><p>${escape(item.content)}</p>`
                : renderToStaticMarkup(
                    React.createElement(
                      ReactMarkdown,
                      {
                        remarkPlugins: [remarkGfm],
                        skipHtml: true,
                        components: {
                          img: ({ src, alt }) => {
                            const image = images.find((i) =>
                              src?.startsWith(`/media/${i.id}/`),
                            );
                            return image
                              ? React.createElement("img", {
                                  src: urlPath(imagePath(image)),
                                  alt: alt || "",
                                })
                              : React.createElement(
                                  "span",
                                  {},
                                  "外部图片未打包",
                                );
                          },
                        },
                      },
                      item.content,
                    ),
                  );
            return `<article id="${item.id}"><h2>${escape(item.title)}</h2><p class="tags">${JSON.parse(
              item.tags,
            )
              .map((t) => "# " + escape(t))
              .join(" · ")}</p>${body}</article>`;
          })
          .join("\n");
        archive.append(
          `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ZNote 离线知识库</title><style>body{font:16px/1.8 system-ui,sans-serif;background:#f5f7f2;color:#293b30;max-width:1000px;margin:40px auto;padding:0 20px}article{background:white;border:1px solid #dfe5da;border-radius:12px;padding:24px;margin:20px 0;overflow-wrap:anywhere}img{max-width:100%;max-height:700px;object-fit:contain}.tags{color:#78906b}pre{overflow:auto;background:#f1f4ed;padding:15px}table{border-collapse:collapse}td,th{border:1px solid #aaa;padding:6px}a{color:#287464}</style><h1>ZNote · 离线知识库</h1><p>导出 ${selected.length} 项内容，解压后可直接浏览。</p>${articles}</html>`,
          { name: "index.html" },
        );
      }
    }
    // Archiver may leave finalize() pending after destroy()/abort(). Always
    // observe the error/closed stream too, so callers release their job locks.
    await Promise.race([archive.finalize(), failure]);
    await Promise.race([delivered, failure]);
    progress({entries:processedEntries,bytes:archive.pointer()});
  } finally {
    if (temp) {
      await unlink(join(temp, "znote.sqlite")).catch(() => {});
      await rmdir(temp).catch(() => {});
    }
  }
}
