import React, { useState, useEffect, useRef, useCallback } from "react";
import { version as packageVersion } from '../package.json';
import {
  Search,
  Plus,
  Image,
  FileText,
  Layers,
  Star,
  Trash2,
  Settings,
  Upload,
  ArrowUpRight,
  X,
  Check,
  ChevronRight,
  LayoutGrid,
  List,
  Menu,
  FolderPlus,
  BookOpen,
  RefreshCw,
  Code2,
  Loader2,
  MoreHorizontal,
  Download,
  Home,
  Moon,
  Sun,
  Hash,
  Film,
} from "lucide-react";
import { api, send, uploadFile } from "./api.js";
import { HelpHint } from './HelpHint.jsx';
import { IconButton } from "./ui.jsx";
import { UploadDialog, ExportDialog, BatchTagsDialog } from "./features.jsx";
import { OrganizeDialog } from './organize.jsx';
import { TagFilter } from './TagFilter.jsx';
import { ImportsDialog } from './Imports.jsx';
const labels = {
  home: "我的知识库",
  all: "全部内容",
  images: "图片素材",
  videos: '视频素材',
  notes: "图文笔记",
  favorites: "我的收藏",
  trash: "回收站",
};
const icons = { all: Layers, images: Image, videos: Film, notes: FileText, favorites: Star };
const date = (d) =>
  new Date(d).toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
