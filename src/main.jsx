import {isImageGroup} from './image-group.js';
import React, { useState, useEffect, useRef, useCallback } from "react";
import { sourceLinks } from '../shared/provenance.js';
import { markdownImages } from '../shared/markdown-images.js';
import { mediaDescription } from '../shared/media-description.js';
import {remarkMessageSpacing} from '../shared/message-blocks.js';
import {MessageBlocks} from './MessageBlocks.jsx';
import { GroupOrderDialog } from './GroupOrderDialog.jsx';
import { useNoteDraft } from './useNoteDraft.js';
import { DraftConflict } from './NoteDrafts.jsx';
const NoteVersions = React.lazy(() => import('./NoteVersions.jsx'));
import { GalleryStrip } from './GalleryStrip.jsx';
import { ZoomViewer } from './ZoomViewer.jsx';
import { useImageSwipe } from './useImageSwipe.js';
import { VideoPlayer } from './VideoProgress.jsx';
import { createRoot } from "react-dom/client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
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
  Hash,
  Download,
  Copy,
  Code2,
  Globe,
  KeyRound,
  LogOut,
  BookOpen,
  ArrowLeft,
  Pencil,
  RefreshCw,
  Link,
  Loader2,
  Eye,
  Sparkles,
  MoreHorizontal,
  Undo2,
  History,
} from "lucide-react";
import "./style.css";
import "./features.css";
import "./themes.css";
import './video.css';
import { AppearanceProvider } from './appearance.jsx';
import { api, send, bytes } from "./api.js";
import { HelpHint } from './HelpHint.jsx';
import './polish.css';
import './preview.css';
import './group-order.css';
import './compact-views.css';
import { IconButton, Dialog } from "./ui.jsx";
import { useTheme, TagInput, PreferencesSections } from "./features.jsx";
import {WeixinSettings} from './WeixinSettings.jsx';
import {ClientSettings} from './ClientSettings.jsx';
import {ExternalAssistantSettings} from './ExternalAssistant.jsx';
import { OrganizeDialog } from './organize.jsx';
import { BackupSettings } from './backups.jsx';
import {TaskProvider} from './Tasks.jsx';
import { WebhookSettings } from './webhooks.jsx';
import Workspace from "./Workspace.jsx";

const date = (d) =>
  new Date(d).toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
const labels = {
  all: "全部内容",
  images: "图片素材",
  notes: "图文笔记",
  favorites: "我的收藏",
  trash: "回收站",
};
const icons = {
  all: Layers,
  images: Image,
  notes: FileText,
  favorites: Star,
  trash: Trash2,
};
const MarkdownImagesContext = React.createContext(null);
function MarkdownImage({ src, alt }) {
  const onImage = React.useContext(MarkdownImagesContext);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => { setFailed(false); setAttempt(0); }, [src]);
  if (!src?.startsWith('/media/')) return <span className="external-image">外部图片：<a href={src} target="_blank" rel="noreferrer">{alt || '在新窗口打开'}</a></span>;
  if (failed) return <span className="note-image-error" role="status">{alt || '笔记图片'} · 加载失败 <button onClick={() => { setFailed(false); setAttempt(n => n + 1); }}>重试图片</button></span>;
  const url = attempt ? `${src}${src.includes('?') ? '&' : '?'}retry=${attempt}` : src;
  return <img src={url} alt={alt || '笔记图片'} loading="lazy" decoding="async" onError={() => setFailed(true)} role={onImage?'button':undefined} tabIndex={onImage?0:undefined} onClick={onImage?e=>{e.preventDefault();e.stopPropagation();onImage(src)}:undefined} onKeyDown={onImage?e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();onImage(src)}}:undefined} />;
}
function Markdown({ content, onLink, onImage, preserveSpacing = false }) {
  const markdown = content.replace(
    /\[\[([^\]\n]+)\]\]/g,
    (_, title) => `[${title}](#wiki/${encodeURIComponent(title)})`,
  );
  return (
    <MarkdownImagesContext.Provider value={onImage}><ReactMarkdown
      remarkPlugins={preserveSpacing?[remarkGfm, remarkBreaks, remarkMessageSpacing]:[remarkGfm, remarkBreaks]}
      components={{
        a: ({ href, children }) => (
          <a
            href={href}
            onClick={(event) => {
              if (href?.startsWith("#wiki/")) {
                event.preventDefault();
                onLink?.(decodeURIComponent(href.slice(6)));
              }
            }}
            target={href?.startsWith("http") ? "_blank" : undefined}
            rel="noreferrer"
          >
            {children}
          </a>
        ),
        img: MarkdownImage,
      }}
    >
      {markdown}
    </ReactMarkdown></MarkdownImagesContext.Provider>
  );
}
function Auth({ configured, onDone }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="auth-page">
      <div className="auth-art">
        <div className="brand">
          <img src="/icon.svg" />
          ZNote<span>知识，看得见。</span>
        </div>
        <div className="auth-heading">
          <span className="eyebrow">YOUR PERSONAL KNOWLEDGE SPACE</span>
          <h1>
            收集灵感，
            <br />
            让知识生长。
          </h1>
          <p>
            一张图片，一段文字，一个新的想法。
            <br />
            把值得留住的东西，放在自己的空间里。
          </p>
        </div>
        <div className="auth-tiles">
          <div>
            <Image size={40} />
            <span>图片与灵感</span>
          </div>
          <div>
            <FileText size={40} />
            <span>记录与思考</span>
          </div>
          <div>
            <Link size={40} />
            <span>连接与发现</span>
          </div>
        </div>
        <small>本地存储 · 多端访问 · 开放连接</small>
      </div>
      <form
        className="auth-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await send(`/api/auth/${configured ? "login" : "setup"}`, {
              password,
            });
            onDone();
          } catch (e) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <img className="auth-logo" src="/icon.svg" />
        <h2>{configured ? "欢迎回到你的知识库" : "创建你的知识空间"}</h2>
        <p>
          {configured
            ? "输入访问密码，继续收集与思考。"
            : "先设置一个访问密码，保护你的笔记和图片。"}
        </p>
        <label>
          访问密码
          <input
            autoFocus
            type="password"
            autoComplete={configured ? "current-password" : "new-password"}
            minLength={configured ? 1 : 4}
            maxLength={200}
            required
            placeholder={configured ? "输入密码" : "至少 4 位，可使用四位数字"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && (
          <div role="alert" className="error">
            {error}
          </div>
        )}
        <button className="primary" disabled={busy}>
          {busy ? (
            <Loader2 className="spin" size={18} />
          ) : (
            <ArrowUpRight size={18} />
          )}{" "}
          {configured ? "进入知识库" : "开始使用 ZNote"}
        </button>
        <small>
          内容保存在运行 ZNote
          的设备上。其他设备连接同一服务，即可访问同一份知识库。
        </small>
      </form>
    </div>
  );
}

