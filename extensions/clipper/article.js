import { api, settings, serverUrl, limitedImage } from "./client.js";
const $ = (id) => document.getElementById(id);
let article, saved;
try {
  const tabId = Number(new URL(location.href).searchParams.get("tab"));
  if (!Number.isInteger(tabId))
    throw new Error("请从文章所在标签页打开正文采集");
  const result = await chrome.tabs.sendMessage(
    tabId,
    { type: "extract-article" },
    { frameId: 0 },
  );
  if (!result?.ok)
    throw new Error(result?.error || "无法读取页面，请刷新文章后重试");
  article = result.article;
  $("title").value = article.title;
  $("content").value = article.content;
  $("source").href = article.source_url;
  const config = await settings(),
    collections = await api("/api/collections");
  $("collection").replaceChildren(
    new Option("未分类", ""),
    ...collections.map((c) => new Option(c.name, c.id)),
  );
  $("collection").value = config.collection_id;
  $("tags").value = config.tags;
  $("save").disabled = false;
  $("status").textContent =
    `正文已提取，发现 ${article.images.length} 张配图；可编辑后保存。`;
} catch (e) {
  $("status").textContent = e.message;
}
$("save").addEventListener("click", async () => {
  if (!article) return;
  $("save").disabled = true;
  try {
    const title = $("title").value.trim(),
      tags = $("tags")
        .value.split(/[,，]/)
        .map((s) => s.trim())
        .filter(Boolean),
      collection_id = $("collection").value || null;
    if (!title) throw new Error("请输入标题");
    if (tags.length >= 30) throw new Error("请为来源网站标签留出一个位置");
    let content = $("content").value;
    if (content.length > 480000) throw new Error("正文过长，请分段保存");
    const warnings = [];
    let bytes = 0,
      archived = 0;
    if ($("archive-images").checked) {
      const selected = article.images.filter((url) => content.includes(url));
      for (const [index, url] of selected.entries()) {
        if (index >= 30) {
          warnings.push(`超过配图数量上限：${url}`);
          continue;
        }
        $("status").textContent =
          `正在保存配图 ${index + 1} / ${selected.length}…`;
        try {
          const blob = await limitedImage(url);
          bytes += blob.size;
          if (bytes > 100 * 1024 * 1024) {
            warnings.push(
              ...selected
                .slice(index)
                .map((value) => `超过配图容量上限：${value}`),
            );
            break;
          }
          const form = new FormData();
          form.set("file", blob, "正文配图");
          form.set("title", `${title} · 配图 ${index + 1}`.slice(0, 200));
          form.set("content", `正文配图\n\n图片地址：${url}`);
          form.set("source_url", article.source_url);
          form.set("tags", JSON.stringify(tags));
          if (collection_id) form.set("collection_id", collection_id);
          const item = await api("/api/assets", { method: "POST", body: form });
          content = content.replaceAll(
            `(<${url.replace(/>/g, "%3E")}>)`,
            `(${item.url})`,
          );
          archived++;
        } catch (e) {
          warnings.push(`${url}：${e.message}`);
        }
      }
    }
    if (warnings.length)
      content +=
        "\n\n---\n\n配图归档提示（未归档图片保留原网址）：\n" +
        warnings.map((s) => "- " + s).join("\n");
    $("content").value = content;
    saved = await api("/api/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        content,
        tags,
        collection_id,
        source_url: article.source_url,
      }),
    });
    $("open").href =
      serverUrl((await settings()).server) + "/#item/" + saved.id;
    $("open").hidden = false;
    $("status").textContent =
      `图文笔记已保存，${archived} 张配图已归档${warnings.length ? "；部分配图未归档，原因已写入备注" : ""}`;
    $("save").textContent = "已保存";
  } catch (e) {
    $("status").textContent = e.message;
    $("save").disabled = false;
  }
});