export default function Workspace({
  theme,
  resolvedTheme,
  setTheme,
  onLogout,
  Detail,
  SettingsPanel,
  CollectionDialog,
}) {
  const [view, setView] = useState("home"),
    [collection, setCollection] = useState(null),
    [query, setQuery] = useState(""),
    [search, setSearch] = useState("");
  const [items, setItems] = useState([]),
    [total, setTotal] = useState(0),
    [stats, setStats] = useState({}),
    [collections, setCollections] = useState([]),
    [tags, setTags] = useState([]),
    [selectedTags, setSelectedTags] = useState([]),
    [tagMode, setTagMode] = useState("all");
  const [preferences, setPreferences] = useState({
      default_collection_id: null,
    }),
    [ready, setReady] = useState(false),
    [loading, setLoading] = useState(false),
    [loadError, setLoadError] = useState(""),
    [revision, setRevision] = useState(0);
  const [sort, setSort] = useState("updated"),
    [layout, setLayout] = useState("grid"),
    [selected, setSelected] = useState(null),
    [settings, setSettings] = useState(false),
    [collectionModal, setCollectionModal] = useState(null),
    [mobile, setMobile] = useState(false),
    [toast, setToast] = useState(""),
    [uploading, setUploading] = useState(""),
    [dragging, setDragging] = useState(false);
  const [uploadBatch, setUploadBatch] = useState(null),
    [exporting, setExporting] = useState(false),
    [selecting, setSelecting] = useState(false),
    [selection, setSelection] = useState([]),
    [batchTags, setBatchTags] = useState(false);
  const [uploadKind, setUploadKind] = useState('image');
  const [importing, setImporting] = useState(false);
  const fileInput = useRef(),
    markdownInput = useRef(),
    searchInput = useRef(),
    generation = useRef(0),
    detailGeneration = useRef(0),
    listRequest = useRef(null);
  const [organizing, setOrganizing] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);
  const [gallery, setGallery] = useState(null);
  const [galleryBusy, setGalleryBusy] = useState(false);
  const galleryItems = gallery || items.filter(i => i.kind === 'image');
  const galleryIndex = galleryItems.findIndex(i => i.id === selected?.id);
  async function stepImage(delta) {
    if (galleryBusy) return;
    const current = ++detailGeneration.current;
    let next = galleryItems[galleryIndex + delta];
    setGalleryBusy(true);
    try {
      if (next) {
        const item = await api(`/api/items/${next.id}`);
        if (current === detailGeneration.current) setSelected(item);
      }
    } catch (e) { if (current === detailGeneration.current) setToast(e.message); }
    finally { if (current === detailGeneration.current) setGalleryBusy(false); }
  }
  useEffect(() => {
    if (!selected || galleryIndex < 0) return;
    const images = [galleryItems[galleryIndex - 1], galleryItems[galleryIndex + 1]].filter(Boolean).map(item => {
      const img = new window.Image(); img.src = item.thumbnail_url; return img;
    });
    return () => images.forEach(img => { img.src = ''; });
  }, [selected?.id, galleryIndex, galleryItems.length]);
  const refresh = () => setRevision((n) => n + 1),
    notify = setToast;
  const actualCollection = collection === "unfiled" ? null : collection;
  const toggleSelection = id => setSelection(previous => previous.includes(id)
    ? previous.filter(value => value !== id)
    : previous.length < 100 ? [...previous,id] : previous);
  const closeDetail = () => {
    ++detailGeneration.current;
    setSelected(null); setGallery(null); setGalleryBusy(false);
    if (window.location.hash.startsWith('#item/')) history.replaceState(null, '', location.pathname + location.search);
  };
  const resetScope = () => {
    ++generation.current;
    listRequest.current?.abort();
    closeDetail();
    setItems([]); setTotal(0); setLoadError(''); setLoading(true);
    setTags([]);
    setSelectedTags([]); setQuery(''); setSearch('');
    setSelection([]); setSelecting(false); setMobile(false);
    // Re-entering the current scope must also fetch again after clearing it.
    refresh();
  };
  const chooseCollection = (id) => {
    resetScope(); setTags([]); setStats({});
    setCollection(id);
    setView("all");
  };
  const goHome = () => {
    if (preferences.default_collection_id)
      chooseCollection(preferences.default_collection_id);
    else {
      resetScope();
      setView("home");
      setCollection(null);
    }
  };
  useEffect(() => {
    let active = true;
    Promise.all([api("/api/preferences"), api("/api/collections")])
      .then(([prefs, libs]) => {
        if (!active) return;
        setPreferences(prefs);
        setCollections(libs);
        const home = prefs.default_collection_id;
        if (home === "unfiled" || libs.some((c) => c.id === home)) {
          setCollection(home);
          setView("all");
        }
        setReady(true);
      })
      .catch((e) => {
        if (active) setLoadError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(""), 5000);
      return () => clearTimeout(t);
    }
  }, [toast]);
  useEffect(() => {
    const t = setTimeout(() => setSearch(query), 220);
    return () => clearTimeout(t);
  }, [query]);
  const params = useCallback(
    (offset) => {
      const p = new URLSearchParams({
        sort,
        offset: String(offset),
        limit: "60",
        grouped: selecting ? 'false' : 'true',
      });
      if (search) p.set("q", search);
      p.set("collection", collection || 'unfiled');
      if (selectedTags.length) {
        p.set("tags", JSON.stringify(selectedTags));
        p.set("tag_mode", tagMode);
      }
      if (view === "images") p.set("kind", "image");
      if (view === 'videos') p.set('kind', 'video');
      if (view === "notes") p.set("kind", "note");
      if (view === "favorites") p.set("favorite", "true");
      if (view === "trash") p.set("trash", "true");
      return p.toString();
    },
    [sort, search, collection, selectedTags, tagMode, view, selecting],
  );
  async function openItem(item) {
    const current = ++detailGeneration.current;
    setSelected(item);
    if (item.kind !== 'image') { setGallery(null); setGalleryBusy(false); return; }
    setGallery(items.filter(i => i.kind === 'image'));
    setGalleryBusy(true);
    try {
      // Freeze only lightweight IDs; editing a title or sort timestamp cannot
      // move the page boundary and skip an image during continuous organizing.
      const groupParams = item.group_key && item.group_count
        ? new URLSearchParams({collection:item.collection_id||'unfiled',group_key:item.group_key,gallery:'true'})
        : `${params(0)}&gallery=true`;
      const result = await api(`/api/items?${groupParams}`);
      if (current !== detailGeneration.current) return;
      setGallery(result.ids.map(id => ({ id, thumbnail_url: `/media/${id}/thumbnail` })));
    } catch (e) { if (current === detailGeneration.current) setToast(e.message); }
    finally { if (current === detailGeneration.current) setGalleryBusy(false); }
  }
  async function browseFilteredImages() {
    if (galleryBusy || loading) return;
    const current = ++detailGeneration.current;
    setGalleryBusy(true);
    try {
      const p = new URLSearchParams(params(0));
      p.set('kind', 'image'); p.set('gallery', 'true');
      const result = await api(`/api/items?${p}`);
      if (current !== detailGeneration.current) return;
      if (!result.ids.length) { notify('当前筛选条件下没有图片'); return; }
      const first = await api(`/api/items/${result.ids[0]}`);
      if (current !== detailGeneration.current) return;
      setGallery(result.ids.map(id => ({ id, thumbnail_url: `/media/${id}/thumbnail` })));
      setSelected(first);
    } catch (e) { if (current === detailGeneration.current) notify(e.message); }
    finally { if (current === detailGeneration.current) setGalleryBusy(false); }
  }
  useEffect(() => {
    if (!ready) return;
    const current = ++generation.current;
    const controller = new AbortController();
    listRequest.current = controller;
    const read = path => api(path, { signal: controller.signal });
    setLoading(true);
    setLoadError("");
    setSelection([]);
    Promise.all([
      view === "home"
        ? Promise.resolve({ items: [], total: 0 })
        : read(`/api/items?${params(0)}`),
      read(`/api/stats?collection=${encodeURIComponent(collection || 'unfiled')}`),
      read("/api/collections"),
      view === 'home' ? Promise.resolve([]) : read(`/api/tags?collection=${encodeURIComponent(collection || 'unfiled')}`),
    ])
      .then(([result, stats, libs, tags]) => {
        if (controller.signal.aborted || current !== generation.current) return;
        setItems(result.items);
        setTotal(result.total);
        setStats(stats);
        setCollections(libs);
        setTags(tags);
        if (
          collection &&
          collection !== "unfiled" &&
          !libs.some((c) => c.id === collection)
        ) {
          setCollection(null);
          setView("home");
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted && current === generation.current) setLoadError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted && current === generation.current) setLoading(false);
      });
    return () => controller.abort();
  }, [ready, view, params, revision]);
  useEffect(() => {
    const focus = () => refresh();
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, []);
  useEffect(() => {
    if (!ready) return;
    const openLink = () => {
      const id = window.location.hash.match(/^#item\/([a-f0-9-]{36})$/i)?.[1];
      if (id) {
        const current = ++detailGeneration.current;
        api(`/api/items/${id}`).then(item => {
          if (current !== detailGeneration.current) return;
          chooseCollection(item.collection_id || 'unfiled');
          history.replaceState(null, '', location.pathname + location.search + '#item/' + item.id);
          setGallery(item.kind === 'image' ? [item] : []); setSelected(item);
        }).catch(e => { if (current === detailGeneration.current) setToast(e.message); });
      }
    };
    openLink(); window.addEventListener('hashchange', openLink);
    return () => window.removeEventListener('hashchange', openLink);
  }, [ready]);
  const navigate = (v) => {
    resetScope();
    setView(v);
    if (!collection) setCollection('unfiled');
  };
  const toggleTag = (t) => {
    if (!selectedTags.includes(t) && selectedTags.length >= 30) {
      notify('最多同时筛选 30 个标签'); return;
    }
    if (view === "home") setView("all");
    setSelectedTags((previous) =>
      previous.includes(t) ? previous.filter((v) => v !== t) : [...previous, t],
    );
    setMobile(false);
  };
  async function uploadFiles(files, insertInNote, targetCollection) {
    const results = [];
    const failures = [];
    const target = targetCollection !== undefined ? targetCollection : selected?.collection_id ?? actualCollection;
    for (const [i, file] of [...files].entries()) {
      setUploading(`上传 ${i + 1} / ${files.length}：${file.name}`);
      try {
        results.push(await uploadFile(file, target));
      } catch (e) {
        failures.push(`${file.name}：${e.message}`);
      }
    }
    setUploading("");
    refresh();
    if (results.length) insertInNote?.(results);
    notify(
      failures.length
        ? failures.join("；")
        : `已入库 ${results.length} 张图片${results.some((i) => i.duplicate) ? "（重复图片已复用）" : ""}`,
    );
    return results;
  }
  useEffect(() => {
    const paste = (e) => {
      if (
        selected ||
        uploadBatch ||
        settings ||
        ["INPUT", "TEXTAREA"].includes(e.target.tagName)
      )
        return;
      const files = [...e.clipboardData.files].filter((f) =>
        f.type.startsWith("image/"),
      );
      if (files.length) {
        e.preventDefault();
        setUploadBatch(files);
      }
    };
    window.addEventListener("paste", paste);
    return () => window.removeEventListener("paste", paste);
  }, [selected, uploadBatch, settings]);
  useEffect(() => {
    const hotkey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        if (view === "home") setView("all");
        searchInput.current?.focus();
      }
      if (e.key === "Escape") setMobile(false);
    };
    window.addEventListener("keydown", hotkey);
    return () => window.removeEventListener("keydown", hotkey);
  }, [view]);
  async function favorite(item) {
    try {
      if(item.group_key && item.group_count) {
        await send('/api/item-groups/favorite',{group_key:item.group_key,collection_id:item.collection_id,favorite:!item.favorite});refresh();return;
      }
      await send(
        `/api/items/${item.id}`,
        { favorite: !item.favorite, version: item.version },
        "PATCH",
      );
      refresh();
    } catch (e) {
      notify(e.message);
    }
  }
  async function remove(item) {
    try {
      await api(`/api/items/${item.id}`, { method: "DELETE" });
      setSelected(null);
      refresh();
      notify("已移至回收站，可以随时恢复");
    } catch (e) {
      notify(e.message);
    }
  }
  async function batchTrash() {
    if(batchBusy || !selection.length) return;
    setBatchBusy(true);
    try {
      const chosen=items.filter(i=>selection.includes(i.id));
      if(chosen.length!==selection.length) throw new Error('选择内容已变化，请重新选择');
      await send('/api/items/batch-trash',{items:chosen.map(({id,version})=>({id,version})),collection_id:actualCollection,restore:view==='trash'});
      setSelection([]); refresh(); notify(view==='trash'?`已恢复 ${chosen.length} 项内容`:`已将 ${chosen.length} 项移至当前知识库回收站，可随时恢复`);
    } catch(e) { notify(e.message); } finally {setBatchBusy(false);}
  }
  async function restore(item) {
    try {
      await send(`/api/items/${item.id}/restore`, {});
      setSelected(null);
      refresh();
      notify("已恢复");
    } catch (e) {
      notify(e.message);
    }
  }
  async function importMarkdown(files) {
    let count = 0;
    for (const file of files) {
      try {
        if (file.size > 500000) throw new Error("文件不能超过 500 KB");
        await send("/api/items", {
          title: file.name.replace(/\.md$/i, ""),
          content: await file.text(),
          collection_id: actualCollection,
        });
        count++;
      } catch (e) {
        notify(e.message);
      }
    }
    refresh();
    if (count) notify(`已导入 ${count} 篇笔记`);
  }
  const activeCollection = collections.find((c) => c.id === collection);
  const title =
    collection === "unfiled"
      ? "未分类"
      : activeCollection?.name || labels[view];
  const newNote = () => {
    closeDetail();
    setSelected({
      kind: "note",
      title: "",
      content: "",
      tags: [],
      collection_id: actualCollection,
      favorite: false,
    });
  };
  if (!ready)
    return (
      <div className="center-screen">
        {loadError ? (
          <>
            <p>{loadError}</p>
            <button onClick={() => window.location.reload()}>重试</button>
          </>
        ) : (
          <>
            <Loader2 className="spin" />
            正在读取默认知识库…
          </>
        )}
      </div>
    );
  return (
    <div className="app-shell">
      {mobile && (
        <div className="sidebar-shade" onClick={() => setMobile(false)} />
      )}
      <aside className={`sidebar ${mobile ? "mobile-open" : ""}`}>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            goHome();
          }}
        >
          <img src="/icon.svg" />
          ZNote<span className="beta">LOCAL</span>
        </a>
        <div className="workspace-label">
          <span className="avatar">我</span>
          <div>
            <strong>我的知识空间</strong>

          </div>
        </div>
        <span className="nav-caption">{view==='home'?'内容分类':`${activeCollection?.name||'未分类'} · 内容`}</span>
        <nav>
          <button className={view === "home" ? "active" : ""} onClick={goHome}>
            <Home size={18} />
            知识库首页
          </button>
          {["all", "images", "videos", "notes", "favorites"].map((v) => {
            const Icon = icons[v];
            return (
              <button
                key={v}
                className={view === v ? "active" : ""}
                onClick={() => navigate(v)}
              >
                <Icon size={18} />
                {labels[v]}
                <span>
                  {stats[
                    {
                      all: "total",
                      images: "images",
                      videos: 'videos',
                      notes: "notes",
                      favorites: "favorites",
                    }[v]
                  ] || 0}
                </span>
              </button>
            );
          })}
        </nav>
        <div className="nav-caption">
          知识库
          <IconButton label="新建知识库" onClick={() => setCollectionModal({})}>
            <Plus size={15} />
          </IconButton>
        </div>
        <nav className="collections-nav">
          {collections.map((c) => (
            <div className="collection-row" key={c.id}>
              <button
                className={collection === c.id ? "active" : ""}
                onClick={() => chooseCollection(c.id)}
              >
                <span className="folder-icon" style={{ color: c.color }}>
                  <BookOpen size={17} />
                </span>
                <b>{c.name}</b>
                <span>{c.count}</span>
              </button>
              <IconButton
                label={`管理 ${c.name}`}
                onClick={() => setCollectionModal(c)}
              >
                <MoreHorizontal size={14} />
              </IconButton>
            </div>
          ))}
          <button
            className={collection === "unfiled" ? "active" : ""}
            onClick={() => chooseCollection("unfiled")}
          >
            <Layers size={17} />
            未分类
          </button>
        </nav>
        <div className="nav-caption">多标签筛选</div>
        <div className="sidebar-tags">
          {tags.slice(0, 30).map((t) => (
            <button
              aria-pressed={selectedTags.includes(t.name)}
              className={selectedTags.includes(t.name) ? "selected" : ""}
              key={t.name}
              onClick={() => toggleTag(t.name)}
            >
              # {t.name}
            </button>
          ))}
          {!tags.length && <small>为内容加上多个标签，轻松找回灵感</small>}
        </div>
        <div className="sidebar-bottom">
          <button
            className={view === "trash" ? "active" : ""}
            onClick={() => navigate("trash")}
          >
            <Trash2 size={17} />
            回收站<span>{stats.trash || ""}</span>
          </button>
          <button onClick={() => setSettings(true)}>
            <Settings size={17} />
            设置与连接
            <ArrowUpRight size={15} />
          </button>
          <div className="local-status">
            <span /> 本地空间 <small>v{packageVersion}</small>
          </div>
        </div>
      </aside>
      <main
        className="main"
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files")) {
            e.preventDefault();
            setDragging(true);
          }
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!selected && !uploadBatch)
            setUploadBatch([...e.dataTransfer.files]);
        }}
      >
        <header className="topbar">
          <div className="breadcrumbs">
            <IconButton label="打开导航" onClick={() => setMobile(true)}>
              <Menu size={20} />
            </IconButton>
            <span>我的空间</span>
            <ChevronRight size={14} />
            <strong>{title}</strong>
          </div>
          <div className="topbar-right">
            <IconButton
              label={resolvedTheme === "dark" ? "切换浅色模式" : "切换夜间模式"}
              onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
            >
              {resolvedTheme === "dark" ? <Sun size={19} /> : <Moon size={19} />}
            </IconButton>
            <span className="private-label">
              <span />
              私有知识库
            </span>
            <button
              className="avatar"
              onClick={() => setSettings(true)}
              aria-label="个人设置"
            >
              我
            </button>
          </div>
        </header>
        <div className="main-content">
          <section className="page-heading">
            <div>
              <h1>
                {title}
                <span className="count-badge">
                  {view === "home" ? collections.length : total}
                </span>
                <HelpHint label="当前视图">
                {view === "home"
                  ? "先选择一个知识库，专注于一个主题。"
                  : view === "trash"
                    ? "暂时放下的内容，也可以随时找回来。"
                    : activeCollection
                      ? "这里只展示当前知识库的内容。"
                      : "收好每一份灵感，连接属于你的知识。"}
                </HelpHint>
              </h1>
            </div>
            <div className="heading-actions">
              <button onClick={() => setExporting(true)}>
                <Download size={16} />
                导出
              </button>
              <button onClick={newNote}>
                <Plus size={17} />
                新建笔记
              </button>
              <button className="primary" onClick={() => { setUploadKind('image'); setUploadBatch([]); }}>
                <Upload size={17} />
                上传图片
              </button>
              <button onClick={() => { setUploadKind('video'); setUploadBatch([]); }}><Film size={16} />上传视频</button>
              <button onClick={() => setImporting(true)}><ArrowUpRight size={16} />网络采集</button>
            </div>
          </section>
          {view === "home" ? (
            <>
              <section className="intro-banner">
                <div className="banner-icon">
                  <BookOpen size={27} />
                </div>
                <div>
                  <div className="inline-heading"><h3>从喜欢的知识库开始</h3><HelpHint label="默认知识库">在设置中选择默认知识库，下次直接进入；其他知识库仍可从侧栏切换。</HelpHint></div>
                </div>
                <button onClick={() => setSettings(true)}>
                  设置默认知识库
                  <ArrowUpRight size={16} />
                </button>
              </section>
              <div className="library-grid">
                {collections.map((c) => (
                  <button
                    className="library-card"
                    key={c.id}
                    onClick={() => chooseCollection(c.id)}
                  >
                    <BookOpen size={32} style={{ color: c.color }} />
                    <h2>{c.name}</h2>
                    <p>{c.count} 项内容</p>
                    <span>
                      打开知识库
                      <ChevronRight size={15} />
                    </span>
                  </button>
                ))}
                <button
                  className="library-card"
                  onClick={() => chooseCollection("unfiled")}
                >
                  <Layers size={32} />
                  <h2>未分类</h2>
                  <p>尚未归入知识库的内容</p>
                  <span>
                    查看内容
                    <ChevronRight size={15} />
                  </span>
                </button>
                <button
                  className="library-card new-library"
                  onClick={() => setCollectionModal({})}
                >
                  <FolderPlus size={32} />
                  <h2>新建知识库</h2>
                  <p>为一个新主题留出空间</p>
                </button>
              </div>
            </>
          ) : (
            <>
              <section className="toolbar">
                <div className="search-box">
                  <Search size={18} />
                  <input
                    ref={searchInput}
                    aria-label="搜索内容"
                    placeholder="搜索标题、正文或标签…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  {query ? (
                    <IconButton label="清空搜索" onClick={() => setQuery("")}>
                      <X size={14} />
                    </IconButton>
                  ) : (
                    <kbd>Ctrl K</kbd>
                  )}
                </div>
                <div className="toolbar-options">
                  <select
                    aria-label="排序方式"
                    value={sort}
                    onChange={(e) => setSort(e.target.value)}
                  >
                    <option value="updated">最近更新</option>
                    <option value="created">最近创建</option>
                    <option value="title">名称排序</option>
                  </select>
                  <div className="view-switch">
                    <IconButton
                      label="网格视图"
                      className={layout === "grid" ? "chosen" : ""}
                      onClick={() => setLayout("grid")}
                    >
                      <LayoutGrid size={17} />
                    </IconButton>
                    <IconButton
                      label="列表视图"
                      className={layout === "list" ? "chosen" : ""}
                      onClick={() => setLayout("list")}
                    >
                      <List size={17} />
                    </IconButton>
                  </div>
                  <IconButton label="刷新内容" onClick={refresh}>
                    <RefreshCw size={16} />
                  </IconButton>
                </div>
              </section>
              <TagFilter key={actualCollection || 'unfiled'} tags={tags} selected={selectedTags} mode={tagMode} videos={view === 'videos'}
                onToggle={toggleTag} onMode={setTagMode} onClear={() => setSelectedTags([])}
                onBrowse={['notes', 'videos'].includes(view) ? null : browseFilteredImages}
                busy={loading || galleryBusy || query !== search || !!loadError} />
              <div className="results-caption">
                <span>
                  {query ? `“${query}” 的搜索结果` : ""}
                  <b>{total} 项内容</b>
                </span>
                <div className="result-actions">
                  <button
                    className="text-button"
                    onClick={() => {
                      setSelecting(!selecting);
                      setSelection([]);
                    }}
                  >
                    {selecting ? "退出选择" : "选择内容"}
                  </button>
                  <button
                    className="text-button"
                    onClick={() => markdownInput.current.click()}
                  >
                    <Download size={14} />
                    导入 Markdown
                  </button>
                </div>
              </div>
              {selecting && (
                <div className="selection-bar">
                  <label>
                    <input
                      type="checkbox"
                      aria-label="选择当前页全部内容"
                      disabled={batchBusy}
                      checked={
                        !!items.length && items.slice(0, 100).every(i => selection.includes(i.id))
                      }
                      onChange={(e) =>
                        setSelection(
                          e.target.checked ? items.slice(0, 100).map((i) => i.id) : [],
                        )
                      }
                    />
                    {items.length > 100 ? '前 100 项' : '当前页'}
                  </label>
                  <span>已选 {selection.length} 项（每次最多 100 项）</span>
                  <HelpHint label="图片组选择">点击图片、标题或勾选框即可选择 / 取消。图片组会展开，支持按单张图片移动、加标签或删除。</HelpHint>
                  <button
                    onClick={() => setBatchTags(true)}
                    disabled={!selection.length || view === "trash"}
                  >
                    <Hash size={15} />
                    批量标签
                  </button>
                  <button onClick={() => setOrganizing(true)} disabled={!selection.length || view === 'trash'}>移动 / 收藏</button>
                  <button className={view==='trash'?'':'danger'} disabled={!selection.length || batchBusy} onClick={batchTrash}>
                    {view==='trash'?<RefreshCw size={15}/>:<Trash2 size={15}/>} {batchBusy?'正在处理…':view==='trash'?'恢复所选':'删除所选'}
                  </button>
                </div>
              )}
              {loadError ? (
                <div className="empty">
                  <h3>内容加载失败</h3>
                  <p>{loadError}</p>
                  <button onClick={refresh}>重试</button>
                </div>
              ) : loading ? (
                <div className="loading-state">
                  <Loader2 className="spin" />
                  正在整理内容…
                </div>
              ) : !items.length ? (
                <div className="empty">
                  <div className="empty-art">
                    <FileText />
                    <Image />
                  </div>
                  <h2>
                    {query || selectedTags.length
                      ? "还没有找到相关内容"
                      : view === "trash"
                        ? "回收站是空的"
                        : "从一个想法，一张图片开始"}
                  </h2>
                  <p>
                    {query || selectedTags.length
                      ? "试试其他关键词，或清除筛选。"
                      : view === "trash"
                        ? "删除的内容会保留在这里。"
                        : "拖入多张图片、粘贴截图，或写下第一篇笔记。"}
                  </p>
                  {view !== "trash" && !query && (
                    <button
                      className="primary"
                      onClick={() => setUploadBatch([])}
                    >
                      <Plus size={17} />
                      添加图片
                    </button>
                  )}
                </div>
              ) : (
                <div className={`items ${layout}`}>
                  {items.map((item) => (
                    <article className={`item-card ${item.kind}${selecting&&selection.includes(item.id)?' is-selected':''}`} key={item.id}>
                      {selecting && (
                        <label className="card-select">
                          <input
                            type="checkbox"
                            aria-label={`选择 ${item.title}`}
                            checked={selection.includes(item.id)}
                            disabled={batchBusy || (selection.length >= 100 && !selection.includes(item.id))}
                            onChange={() => toggleSelection(item.id)}
                          />
                        </label>
                      )}
                      <button
                        className="card-main"
                        onClick={() => selecting ? toggleSelection(item.id) : openItem(item)}
                        aria-pressed={selecting ? selection.includes(item.id) : undefined}
                        disabled={selecting && (batchBusy || (selection.length >= 100 && !selection.includes(item.id)))}
                        aria-label={`${selecting ? selection.includes(item.id)?'取消选择':'选择' : '打开'} ${item.group_key && item.group_count ? item.group_title || item.title : item.title}`}
                      >
                        <div className="card-preview">
                          {item.kind === "image" ? (
                            <img
                              src={item.thumbnail_url}
                              alt={item.title}
                              loading="lazy"
                              decoding="async"
                            />
                          ) : item.kind === 'video' ? (
                            <div className="video-card-preview"><Film size={42} /><strong>点击预览视频</strong><small>{item.video_codec || 'VIDEO'} · {item.duration ? `${Math.round(item.duration)} 秒` : '原文件'}</small></div>
                          ) : (
                            <>
                              <span className="note-type">
                                <FileText size={15} /> MARKDOWN
                              </span>
                              <h3>{item.title}</h3>
                              <p>
                                {item.content
                                  .replace(/!\[[^\]]*\]\([^)]*\)/g, "[图片]")
                                  .replace(/[#*`>]/g, "")
                                  .slice(0, 240) || "一页空白，无限可能。"}
                              </p>
                            </>
                          )}
                          <span className={`kind-chip${item.group_key && item.group_count ? ' group-chip' : ''}`}>
                            {item.group_key && item.group_count ? <><Layers size={13} /> {item.group_count} 张</> : item.kind === "image" ? (
                              <Image size={13} />
                            ) : (
                              item.kind === 'video' ? <Film size={13} /> : <FileText size={13} />
                            )}
                          </span>
                        </div>
                        <div className="card-body">
                          <h3>{item.group_key && item.group_count ? item.group_title || item.title : item.title}</h3>
                          <div className="card-tags">
                            {item.tags.slice(0, 3).map((t) => (
                              <span key={t}># {t}</span>
                            ))}
                            {item.tags.length > 3 && (
                              <span>+{item.tags.length - 3}</span>
                            )}
                            {!item.tags.length && (
                              <span className="no-tags">
                                {collections.find(
                                  (c) => c.id === item.collection_id,
                                )?.name ||
                                  (item.kind === "image"
                                    ? "图片素材"
                                    : item.kind === 'video' ? '视频素材' : "图文笔记")}
                              </span>
                            )}
                          </div>
                          <div className="card-meta">
                            <span>{date(item.updated_at)}</span>
                            <span>
                              {item.kind !== "note"
                                ? `${item.width} × ${item.height}`
                                : `${item.content.length} 字符`}
                            </span>
                          </div>
                        </div>
                      </button>
                      <div className="card-actions">
                        {view === "trash" ? (
                          <IconButton
                            label={`恢复 ${item.title}`}
                            onClick={() => restore(item)}
                          >
                            <RefreshCw size={16} />
                          </IconButton>
                        ) : (
                          <IconButton
                            label={
                              item.favorite
                                ? `取消收藏 ${item.title}`
                                : `收藏 ${item.title}`
                            }
                            onClick={() => favorite(item)}
                          >
                            <Star
                              size={16}
                              fill={item.favorite ? "#d9a245" : "none"}
                              color={item.favorite ? "#d9a245" : "currentColor"}
                            />
                          </IconButton>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              )}
              {items.length < total && !loading && (
                <button
                  className="load-more"
                  onClick={async () => {
                    const current = generation.current;
                    try {
                      const result = await api(
                        `/api/items?${params(items.length)}`,
                      );
                      if (current === generation.current)
                        setItems((previous) => [
                          ...previous,
                          ...result.items.filter(
                            (i) => !previous.some((p) => p.id === i.id),
                          ),
                        ]);
                    } catch (e) {
                      notify(e.message);
                    }
                  }}
                >
                  加载更多内容
                </button>
              )}
            </>
          )}
          <footer className="content-footer">
            <span>ZNote · 给知识一个自己的家</span>
            <button onClick={() => setSettings(true)}>
              <Code2 size={14} />
              开放 API，让灵感自由连接
              <ArrowUpRight size={13} />
            </button>
          </footer>
        </div>
        {dragging && (
          <div className="drop-overlay">
            <Upload size={42} />
            <h2>松开鼠标，批量收集灵感</h2>
            <p>图片将进入上传队列，你可以统一选择知识库和标签。</p>
          </div>
        )}
      </main>
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          setUploadBatch([...e.target.files]);
          e.target.value = "";
        }}
      />
      <input
        ref={markdownInput}
        type="file"
        accept=".md,.markdown"
        multiple
        hidden
        onChange={(e) => {
          importMarkdown(e.target.files);
          e.target.value = "";
        }}
      />
      {uploading && (
        <div className="upload-progress">
          <Loader2 className="spin" size={17} />
          {uploading}
        </div>
      )}
      {toast && (
        <div role="status" className="toast">
          <Check size={17} />
          {toast}
          <IconButton label="关闭提示" onClick={() => setToast("")}>
            <X size={14} />
          </IconButton>
        </div>
      )}
      {selected && (
        <Detail
          key={selected.id || "new"}
          item={selected}
          collections={collections}
          suggestions={tags}
          onClose={closeDetail}
          onSaved={refresh}
          onDelete={remove}
          onRestore={restore}
          uploadFiles={uploadFiles}
          notify={notify}
          onSearch={(q) => {
            setSelected(null);
            navigate("all");
            setQuery(q);
          }}
          onOpen={item => {
            if (actualCollection !== item.collection_id) chooseCollection(item.collection_id || 'unfiled');
            else closeDetail();
            setGallery(item.kind === 'image' ? [item] : []); setSelected(item);
          }}
          onStep={stepImage}
          galleryItems={galleryItems}
          galleryIndex={galleryIndex}
          previousAvailable={galleryIndex > 0}
          nextAvailable={galleryIndex >= 0 && galleryIndex < galleryItems.length - 1}
          galleryBusy={galleryBusy}
          galleryPosition={galleryIndex >= 0 ? `第 ${galleryIndex + 1} / ${galleryItems.length} 张` : null}
        />
      )}
      {organizing && <OrganizeDialog items={items.filter(i => selection.includes(i.id))} collections={collections} onClose={() => setOrganizing(false)} onDone={() => { refresh(); notify('已完成批量整理'); }} />}
      {settings && (
        <SettingsPanel
          onClose={() => setSettings(false)}
          notify={notify}
          onLogout={onLogout}
          collections={collections}
          preferences={preferences}
          onPreferences={(p) => {
            setPreferences(p);
            if (p.default_collection_id)
              chooseCollection(p.default_collection_id);
            else {
              setView("home");
              setCollection(null);
            }
          }}
          theme={theme}
          setTheme={setTheme}
          onExport={() => {
            setSettings(false);
            setExporting(true);
          }}
        />
      )}
      {collectionModal && (
        <CollectionDialog
          value={collectionModal}
          onClose={() => setCollectionModal(null)}
          onSave={async (value, remove = false) => {
            try {
              if (remove) {
                await api(`/api/collections/${collectionModal.id}`, {
                  method: "DELETE",
                });
                if (collection === collectionModal.id) {
                  setCollection(null);
                  setView("home");
                }
                if (preferences.default_collection_id === collectionModal.id)
                  setPreferences({ default_collection_id: null });
              } else
                await send(
                  `/api/collections${collectionModal.id ? `/${collectionModal.id}` : ""}`,
                  value,
                  collectionModal.id ? "PATCH" : "POST",
                );
              setCollectionModal(null);
              refresh();
            } catch (e) {
              notify(e.message);
            }
          }}
        />
      )}
      {uploadBatch !== null && (
          <UploadDialog
          kind={uploadKind}
          files={uploadBatch}
          collections={collections}
          currentCollection={actualCollection}
          suggestions={tags}
          onClose={() => { setUploadBatch(null); setUploadKind('image'); }}
          onComplete={refresh}
          onOrganize={uploaded => { setUploadBatch(null); setGallery(uploaded); setSelected(uploaded[0]); }}
        />
      )}
      {importing && <ImportsDialog collections={collections} currentCollection={actualCollection} onClose={() => setImporting(false)} onComplete={refresh} onOpen={async id => { try { const item = await api('/api/items/' + id); setImporting(false); setGallery([]); setSelected(item); } catch (e) { notify(e.message); } }} />}
      {exporting && (
        <ExportDialog
          collections={collections}
          currentCollection={collection}
          onClose={() => setExporting(false)}
        />
      )}
      {batchTags && (
        <BatchTagsDialog
          items={items.filter((i) => selection.includes(i.id))}
          suggestions={tags}
          onClose={() => setBatchTags(false)}
          onSaved={refresh}
        />
      )}
    </div>
  );
}