function App() {
  const [auth, setAuth] = useState(null),
    [configured, setConfigured] = useState(true),
    [error, setError] = useState("");
  const [theme, setTheme, resolvedTheme] = useTheme();
  const checkAuth = useCallback(async () => {
    setError("");
    try {
      const status = await api("/api/auth/status");
      setConfigured(status.configured);
      if (!status.configured) return setAuth(false);
      try {
        await api("/api/me");
        setAuth(true);
      } catch (e) {
        if (e.status === 401) setAuth(false);
        else throw e;
      }
    } catch (e) {
      setError(e.message);
    }
  }, []);
  useEffect(() => {
    checkAuth();
  }, [checkAuth]);
  if (error)
    return (
      <div className="center-screen">
        <p>{error}</p>
        <button onClick={checkAuth}>重新连接</button>
      </div>
    );
  if (auth === null)
    return (
      <div className="center-screen">
        <Loader2 className="spin" />
        正在连接知识库…
      </div>
    );
  if (!auth) return <Auth configured={configured} onDone={checkAuth} />;
  return (
    <TaskProvider><Workspace
      theme={theme}
      resolvedTheme={resolvedTheme}
      setTheme={setTheme}
      Detail={Detail}
      SettingsPanel={SettingsPanel}
      CollectionDialog={CollectionDialog}
      onLogout={async () => {
        await send("/api/auth/logout", {});
        setAuth(false);
      }}
    /></TaskProvider>
  );
}

