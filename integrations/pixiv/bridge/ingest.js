// GPL-3.0-or-later. Shared by the background queue and optional task manager.
import { api, media, details, upload, novelBody } from "./client.js";
import { animation } from "./animation.js";
export async function ingestRecord(
  connection,
  r,
  target,
  signal,
  setUploading = () => {},
) {
  const fields = details(r, target);
  try {
    if (r.type === 3) {
      const body = await novelBody(
        r,
        async (blob, url) => {
          setUploading(true);
          try {
            return await upload(
              connection,
              blob,
              {
                ...fields,
                title: (r.title + " · 配图").slice(0, 200),
                content: fields.content,
              },
              "novel-image.png",
            );
          } finally {
            setUploading(false);
          }
        },
        signal,
      );
      signal.throwIfAborted();
      setUploading(true);
      return await api(connection, "/api/pixiv/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...fields,
          content: body + "\n\n---\n\n" + fields.content,
        }),
      });
    }
    let blob = await media(
      r.original,
      signal,
      r.type === 2 ? 50 * 1024 * 1024 : undefined,
    );
    if (r.type === 2) {
      blob = await animation(blob, r.frames, signal);
      fields.content +=
        "\n\n动图入库格式：APNG（逐帧保留像素与时序）；原 ZIP 下载地址见上方。";
    }
    signal.throwIfAborted();
    setUploading(true);
    return await upload(
      connection,
      blob,
      fields,
      `${r.id}_p${r.index}.${r.type === 2 ? "png" : new URL(r.original).pathname.split(".").pop()}`,
    );
  } finally {
    setUploading(false);
  }
}
