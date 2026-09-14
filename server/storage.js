import { MAX_IMAGE_BYTES } from './image-limits.js';
import { gzip, gunzip, createGunzip } from "node:zlib";
import { promisify } from "node:util";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { readFile, writeFile, unlink, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import sharp from "sharp";

const compress = promisify(gzip),
  decompress = promisify(gunzip);
export const digest = (buffer) =>
  createHash("sha256").update(buffer).digest("hex");
export async function packOriginal(buffer) {
  const zipped = await compress(buffer, { level: 9 });
  // Lossless, byte-for-byte recoverable; never store a larger representation.
  return zipped.length < buffer.length
    ? { buffer: zipped, codec: "gzip" }
    : { buffer, codec: "identity" };
}
export function originalStream(dir, item) {
  // Open only when consumed. Large exports do not open every image at once.
  return Readable.from((async function* () {
    const stream = createReadStream(join(dir, "media", item.file_key));
    const decoded = item.storage_codec === "gzip" ? createGunzip() : stream;
    if (decoded !== stream) {
      stream.on("error", error => decoded.destroy(error));
      stream.pipe(decoded);
    }
    try { for await (const chunk of decoded) yield chunk; }
    finally { stream.destroy(); if (decoded !== stream) decoded.destroy(); }
  })());
}
export async function originalBuffer(dir, item) {
  const buffer = await readFile(join(dir, "media", item.file_key));
  return item.storage_codec === "gzip"
    ? decompress(buffer, { maxOutputLength: MAX_IMAGE_BYTES })
    : buffer;
}
export async function thumbnail(dir, item) {
  return sharp(await originalBuffer(dir, item), { limitInputPixels: 80000000 })
    .rotate()
    .resize({
      width: 800,
      height: 800,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 82 })
    .toBuffer();
}
export async function storageStats(db, dir) {
  const items = db
    .prepare(
      "SELECT coalesce(sum(bytes),0) source_bytes, coalesce(sum(stored_bytes),0) stored_bytes, coalesce(sum(kind='image'),0) images, coalesce(sum(kind='video'),0) videos FROM (SELECT kind,bytes,stored_bytes FROM items WHERE kind IN ('image','video') GROUP BY file_key)",
    )
    .get();
  let mediaBytes = 0,
    databaseBytes = 0;
  for (const name of await readdir(join(dir, "media")))
    mediaBytes += (await stat(join(dir, "media", name))).size;
  for (const name of ["znote.sqlite", "znote.sqlite-wal", "znote.sqlite-shm"]) {
    try {
      databaseBytes += (await stat(join(dir, name))).size;
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  }
  const total = mediaBytes + databaseBytes;
  return {
    ...items,
    image_entries: db.prepare("SELECT count(*) n FROM items WHERE kind='image'").get().n,
    video_entries: db.prepare("SELECT count(*) n FROM items WHERE kind='video'").get().n,
    media_bytes: mediaBytes,
    database_bytes: databaseBytes,
    total_bytes: total,
    media_saved_bytes: items.source_bytes - mediaBytes,
    total_saved_bytes: items.source_bytes - total,
    strategy: "lossless",
    thumbnails: "on-demand",
    note: "文件字节数，包含回收站；不含程序、备份和操作系统分配块开销。总大小可能因数据库开销高于原图。",
  };
}
// Offline maintenance only: stop the service and keep a full backup first.
export async function optimizeStorage(db, dir) {
  let optimized = 0,
    removedThumbnails = 0;
  for (const item of db
    .prepare("SELECT * FROM items WHERE kind='image' GROUP BY file_key")
    .all()) {
    const original = await originalBuffer(dir, item);
    if (digest(original) !== item.hash)
      throw new Error(`Original checksum mismatch for item ${item.id}`);
    const packed = await packOriginal(original);
    let newKey = item.file_key;
    if (packed.buffer.length < (item.stored_bytes ?? original.length)) {
      newKey = `${randomUUID()}.${packed.codec === "gzip" ? "gz" : "bin"}`;
      await writeFile(join(dir, "media", newKey), packed.buffer, {
        flag: "wx",
      });
      // Verify the file on disk before changing the DB pointer.
      const readback = await originalBuffer(dir, {
        file_key: newKey,
        storage_codec: packed.codec,
      });
      if (digest(readback) !== item.hash) {
        await unlink(join(dir, "media", newKey));
        throw new Error("Compressed original verification failed");
      }
    }
    try {
      db.prepare(
        "UPDATE items SET file_key=?,storage_codec=?,stored_bytes=?,thumbnail_key=NULL WHERE file_key=?",
      ).run(
        newKey,
        newKey === item.file_key ? item.storage_codec : packed.codec,
        newKey === item.file_key
          ? (item.stored_bytes ?? original.length)
          : packed.buffer.length,
        item.file_key,
      );
    } catch (e) {
      if (newKey !== item.file_key) await unlink(join(dir, "media", newKey));
      throw e;
    }
    if (newKey !== item.file_key) {
      await unlink(join(dir, "media", item.file_key));
      optimized++;
    }
    if (item.thumbnail_key && item.thumbnail_key !== item.file_key) {
      try {
        await unlink(join(dir, "media", item.thumbnail_key));
        removedThumbnails++;
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
    }
  }
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  return { optimized, removedThumbnails, ...(await storageStats(db, dir)) };
}