function CollectionDialog({ value, onClose, onSave }) {
  const [name, setName] = useState(value.name || "");
  const [color, setColor] = useState(value.color || "#287464");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      title={value.id ? "管理知识库" : "创建知识库"}
      onClose={()=>!busy&&onClose()}
      className="small-dialog"
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          await onSave({ name, color });
          setBusy(false);
        }}
      >
        <p>用一个主题，把相关的图片和笔记放在一起。</p>
        <label>
          知识库名称
          <input
            required
            maxLength={80}
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：设计灵感、学习笔记"
          />
        </label>
        <label>
          标记颜色
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
          />
        </label>
        <div className="dialog-actions">
          {value.id && (
            <button
              type="button"
              className="danger text-button"
              disabled={busy}
              onClick={() => onSave(null, true)}
            >
              删除知识库（保留内容）
            </button>
          )}
          <button className="primary" disabled={busy}>
            保存知识库
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function Detail({
  item: initial,
  expandedImage = false,
  onExpandedImageChange,
  collections,
  suggestions,
  onClose,
  onSaved,
  onGroupOrdered,
  onSelectGroup,
  groupSelecting,
  onDelete,
  onRestore,
  onPurge,
  uploadFiles,
  notify,
  onSearch,
  onTagSearch,
  onOpen,
  onStep,
  onImageViewed,
  videoProgress,
  onBeforeItemChange,
  previousAvailable,
  nextAvailable,
  galleryBusy,
  galleryPosition,
  galleryItems = [],
  galleryIndex = -1,
}) {
  const [item, setItem] = useState(initial);
  const [videoError, setVideoError] = useState(false);
  const [title, setTitle] = useState(initial.title);
  const [content, setContent] = useState(initial.content);
  const messageNote=initial.kind==='note'&&(initial.tags?.includes('微信')||initial.content.includes('<!-- znote-message:'));
  const [tags, setTags] = useState(initial.tags);
  const [collection, setCollection] = useState(initial.collection_id || "");
  const [noteIndex,setNoteIndex] = useState(null);
  const noteImages = React.useMemo(()=>markdownImages(content,true).filter(i=>i.url.startsWith('/media/')).map((i,index)=>({...i,id:String(index),thumbnail_url:i.url.replace(/\/(original|thumbnail)(\?|$)/,'/thumbnail$2')})),[content]);
  useEffect(()=>{const id=noteImages[noteIndex]?.url.match(/^\/media\/([a-f0-9-]{36})\//i)?.[1];if(id&&!item.deleted_at)onImageViewed?.(id);},[noteImages[noteIndex]?.url,item.deleted_at]);
  const [editing, setEditing] = useState(
    initial.kind === "note" && !initial.id,
  );
  const [busy, setBusy] = useState(false);
  const [backlinks, setBacklinks] = useState([]);
  const [error, setError] = useState("");
  const [lightbox, setLightboxValue] = useState(initial.kind==='image'&&expandedImage?initial.url:false);
  const setLightbox=value=>{setLightboxValue(value);if(initial.kind==='image')onExpandedImageChange?.(!!value);};
  const [copying, setCopying] = useState(false);
  const [sorting,setSorting] = useState(false);
  const [orderUndo,setOrderUndo] = useState(null);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const openSorting=async()=>{if(!dirty||await save())setSorting(true)};
  const externalImages = React.useMemo(()=>item.kind==='note'?markdownImages(content):[],[item.kind,content]);
  const input = useRef();
  const imageArea = useRef(), noteArea = useRef(), lastWheel = useRef(0);
  const textarea = useRef();
  const dirty =
    title !== item.title ||
    content !== item.content ||
    JSON.stringify(tags) !== JSON.stringify(item.tags) ||
    collection !== (item.collection_id || "");
  const fields = { title, content, tags, collection_id: collection || null };
  const latestFields = useRef(fields); latestFields.current = fields;
  const applyDraft = value => { setTitle(value.title); setContent(value.content); setTags(value.tags); setCollection(value.collection_id || ''); setEditing(true); };
  const exportCurrent = () => {
    const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = (title || '未命名笔记').replace(/[\\/:*?"<>|]/g, '-') + '.md'; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const draft = useNoteDraft({ initial, item, fields, dirty, textarea, apply: applyDraft });
  useEffect(() => {
    if (item.id)
      api(`/api/items/${item.id}/backlinks`)
        .then(setBacklinks)
        .catch((e) => setError(e.message));
  }, [item.id]);
  useEffect(() => {
    const warn = (e) => {
      if (dirty && (item.kind !== 'note' || !draft.isPersisted())) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const close = async () => {
    if (busy) return;
    if (item.kind === 'note' && dirty && await draft.flush()) { onClose(); return; }
    if (!dirty || confirm("有尚未保存的修改，确定关闭吗？")) onClose();
  };
  const insertImages = (images) => {
    const text = images
      .map((i) => `![${i.title.replace(/[\[\]]/g, "")}](${i.url})`)
      .join("\n\n");
    const pos = textarea.current?.selectionStart ?? content.length;
    setContent(
      (previous) =>
        `${previous.slice(0, pos)}\n\n${text}\n\n${previous.slice(pos)}`,
    );
    setEditing(true);
  };
  async function save() {
    setBusy(true);
    setError("");
    try {
      const value = { title, content, tags, collection_id: collection || null };
      if (item.id) { value.version = item.version; value.undo = true; }
      if (item.id && value.collection_id !== item.collection_id) onBeforeItemChange?.(item.kind==='note' ? [item.id,...noteImages.map(image=>image.url.match(/^\/media\/([^/]+)\//)?.[1])] : item.group_key ? [item.id,...galleryItems.map(image=>image.id)] : [item.id]);
      const movingGroup=item.kind==='image'&&item.group_key&&value.collection_id!==item.collection_id;
      const result = movingGroup
        ? await send('/api/item-groups/move',{...value,id:item.id,move_note:true})
        : await send(`/api/items${item.id ? `/${item.id}` : ""}`,value,item.id?'PATCH':'POST');
      setItem(result);
      // Keep anything typed while a save or remote-image archive was pending.
      const pending = latestFields.current;
      if (pending.title === value.title) setTitle(result.title);
      if (pending.content === value.content) setContent(result.content);
      if (JSON.stringify(pending.tags) === JSON.stringify(value.tags)) setTags(result.tags);
      if (pending.collection_id === value.collection_id) setCollection(result.collection_id || "");
      onSaved(result);
      const failures=result.image_archive?.failures||[];
      if(failures.length)setError(`${failures.length} 张配图暂未归档：${failures[0].error}。可再次点击归档重试。`);
      notify(result.moved_count?`已移动整组 ${result.moved_count} 张图片${item.group_key?.startsWith('note:')?'及所属笔记':''}`:failures.length?'笔记已保存，部分配图尚未归档':result.image_archive?.archived?`已保存，${result.image_archive.archived} 张配图已归档`:'已保存',failures.length?null:result.undo);
      return true;
    } catch (e) {
      videoProgress?.allowItem(item.id);
      setError(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function step(delta) {
    if (busy || galleryBusy || copying || sorting) return;
    if (dirty && !(await save())) return;
    return onStep?.(delta);
  }
  const swipeDisabled=busy||galleryBusy||copying||sorting||!!lightbox;
  const imageSwipe=useImageSwipe({identity:item.id,disabled:swipeDisabled,onTap:()=>setLightbox(item.url),onSwipe:delta=>{if(delta<0?previousAvailable:nextAvailable)void step(delta);}});
  const noteSwipe=useImageSwipe({identity:noteImages[noteIndex]?.url,disabled:swipeDisabled,onTap:()=>setLightbox(noteImages[noteIndex].url),onSwipe:delta=>setNoteIndex(i=>Math.max(0,Math.min(noteImages.length-1,i+delta)))});
  async function undoOrder() {
    if (busy || dirty || !orderUndo) return;
    const submitted = latestFields.current;
    setBusy(true); setError('');
    try {
      await send('/api/undo/' + orderUndo.id, {});
      const [fresh, order] = await Promise.all([api('/api/items/' + item.id), api('/api/item-groups/order?id=' + encodeURIComponent(item.id))]);
      setItem(fresh);
      const pending = latestFields.current;
      if (pending.title === submitted.title) setTitle(fresh.title);
      if (pending.content === submitted.content) setContent(fresh.content);
      if (JSON.stringify(pending.tags) === JSON.stringify(submitted.tags)) setTags(fresh.tags);
      if (pending.collection_id === submitted.collection_id) setCollection(fresh.collection_id || '');
      setNoteIndex(null); setOrderUndo(null);
      onGroupOrdered?.({...order,item:fresh}); onSaved(); notify('已恢复排序和封面');
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  async function toggleFavorite() {
    if (busy || item.deleted_at) return;
    setBusy(true);
    try {
      const result = await send(`/api/items/${item.id}`, { version: item.version, favorite: !item.favorite, undo: true }, 'PATCH');
      setItem(result); onSaved(result);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  useEffect(()=>{
    const el=noteIndex!==null?noteArea.current:imageArea.current;if(!el)return;
    const wheel=e=>{if(e.ctrlKey||e.metaKey||!e.deltaY||lightbox)return;e.preventDefault();if(busy||galleryBusy||Date.now()-lastWheel.current<220)return;lastWheel.current=Date.now();const delta=Math.sign(e.deltaY);if(noteIndex!==null)setNoteIndex(i=>Math.max(0,Math.min(noteImages.length-1,i+delta)));else if(delta<0?previousAvailable:nextAvailable)step(delta)};
    el.addEventListener('wheel',wheel,{passive:false});return()=>el.removeEventListener('wheel',wheel);
  });
  useEffect(() => {
    const key = e => {
      if (item.kind === 'note' && !item.deleted_at && e.target.closest?.('[role="dialog"]')?.classList.contains('note-detail') && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && !e.isComposing && !copying && !sorting && !versionsOpen) { e.preventDefault(); if (!busy && !e.repeat) void save(); return; }
      if (lightbox || copying || sorting || busy || galleryBusy || e.repeat || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.target.isContentEditable || e.ctrlKey || e.metaKey || e.altKey) return;
      const delta=['ArrowLeft','a','A'].includes(e.key)?-1:['ArrowRight','d','D'].includes(e.key)?1:0;
      if(noteIndex!==null){if(e.key==='Escape')setNoteIndex(null);if(delta){e.preventDefault();setNoteIndex(i=>Math.max(0,Math.min(noteImages.length-1,i+delta)))}return;}
      if(item.kind!=='image')return;
      if (delta && (delta<0?previousAvailable:nextAvailable)) { e.preventDefault(); step(delta); }
      if (e.key.toLowerCase() === 'f') { e.preventDefault(); toggleFavorite(); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });
  return (
    <Dialog
      title={item.kind === 'video' ? '视频详情' : item.kind === "image" ? "图片详情" : "图文笔记"}
      onClose={close}
      className={`detail-dialog ${item.kind !== 'note' ? "image-detail" : "note-detail"}`}
    >
      <div className="detail-content">
        {item.kind === 'video' && <div className="video-stage">
          <VideoPlayer key={item.id} item={item} title={title} progress={videoProgress} onError={() => setVideoError(true)}/>
          <p>{item.width} × {item.height} · {bytes(item.bytes)} · {item.video_codec}{item.duration ? ` · ${Math.round(item.duration)} 秒` : ''}</p>
          {videoError && <p role="alert">浏览器无法播放此编码或文件。原视频已保存，可下载后使用本地播放器打开。</p>}
          <a href={item.url} download={title}>下载原视频</a>
        </div>}
        {item.kind === "image" && (
          <div className="image-stage">
            <button ref={imageArea} {...imageSwipe} onClick={() => setLightbox(item.url)} aria-label="全屏查看图片" title="左右滑动或滚轮翻图 · 点击展开缩放">
              <img src={item.url} alt={title} />
            </button>
            <span>
              {item.width} × {item.height} · {bytes(item.bytes)}
              <a href={item.url} download={title}>
                <Download size={16} />
                原图
              </a>
            </span>
            <div className="gallery-controls">
              <button disabled={!previousAvailable || busy || galleryBusy} onClick={() => step(-1)}>← 上一张</button>
              {galleryPosition && <span className="gallery-position" aria-live="polite">{galleryPosition}</span>}
              <button disabled={!nextAvailable || busy || galleryBusy} onClick={() => step(1)}>下一张 →</button>
              <HelpHint label="翻图快捷键">手机左右滑动翻图，点击展开后双指缩放；电脑用滚轮、A / D 或 ← / → 翻图，F 收藏。输入文字时不触发。</HelpHint>
            </div>
            <GalleryStrip items={galleryItems} index={galleryIndex} busy={busy||galleryBusy} onSelect={index=>step(index-galleryIndex)}/>
          </div>
        )}
        <div className="detail-editor">
          <div className="detail-editor-content">
          <div className={item.kind==='note'?'note-properties':'media-properties'}>
          {externalImages.length>0 && !item.deleted_at && <div className="note-archive-status" role="status">
            <span>{new Set(externalImages.map(i=>i.url)).size} 张配图尚未归档到本地</span>
            <button disabled={busy} onClick={save}><Download size={15}/>{busy?'正在归档…':'归档外部配图'}</button>
          </div>}
          <div className="detail-title-row">
            <span className="eyebrow">
              {item.kind === "image"
                ? "VISUAL COLLECTION"
                : "A PLACE FOR YOUR THOUGHTS"}
            </span>
            {dirty && <span className="unsaved">未保存</span>}
          </div>
          {item.kind !== 'note' && !item.deleted_at && <div className="gallery-controls">
            {isImageGroup(item)&&onSelectGroup&&<button disabled={busy||groupSelecting} onClick={()=>{if(!dirty||confirm('有尚未保存的修改，确定关闭并选择整组吗？'))onSelectGroup(item)}}>{groupSelecting?'正在选择…':'选择整组'}</button>}
            {isImageGroup(item)&&<button onClick={openSorting} disabled={busy}>调整顺序</button>}
            <button onClick={toggleFavorite} disabled={busy}>{item.favorite ? '取消收藏' : item.kind === 'video' ? '收藏视频' : '收藏图片'}</button>
            <button onClick={async () => { if (!dirty || await save()) setCopying(true); }} disabled={busy}>复用到其他知识库</button>
          </div>}
          {sourceLinks(item).length > 0 && <div className="source-info">{sourceLinks(item).map(({url, site}, index) => <p key={url}><a href={url} target="_blank" rel="noreferrer" title={url}>查看采集来源 · {site}{index > 0 ? `（${index + 1}）` : ''}</a>{index === 0 && item.captured_at && ` · ${new Date(item.captured_at).toLocaleString()}`}</p>)}</div>}
          <label className="sr-only" htmlFor="item-title">
            标题
          </label>
          <input
            id="item-title"
            className="title-input"
            placeholder="给这个想法起个名字"
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
            disabled={!!item.deleted_at}
          />
          <div className="metadata-fields">
            <label>
              <span className="metadata-label"><BookOpen size={15} />{isImageGroup(item)?'知识库 · 整组':'知识库'}</span>
              <select
                aria-label="所属知识库"
                value={collection}
                onChange={(e) => setCollection(e.target.value)}
                disabled={!!item.deleted_at}
              >
                <option value="">未分类</option>
                {collections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <div>
              <span className="metadata-label"><Hash size={15} />标签<HelpHint label="标签操作">点击标签检索当前知识库的同标签资源；点击 X 移除标签，保存后生效。</HelpHint></span>
              <TagInput
                value={tags}
                onChange={setTags}
                onTagClick={async tag => { if (!busy && (!dirty || await save())) onTagSearch?.(tag); }}
                collection={collection||null}
                disabled={!!item.deleted_at}
              />
            </div>
          </div>
          </div>
          {item.kind === "note" ? (
            <>
              <DraftConflict draft={draft.candidate} current={item} onUse={draft.useCandidate} onDiscard={draft.discardCandidate}/>
              <div className="editor-toolbar note-editor-toolbar" aria-label="笔记工具栏">
                <div className="note-editor-modes" role="group" aria-label="笔记显示方式">
                  <button
                    className={editing ? "selected" : ""}
                    aria-pressed={editing}
                    onClick={() => setEditing(true)}
                  >
                    <Pencil size={14} />
                    编辑
                  </button>
                  <button
                    className={!editing ? "selected" : ""}
                    aria-pressed={!editing}
                    onClick={() => setEditing(false)}
                  >
                    <Eye size={14} />
                    预览
                  </button>
                </div>
                <div className="note-editor-actions">
                {item.id && !item.deleted_at && <button title="版本记录" aria-label="版本记录" disabled={busy} onClick={() => setVersionsOpen(true)}><History size={16}/><span>版本记录</span></button>}
                <IconButton label="导出当前正文为 Markdown" onClick={exportCurrent}><Download size={15}/></IconButton>
                {noteImages.length>1&&!item.deleted_at&&<button title="调整配图顺序" onClick={openSorting} disabled={busy}><Layers size={16}/><span>调整配图顺序</span></button>}
                <button
                  onClick={() => input.current.click()}
                  disabled={busy || !!item.deleted_at}
                  title="插入图片"
                  aria-label="插入图片"
                >
                  <Image size={15} />
                  <span>插入图片</span>
                </button>
                </div>
              </div>
              {editing ? (
                <textarea
                  ref={draft.restorePosition}
                  className="markdown-editor"
                  aria-label="笔记正文"
                  placeholder={
                    "在这里写下想法…\n\n支持 Markdown、粘贴图片和 [[双向链接]]。"
                  }
                  value={content}
                  disabled={!!item.deleted_at || !draft.ready}
                  onSelect={draft.rememberPosition}
                  onScroll={draft.rememberPosition}
                  onChange={(e) => setContent(e.target.value)}
                  onPaste={async (e) => {
                    const files = [...e.clipboardData.files].filter((f) =>
                      f.type.startsWith("image/"),
                    );
                    if (files.length) {
                      e.preventDefault();
                      setBusy(true);
                      await uploadFiles(files, insertImages, collection || null);
                      setBusy(false);
                    }
                  }}
                />
              ) : messageNote ? (
                <MessageBlocks content={content} onChange={setContent} disabled={busy||!!item.deleted_at||!draft.ready} copyText={copyText} notify={notify}
                  render={text=><Markdown content={text} preserveSpacing onImage={src=>setNoteIndex(Math.max(0,noteImages.findIndex(i=>i.url===src)))} onLink={q=>{if(!dirty||confirm('尚未保存，确定离开吗？'))onSearch(q);}}/>}/>
              ) : (
                <div className="markdown-preview">
                  {content ? (
                    <Markdown
                      content={content}
                      onImage={src=>setNoteIndex(Math.max(0,noteImages.findIndex(i=>i.url===src)))}
                      onLink={(q) => {
                        if (!dirty || confirm("尚未保存，确定离开吗？"))
                          onSearch(q);
                      }}
                    />
                  ) : (
                    <p className="muted">
                      这里还是空白，点击「编辑」写下第一句话。
                    </p>
                  )}
                </div>
              )}
            </>
          ) : (
            <section className="description-label">
              <div className="editor-toolbar"><strong>{item.kind === 'video' ? '关于这个视频' : '关于这张图片'}</strong><button onClick={()=>setEditing(!editing)}>{editing?'预览说明':'编辑说明'}</button></div>
              {editing ? <textarea
                aria-label={item.kind === 'video' ? '视频说明' : '图片说明'}
                placeholder="记录来源、用途，或者让你想到的事情…"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                disabled={!!item.deleted_at}
              /> : <div className="markdown-preview media-description"><Markdown content={mediaDescription(content)||'暂无说明'} onLink={onSearch}/></div>}
            </section>
          )}
          {item.id && (
            <div className="backlinks">
              <span>
                <Link size={14} />
                关联笔记 <b>{backlinks.length}</b>
              </span>
              {backlinks.length ? (
                backlinks.map((n) => (
                  <button
                    key={n.id}
                    onClick={() => {
                      if (!dirty || confirm("尚未保存，确定离开吗？"))
                        onOpen(n);
                    }}
                  >
                    <FileText size={14} />
                    {n.title}
                    <ArrowUpRight size={14} />
                  </button>
                ))
              ) : (
                <small>
                  {item.kind === "image"
                    ? "把图片插入笔记后，引用会出现在这里。"
                    : "在其他笔记中使用 [[笔记标题]] 建立连接。"}
                </small>
              )}
            </div>
          )}
          {item.kind !== 'note' && (
            <button
              className="copy-reference"
              onClick={async () => {
                try {
                  await copyText(`${item.kind === 'image' ? '!' : ''}[${title}](${item.url})`);
                  notify("Markdown 引用已复制，可粘贴到笔记中");
                } catch {
                  notify("复制失败，请在原图链接中手动复制地址");
                }
              }}
            >
              <Copy size={14} />
              复制 Markdown 引用
            </button>
          )}
          </div>
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
          <div className="detail-bottom">
            <span>
              {orderUndo ? <button className="order-undo" disabled={busy||dirty} title={dirty?'请先保存当前修改，再撤销排序':'恢复本次排序前的顺序和封面'} onClick={undoOrder}><Undo2 size={15}/>撤销排序</button> : item.kind === 'note' && draft.status ? <span role="status">{draft.status}</span> :
              (item.id
                ? `更新于 ${date(item.updated_at)}`
                : "新的灵感，即将入库")}
            </span>
            <div>
              {item.id && !item.deleted_at && (
                <IconButton label="移至回收站" onClick={() => { onBeforeItemChange?.(item.kind==='note' ? [item.id,...noteImages.map(image=>image.url.match(/^\/media\/([^/]+)\//)?.[1])] : [item.id]); onDelete(item); }}>
                  <Trash2 size={17} />
                </IconButton>
              )}
              {item.deleted_at&&onPurge&&<button className="danger" onClick={()=>onPurge(item)}><Trash2 size={16}/>永久删除</button>}
              {item.deleted_at ? (
                <button className="primary" onClick={() => onRestore(item)}>
                  <RefreshCw size={16} />
                  恢复内容
                </button>
              ) : (
                <button
                  className="primary"
                  onClick={save}
                  disabled={busy || !title.trim()}
                >
                  {busy ? (
                    <Loader2 className="spin" size={16} />
                  ) : (
                    <Check size={16} />
                  )}
                  保存
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
      <input
        type="file"
        ref={input}
        accept="image/*"
        multiple
        hidden
        onChange={async (e) => {
          const files = [...e.target.files];
          e.target.value = "";
          setBusy(true);
          await uploadFiles(files, insertImages, collection || null);
          setBusy(false);
        }}
      />
      {lightbox && <ZoomViewer src={lightbox} alt={noteIndex!==null?noteImages[noteIndex]?.alt:title} onClose={()=>setLightbox(false)} busy={busy||galleryBusy}
        previousAvailable={noteIndex!==null?noteIndex>0:previousAvailable} nextAvailable={noteIndex!==null?noteIndex<noteImages.length-1:nextAvailable}
        position={noteIndex!==null?`第 ${noteIndex+1} / ${noteImages.length} 张`:galleryPosition}
        onStep={delta=>{if(noteIndex!==null){const index=noteIndex+delta;if(noteImages[index]){setNoteIndex(index);setLightbox(noteImages[index].url);}}else return step(delta);}}/>}
      {noteIndex!==null && noteImages[noteIndex] && <Dialog title="笔记配图" className="note-gallery-dialog" onClose={()=>setNoteIndex(null)}><button className="note-gallery-stage" ref={noteArea} {...noteSwipe} aria-label="展开笔记配图" onClick={()=>setLightbox(noteImages[noteIndex].url)}><img className="note-gallery-image" src={noteImages[noteIndex].url} alt={noteImages[noteIndex].alt}/></button><div className="gallery-controls">{!item.deleted_at&&<button disabled={busy} onClick={openSorting}>调整顺序</button>}<button disabled={!noteIndex} onClick={()=>setNoteIndex(i=>i-1)}>← 上一张</button><span>第 {noteIndex+1} / {noteImages.length} 张</span><button disabled={noteIndex===noteImages.length-1} onClick={()=>setNoteIndex(i=>i+1)}>下一张 →</button></div><GalleryStrip items={noteImages} index={noteIndex} onSelect={setNoteIndex}/></Dialog>}
      {versionsOpen && <React.Suspense fallback={null}><NoteVersions item={{...item,title,content}} onClose={() => setVersionsOpen(false)} onUse={async value => { if (!(await draft.keepCurrent())) return false; applyDraft({...value,collection_id:collection||null}); return true; }}/></React.Suspense>}
      {sorting && <GroupOrderDialog id={item.id} onClose={()=>setSorting(false)} onDone={result=>{setItem(result.item);setContent(result.item.content);setNoteIndex(null);setOrderUndo(result.undo);onGroupOrdered?.(result);onSaved(result);notify('顺序已保存，第一张为封面',result.undo);}}/>}
      {copying && <OrganizeDialog copy items={[item]} collections={collections} onClose={() => setCopying(false)} onDone={() => { onSaved(); notify('已复用原图到目标知识库'); }} />}
    </Dialog>
  );
}
async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext)
    return navigator.clipboard.writeText(text);
  const element = document.createElement("textarea");
  element.value = text;
  element.style.position = "fixed";
  element.style.opacity = "0";
  const active = document.activeElement;
  (document.querySelector('dialog[open]') || document.querySelector('[role="dialog"]') || document.body).append(element);
  element.select();
  const ok = document.execCommand("copy");
  element.remove();
  active?.focus({preventScroll:true});
  if (!ok) throw new Error("无法复制");
}
function SettingsPanel({
  onClose,
  notify,
  onLogout,
  collections,
  preferences,
  onPreferences,
  theme,
  setTheme,
  onExport,
}) {
  const [storage, setStorage] = useState(null);
  const [info, setInfo] = useState(null);
  const [tokens, setTokens] = useState([]);
  const [name, setName] = useState("");
  const [scope, setScope] = useState("read");
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () =>
    Promise.all([api("/api/info"), api("/api/tokens"), api("/api/storage")])
      .then(([i, t, s]) => {
        setInfo(i);
        setTokens(t);
        setStorage(s);
      })
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);
  return (
    <Dialog title="设置与连接" onClose={onClose} className="settings-dialog">
      <div className="settings-body">
        <PreferencesSections
          collections={collections}
          preferences={preferences}
          onPreferences={onPreferences}
          theme={theme}
          setTheme={setTheme}
          storage={storage}
        />
        <BackupSettings />
        <ClientSettings />
        <ExternalAssistantSettings />
        <WeixinSettings collections={collections} onOpen={id=>{onClose();const target='#item/'+id;if(location.hash===target)window.dispatchEvent(new HashChangeEvent('hashchange'));else location.hash=target;}}/>
        <section>
          <div className="settings-title"><h3>浏览器媒体工具</h3><HelpHint label="浏览器采集">悬停看高清大图，默认 S 下载、Z 入库，支持自定义快捷键。视频浮窗专门嗅探 MP4、WebM 和 m3u8，也可将网页正文保存为 Markdown；采集自动保留来源。</HelpHint><HelpHint label="扩展安装与更新">Chrome / Edge 安装后刷新本页，再点击一键连接。更新时覆盖同一目录、重新加载扩展，连接和偏好会保留。0.7 及更早版本首次升级需移除旧版并重新连接一次。m3u8 合并使用本机 ZNote 服务。</HelpHint></div>

          <div className="connection-actions"><a className="button" href="/api/clipper/download"><Download size={16} />下载扩展</a><button className="primary" data-znote-connect onClick={() => notify('请先安装新版扩展并刷新本页，再点击一键连接')}>一键连接扩展</button></div>
          <p id="znote-connect-status" role="status" className="muted"></p>
        </section>
        <section>
          <div className="settings-title"><h3>其他插件</h3><HelpHint label="其他插件接入">其他插件可通过 ZNote API 保存图片、笔记和套图。请从插件自身的设置中连接知识库，并使用写入令牌；令牌可以在下方管理。专用插件独立维护，不随知识库分发。</HelpHint></div>
          <div className="connection-actions"><a className="button" href="/api/docs" target="_blank" rel="noreferrer">API 接入文档</a></div>

        </section>
        <WebhookSettings />
        <section>
          <div className="settings-title">
            <Globe size={20} />
            <h3>局域网访问</h3><HelpHint label="局域网访问">设备需保持开机；无法连接时，请检查路由器隔离和系统防火墙的 3741 端口。</HelpHint>
          </div>
          <p>
            手机、平板和电脑连接同一个局域网，在浏览器打开以下地址，输入访问密码即可。
          </p>
          {info?.addresses.map((url) => (
            <div className="address" key={url}>
              <code>{url}</code>
              <IconButton
                label={`复制 ${url}`}
                onClick={() =>
                  copyText(url)
                    .then(() => notify("地址已复制"))
                    .catch((e) => setError(e.message))
                }
              >
                <Copy size={16} />
              </IconButton>
            </div>
          ))}
          {info && !info.addresses.length && (
            <p>没有检测到局域网地址，请检查设备的网络连接。</p>
          )}

        </section>
        <section>
          <div className="settings-title">
            <Code2 size={20} />
            <h3>开放 API</h3><HelpHint label="API 令牌">使用独立令牌接入脚本、自动化和其他平台，可选择只读或读写权限，也可随时撤销。增量事件可从 GET /api/events?after=0 读取。</HelpHint>
            <a href="/api-docs" target="_blank" rel="noreferrer">
              接口文档 <ArrowUpRight size={15} />
            </a>
          </div>
          <details className="code-example"><summary>查看调用示例</summary><pre>
            curl {window.location.origin}/api/items \ -H "Authorization: Bearer
            YOUR_TOKEN"
          </pre></details>
          <form
            className="token-form"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                const token = await send("/api/tokens", { name, scope });
                setSecret(token.token);
                setName("");
                await load();
              } catch (e) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <input
              aria-label="令牌名称"
              required
              placeholder="令牌名称，例如：浏览器采集助手"
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
            />
            <select
              aria-label="令牌权限"
              value={scope}
              onChange={(e) => setScope(e.target.value)}
            >
              <option value="read">只读</option>
              <option value="write">读写</option>
              <option value="notify">仅通知（不能读写知识库）</option>
            </select>
            <button disabled={busy || !!secret}>
              <Plus size={16} />
              创建令牌
            </button>
          </form>
          {secret && (
            <div className="secret">
              <strong>请保存令牌，仅在此展示一次</strong>
              <code>{secret}</code>
              <button
                onClick={() =>
                  copyText(secret)
                    .then(() => notify("令牌已复制"))
                    .catch((e) => setError(e.message))
                }
              >
                <Copy size={14} />
                复制
              </button>
              <button onClick={() => setSecret("")}>我已保存</button>
            </div>
          )}
          <div className="token-list">
            {tokens.map((token) => (
              <div key={token.id}>
                <KeyRound size={17} />
                <span>
                  <strong>{token.name}</strong>
                  <small>
                    {token.scope === "notify" ? "仅通知" : token.scope === "read" ? "只读" : "读写"} ·{" "}
                    {date(token.created_at)}
                  </small>
                </span>
                <button
                  className="text-button danger"
                  onClick={async () => {
                    try {
                      await api(`/api/tokens/${token.id}`, {
                        method: "DELETE",
                      });
                      await load();
                      notify("令牌已撤销");
                    } catch (e) {
                      setError(e.message);
                    }
                  }}
                >
                  撤销
                </button>
              </div>
            ))}
          </div>

        </section>
        <section>
          <div className="settings-title">
            <Download size={20} />
            <h3>数据导出</h3><HelpHint label="导出格式">支持图片、Markdown、JSON、离线网页、资料包，以及可完整恢复的备份 ZIP。</HelpHint>
          </div>

          <button onClick={onExport}>
            <Download size={16} />
            选择导出方式
          </button>
        </section>
        {error && <div className="error">{error}</div>}
        <div className="settings-footer">
          <span>
            ZNote {info?.version} · {info?.storage}
          </span>
          <button onClick={() => onLogout().catch((e) => setError(e.message))}>
            <LogOut size={15} />
            退出登录
          </button>
        </div>
      </div>
    </Dialog>
  );
}

createRoot(document.getElementById("root")).render(<AppearanceProvider><App /></AppearanceProvider>);
