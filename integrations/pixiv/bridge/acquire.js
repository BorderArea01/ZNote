// GPL-3.0-or-later. Resolve one explicitly selected work without resetting PPD's crawl.
import { normalize } from "./records.js";
import {request, requestError, responseJSON} from './retry.js';
async function json(path, signal) {
  const r = await request("https://www.pixiv.net/ajax/" + path, {
    credentials: "include",
    redirect: "error",
    signal,
  });
  if (!r.ok) throw requestError(`Pixiv HTTP ${r.status}，请检查登录与网络`,r);
  const data = await responseJSON(r,signal);
  if (data.error || !data.body) throw Error(data.message || "作品暂时无法访问");
  return data.body;
}
export async function acquire(work, signal) {
  const novel = work.type === "novel",
    body = await json(`${novel ? "novel" : "illust"}/${work.id}`, signal);
  const base = {
    idNum: work.id,
    id: work.id,
    type: novel ? 3 : body.illustType,
    title: body.title,
    description: body.description,
    user: body.userName,
    userId: body.userId,
    tags: (body.tags?.tags || []).map((t) => t.tag),
    date: body.createDate,
    pageCount: body.pageCount || 1,
  };
  if (novel) {
    const embeddedImages = Object.fromEntries(
      Object.entries(body.textEmbeddedImages || {}).map(([id, image]) => [
        id,
        image.urls?.original || image.urls?.["1200x1200"],
      ]),
    );
    return [
      normalize({
        ...base,
        novelMeta: {
          content: body.content,
          userName: body.userName,
          coverUrl: body.coverUrl,
          embeddedImages,
        },
      }),
    ];
  }
  if (base.type === 2) {
    const meta = await json(`illust/${work.id}/ugoira_meta`, signal);
    return [
      normalize({
        ...base,
        original: meta.originalSrc || meta.src,
        regular: body.urls?.regular,
        ugoiraInfo: meta,
      }),
    ];
  }
  const pages = await json(`illust/${work.id}/pages`, signal);
  if (!Array.isArray(pages) || !pages.length || pages.length > 10000)
    throw Error("作品页数无效或超过 10000 张");
  return pages.map((p, index) =>
    normalize({
      ...base,
      index,
      pageCount: pages.length,
      original: p.urls.original,
      regular: p.urls.regular || p.urls.small,
    }),
  );
}
