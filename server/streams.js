import multer from "multer";
import { randomUUID } from "node:crypto";
import { createWriteStream, createReadStream } from "node:fs";
import { mkdtemp, unlink, readFile, rename, rm, stat } from "node:fs/promises";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { resolve, join, dirname } from "node:path";
import { mediaTools, runMediaCommand } from "./imports.js";
import { MAX_VIDEO_BYTES } from "./videos.js";
const fail = (status, message) => Object.assign(new Error(message), { status });
const filename = /^(?:index|video|audio)\.m3u8$|^part-\d{1,4}\.bin$/;
const hlsCapabilities = new Map();
async function localSegmentOptions(command, signal) {
  if (hlsCapabilities.has(command)) return hlsCapabilities.get(command);
  const help = await runMediaCommand(command, ['-hide_banner', '-h', 'demuxer=hls'], {signal, timeout:10000});
  const options = [];
  // Our validated packages deliberately use synthetic .bin names. FFmpeg 7.1+
  // added suffix/format matching; keep the media-format and local-file whitelists below.
  // https://ffmpeg.org/pipermail/ffmpeg-cvslog/2025-February/147263.html
  if (/\bextension_picky\b/.test(help)) options.push('-extension_picky', '0');
  if (/\ballowed_segment_extensions\b/.test(help)) options.push('-allowed_segment_extensions', 'ALL');
  if (hlsCapabilities.size >= 4) hlsCapabilities.clear();
  hlsCapabilities.set(command, options);
  return options;
}
export function validatePlaylist(text, names, name = "index.m3u8") {
  if (!text.startsWith("#EXTM3U") || text.length > 2 * 1024 * 1024)
    throw fail(400, "播放列表格式不正确");
  const master = text.includes("#EXT-X-STREAM-INF:");
  let variant = false;
  if (master && name !== "index.m3u8") throw fail(400, "不支持嵌套主播放列表");
  if (!master && !text.split(/\r?\n/).includes("#EXT-X-ENDLIST"))
    throw fail(400, "仅支持完整点播播放列表");
  for (const line of text.split(/\r?\n/).map((l) => l.trim())) {
    if (!line) continue;
    if (!line.startsWith("#")) {
      if (
        !names.has(line) ||
        !(variant ? /^(video|audio)\.m3u8$/ : /^part-\d{1,4}\.bin$/).test(line)
      )
        throw fail(400, "播放列表引用了包外文件或无效媒体类型");
      variant = false;
      continue;
    }
    if (line.startsWith("#EXT-X-STREAM-INF:")) variant = true;
    if (
      /#EXT-X-(?:DEFINE|CONTENT-STEERING|SESSION|I-FRAME|RENDITION|PRELOAD|PART)/.test(
        line,
      )
    )
      throw fail(400, "不支持该播放列表指令");
    if (
      line.startsWith("#EXT-X-KEY:") &&
      (!/METHOD=(?:AES-128|NONE)(?:,|$)/.test(line) ||
        /KEYFORMAT=(?!"identity")/.test(line))
    )
      throw fail(400, "不支持受保护的加密格式");
    // Only generated local names may appear in URI attributes. No file/HTTP/concat escape.
    for (const match of line.matchAll(/\bURI=([^,]*)/g)) {
      if (!/^"[^"]+"$/.test(match[1]))
        throw fail(400, "播放列表 URI 格式不正确");
      const reference = match[1].slice(1, -1);
      const media = line.startsWith("#EXT-X-MEDIA:");
      if (
        (media && !master) ||
        !/^#EXT-X-(KEY|MAP|MEDIA):/.test(line) ||
        !(media ? /^(video|audio)\.m3u8$/ : /^part-\d{1,4}\.bin$/).test(
          reference,
        ) ||
        !names.has(reference)
      )
        throw fail(400, "播放列表引用了包外文件");
    }
  }
}
export function registerStreamRoutes(app, { dataDir, saveVideo }) {
  const root = resolve(dataDir, "uploads");
  let active = 0;
  const storage = {
    _handleFile(req, file, cb) {
      const path = join(root, randomUUID());
      let size = 0;
      const limit = new Transform({
        transform(chunk, enc, done) {
          req.streamBytes = (req.streamBytes || 0) + chunk.length;
          size += chunk.length;
          if (req.streamBytes > MAX_VIDEO_BYTES)
            return done(fail(413, "分片合计超过 500 MB"));
          done(null, chunk);
        },
      });
      pipeline(
        file.stream,
        limit,
        createWriteStream(path, { flags: "wx" }),
      ).then(
        () => cb(null, { path, size, filename: file.originalname }),
        async (e) => {
          await unlink(path).catch(() => {});
          cb(e);
        },
      );
    },
    _removeFile(req, file, cb) {
      unlink(file.path).then(() => cb(), cb);
    },
  };
  const upload = multer({
    storage,
    limits: {
      files: 1203,
      fileSize: MAX_VIDEO_BYTES,
      fields: 5,
      fieldSize: 8192,
      parts: 1209,
    },
  });
  app.post(
    "/api/streams",
    (req, res, next) => {
      if (active >= 1)
        return res
          .status(429)
          .json({ error: "已有一个分段视频正在处理，请稍后重试" });
      active++;
      let released = false;
      const release = () => {
        if (!released) {
          released = true;
          active--;
        }
      };
      req.releaseStream = release;
      upload.array("files", 1203)(req, res, (error) => {
        if (error) {
          release();
          return next(error);
        }
        next();
      });
    },
    async (req, res) => {
      let dir;
      const abort = new AbortController();
      const closed = () => {
        if (!res.writableFinished) abort.abort();
      };
      res.on("close", closed);
      try {
        const mode = req.query.mode || "save";
        if (!["save", "download"].includes(mode))
          throw fail(400, "操作模式不正确");
        const names = new Set();
        for (const file of req.files || []) {
          if (!filename.test(file.originalname) || names.has(file.originalname))
            throw fail(400, "分片文件名不正确或重复");
          names.add(file.originalname);
        }
        if (!names.has("index.m3u8")) throw fail(400, "缺少主播放列表");
        dir = await mkdtemp(join(root, "stream-"));
        for (const file of req.files) {
          if (file.originalname.endsWith(".m3u8")) {
            if (file.size > 2 * 1024 * 1024) throw fail(400, "播放列表过大");
            validatePlaylist(
              await readFile(file.path, "utf8"),
              names,
              file.originalname,
            );
          }
          const target = join(dir, file.originalname);
          await rename(file.path, target);
          file.path = target;
        }
        const output = join(dir, "output.mp4");
        const ffmpeg = mediaTools().ffmpeg;
        const segmentOptions = await localSegmentOptions(ffmpeg, abort.signal);
        try {
          await runMediaCommand(
            ffmpeg,
            [
              "-hide_banner",
              "-loglevel",
              "error",
              "-nostdin",
              "-protocol_whitelist",
              "file,crypto",
              "-allowed_extensions",
              "ALL",
              ...segmentOptions,
              "-seg_format_options",
              "format_whitelist=mpegts,mov,aac,mp3,ac3,eac3,flac",
              "-i",
              join(dir, "index.m3u8"),
              "-map",
              "0:v:0",
              "-map",
              "0:a:0?",
              "-c",
              "copy",
              "-movflags",
              "+faststart",
              "-fs",
              String(MAX_VIDEO_BYTES + 1),
              output,
            ],
            { signal: abort.signal, timeout: 120000 },
          );
        } catch (e) {
          if (e.status === 422)
            throw fail(
              415,
              "分片合并失败，请检查视频是否完整、编码是否支持 MP4 封装",
            );
          throw e;
        }
        if ((await stat(output)).size > MAX_VIDEO_BYTES)
          throw fail(413, "合并后视频超过 500 MB");
        if (mode === "save") {
          const item = await saveVideo(
            { path: output, originalname: "网页视频.mp4" },
            req.body,
          );
          res.status(item.duplicate ? 200 : 201).json(item);
        } else {
          res.attachment("znote-video.mp4").type("video/mp4");
          await pipeline(createReadStream(output), res);
        }
      } finally {
        res.off("close", closed);
        await Promise.all(
          (req.files || []).map((file) => unlink(file.path).catch(() => {})),
        );
        try {
          if (dir && dirname(dir) === root)
            await rm(dir, { recursive: true, force: true });
        } finally {
          req.releaseStream();
        }
      }
    },
  );
}
