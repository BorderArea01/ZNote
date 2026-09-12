import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

function extract() {
  if (document.getElementsByTagName("*").length > 50000)
    throw new Error("此页面内容过多，请打开单篇文章后采集");
  const clone = document.cloneNode(true);
  const originals = [...document.images];
  [...clone.images].forEach((img, index) => {
    const original = originals[index];
    if (
      original?.currentSrc &&
      !img.getAttribute("data-original") &&
      !img.getAttribute("data-src")
    )
      img.setAttribute("src", original.currentSrc);
  });
  clone
    .querySelectorAll(
      '[data-znote-overlay],script,style,iframe,form,input,button,nav,[hidden],[aria-hidden="true"]',
    )
    .forEach((el) => el.remove());
  const urlFor = (value, image = false) => {
    if (typeof value !== "string" || !value.trim()) return null;
    try {
      const url = new URL(value, document.baseURI);
      return (image ? /^https?:$/ : /^(https?:|mailto:)$/).test(url.protocol) &&
        !url.username &&
        !url.password
        ? url.href
        : null;
    } catch {
      return null;
    }
  };
  for (const img of clone.querySelectorAll("img")) {
    const url = urlFor(
      img.getAttribute("data-original") ||
        img.getAttribute("data-src") ||
        img.getAttribute("src"),
      true,
    );
    if (url) {
      img.setAttribute("src", url);
      img.removeAttribute("srcset");
    } else img.remove();
  }
  for (const link of clone.querySelectorAll("a")) {
    const href = urlFor(link.getAttribute("href"));
    if (href) link.setAttribute("href", href);
    else link.removeAttribute("href");
  }
  const article = new Readability(clone, {
    charThreshold: 100,
    maxElemsToParse: 50000,
    keepClasses: false,
  }).parse();
  if (!article?.textContent?.trim())
    throw new Error(
      "未找到可采集的正文，请打开文章详情页；动态页面需先展开正文",
    );
  const converter = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
  });
  converter.use(gfm);
  converter.remove([
    "script",
    "style",
    "iframe",
    "form",
    "button",
    "input",
    "svg",
  ]);
  const images = [];
  converter.addRule("archiveImages", {
    filter: "img",
    replacement: (_content, node) => {
      const url = urlFor(node.getAttribute("src"), true);
      if (!url) return "";
      const alt = (node.getAttribute("alt") || "配图").replace(
        /[\[\]\\\n]/g,
        " ",
      );
      if (!images.includes(url)) images.push(url);
      return `![${alt}](<${url.replace(/>/g, "%3E")}>)`;
    },
  });
  const markdown = converter.turndown(article.content).trim();
  if (markdown.length > 480000) throw new Error("正文超过笔记容量，请分段采集");
  return {
    title: (article.title || document.title || "网页正文").slice(0, 200),
    content: markdown,
    source_url: location.href,
    images,
    byline: article.byline || "",
    excerpt: article.excerpt || "",
  };
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (
    sender.id !== chrome.runtime.id ||
    sender.url?.split("?")[0] !== chrome.runtime.getURL("article.html") ||
    message.type !== "extract-article"
  )
    return;
  try {
    reply({ ok: true, article: extract() });
  } catch (e) {
    reply({ ok: false, error: e.message });
  }
});
