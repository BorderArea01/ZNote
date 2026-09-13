import { HelpHint } from './HelpHint.jsx';
import { useTagPage } from './useTagPage.js';
import {useTaskStore,useTaskSnapshot,queueUploads,startExport} from './Tasks.jsx';
import React, { useEffect, useRef, useState } from "react";
import {
  Sun,
  Moon,
  Monitor,
  X,
  Plus,
  Upload,
  Check,
  Loader2,
  Download,
  HardDrive,
  Home,
  Hash,
  RefreshCw,
} from "lucide-react";
import { Dialog, IconButton } from "./ui.jsx";
import { api, send, bytes, uploadFile } from "./api.js";
import { AppearanceSettings } from './appearance.jsx';

export function useTheme() {
  const [theme, setTheme] = useState(() => {
    try {
      const stored = localStorage.getItem("znote-theme");
      return ['light', 'dark', 'system'].includes(stored) ? stored : 'system';
    } catch {
      return "system";
    }
  });
  const [resolvedTheme, setResolvedTheme] = useState(() => document.documentElement.dataset.theme || 'light');
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const resolved = theme === "system" ? (media.matches ? "dark" : "light") : theme;
      document.documentElement.dataset.theme = resolved;
      setResolvedTheme(resolved);
    };
    apply();
    media.addEventListener("change", apply);
    try {
      localStorage.setItem("znote-theme", theme);
    } catch {}
    return () => media.removeEventListener("change", apply);
  }, [theme]);
  return [theme, setTheme, resolvedTheme];
}
export function TagInput({
  value,
  onChange,
  suggestions = [],
  collection,
  label = "标签",
  disabled = false,
}) {
  const [draft, setDraft] = useState("");
  const [retry,setRetry]=useState(0),suggestionList=useRef(),tagInput=useRef();
  const model=useTagPage(collection,{query:draft.slice(0,200),limit:40,revision:retry,enabled:collection!==undefined&&!disabled});
  const matches=(collection===undefined?suggestions:model.tags).filter(t=>!value.includes(t.name)&&t.name.toLowerCase().includes(draft.trim().toLowerCase())).slice(0,8);
  const add = (text) => {
    const tags = text
      .split(/[,，\n]/)
      .map((t) => t.trim())
      .filter(Boolean);
    if (tags.length) onChange([...new Set([...value, ...tags])]);
    setDraft("");
  };
  return (
    <div className="tag-input-group" onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget))add(draft)}}>
      <div className={`tag-input ${disabled ? "disabled" : ""}`}>
        {value.map((tag) => (
          <span className="tag-pill" key={tag}>
            {tag}
            <button
              type="button"
              aria-label={`移除标签 ${tag}`}
              disabled={disabled}
              onClick={() => onChange(value.filter((v) => v !== tag))}
            >
              <X size={12} />
            </button>
          </span>
        ))}
        <input
          ref={tagInput}
          aria-label={label}
          disabled={disabled}
          placeholder={value.length ? "继续添加…" : "输入标签，回车或逗号添加"}
          value={draft}
          maxLength={1200}
          onChange={(e) => {
            const text = e.target.value;
            if (/[,，\n]/.test(text)) {
              const chunks = text.split(/[,，\n]/);
              const last = chunks.pop();
              const tags = chunks.map((s) => s.trim()).filter(Boolean);
              onChange([...new Set([...value, ...tags])]);
              setDraft(last);
            } else setDraft(text);
          }}
          onKeyDown={(e) => {
            if(e.nativeEvent.isComposing)return;
            if(e.key==='ArrowDown'&&matches.length){e.preventDefault();suggestionList.current?.querySelector('button')?.focus();return;}
            if (e.key === "Enter") {
              e.preventDefault();
              add(draft);
            }
            if (e.key === "Backspace" && !draft && value.length)
              onChange(value.slice(0, -1));
          }}
        />
      </div>
      {!disabled && (
        <div className="tag-suggestions" ref={suggestionList} aria-label="标签推荐">
          {matches
            .map((t) => (
              <button
                type="button"
                key={t.name}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange([...new Set([...value,t.name])]);
                  setDraft("");
                  tagInput.current?.focus();
                }}
              >
                + {t.name}
              </button>
            ))}
          {model.error&&<button type="button" onMouseDown={e=>e.preventDefault()} onClick={()=>setRetry(n=>n+1)}>重试标签推荐</button>}
        </div>
      )}
    </div>
  );
}
export function UploadDialog({
  files = [],
  collections,
  currentCollection,
  suggestions,
  onClose,
  onComplete,
  onOrganize,
  kind = 'image',
}) {
  const taskStore=useTaskStore(),taskSnapshot=useTaskSnapshot();
  const taskById=new Map(taskSnapshot.jobs.map(job=>[job.id,job]));
  const [runError,setRunError]=useState('');
  const [uploadPage,setUploadPage]=useState(0);
  const [rows, setRows] = useState(() =>
    files.map((file) => ({
      id: Math.random(),
      file,
      status: "pending",
      progress: 0,
    })),
  );
  const [collection, setCollection] = useState(currentCollection || "");
  const [tags, setTags] = useState([]);
  const [submitting, setRunning] = useState(false);
  const displayRows=rows.map(original=>{const task=taskById.get(original.task_id);return task?{...original,item:taskStore.result(task.id)||original.item,progress:task.progress,error:task.message,status:task.status==='completed'?(task.duplicate?'duplicate':'done'):task.status==='failed'||task.status==='cancelled'?'error':task.status==='queued'?'pending':'running'}:original});
  const running=submitting||displayRows.some(row=>row.status==='running'||row.status==='pending'&&row.task_id&&taskById.get(row.task_id)?.status==='queued');
  const queuedIds=useRef([]);
  const picker = useRef();
  const update = (id, patch) =>
    setRows((previous) =>
      previous.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    );
  const addFiles = (files) =>
    setRows((previous) => [
      ...previous,
      ...[...files].map((file) => ({
        id: Math.random(),
        file,
        status: "pending",
        progress: 0,
      })),
    ]);
  async function run() {
    setRunning(true);
    setRunError('');
    const pending=displayRows.filter(row=>['pending','error'].includes(row.status));
    try {
      pending.forEach(row=>{if(row.task_id)taskStore.forget(row.task_id)});
      const tickets=queueUploads(taskStore,pending.map(r=>r.file),collection,tags);queuedIds.current=tickets.map(t=>t.id);
      tickets.forEach((ticket,index)=>update(pending[index].id,{task_id:ticket.id,status:'running',error:''}));
      await Promise.all(tickets.map(async(ticket,index)=>{const result=await ticket.promise;update(pending[index].id,result.ok?{item:result.value,status:result.value.duplicate?'duplicate':'done',progress:100}:{status:'error',error:result.error.message});}));
      onComplete();
    } catch(e){setRunError(e.message);}
    finally{setRunning(false);}
  }
  const pending = displayRows.some((r) => ["pending", "error"].includes(r.status));
  return (
    <Dialog
      title={kind === 'video' ? '批量上传视频' : '批量上传图片'}
      onClose={onClose}
      className="upload-dialog"
    >
      <div className="feature-body">
        <div className="upload-guidance"><span>{kind === 'video' ? '单个文件 ≤ 500 MB' : '单张图片 ≤ 25 MB'}</span><HelpHint label="批量上传">
          {kind === 'video' ? '支持 MP4、WebM、MOV，每个不超过 500 MB。保存原文件，浏览器可播放的编码支持直接预览；不支持时可下载。' : '一次选择多张图片，统一放入知识库并添加多个标签。每张不超过 25 MB。'}
        </HelpHint></div>
        <div
          className="upload-drop"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (!running) addFiles(e.dataTransfer.files);
          }}
        >
          <Upload size={25} />
          <span>{kind === 'video' ? '拖入多个视频，或选择文件' : '拖入多张图片，或选择文件'}</span>
          <button onClick={() => picker.current.click()} disabled={running}>
            {kind === 'video' ? '选择视频' : '选择图片'}
          </button>
        </div>
        <input
          ref={picker}
          type="file"
          multiple
          accept={kind === 'video' ? '.mp4,.webm,.mov,video/mp4,video/webm,video/quicktime' : 'image/jpeg,image/png,image/webp,image/gif,image/avif'}
          hidden
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <label className="feature-field">
          上传到知识库
          <select
            aria-label="上传到知识库"
            value={collection}
            onChange={(e) => setCollection(e.target.value)}
            disabled={running}
          >
            <option value="">未分类</option>
            {collections.map((c) => (
              <option value={c.id} key={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="feature-field">统一添加标签</label>
        <TagInput
          label="批量上传标签"
          value={tags}
          onChange={setTags}
          collection={collection||null}
          disabled={running}
        />
        <div className="upload-queue">
          {displayRows.slice(uploadPage*50,uploadPage*50+50).map((row) => (
            <div className="upload-row" key={row.id}>
              <div>
                <strong>{row.file.name}</strong>
                <small>
                  {bytes(row.file.size)} ·{" "}
                  {
                    {
                      pending: "等待上传",
                      running:
                        row.progress === 100
                          ? "正在验证文件并入库…"
                          : `${row.progress}%`,
                      done: "上传成功",
                      duplicate: "已存在，复用原图片",
                      error: row.error,
                    }[row.status]
                  }
                </small>
                <progress value={row.progress} max="100" />
              </div>
              {row.status === "done" || row.status === "duplicate" ? (
                <Check size={17} />
              ) : row.status === "running" ? (
                <Loader2 className="spin" size={17} />
              ) : (
                <IconButton
                  label={`移除文件 ${row.file.name}`}
                  disabled={running}
                  onClick={() =>
                    setRows((previous) =>
                      previous.filter((r) => r.id !== row.id),
                    )
                  }
                >
                  <X size={16} />
                </IconButton>
              )}
            </div>
          ))}
        </div>
        {displayRows.length>50&&<nav className="feature-actions" aria-label="上传文件分页"><button disabled={!uploadPage} onClick={()=>setUploadPage(n=>n-1)}>上一页文件</button><span>{uploadPage+1} / {Math.ceil(displayRows.length/50)}</span><button disabled={(uploadPage+1)*50>=displayRows.length} onClick={()=>setUploadPage(n=>n+1)}>下一页文件</button></nav>}
        <div className="feature-actions">
          <small>
            共 {rows.length} 个 · 完成{" "}
            {
              displayRows.filter((r) => ["done", "duplicate"].includes(r.status))
                .length
            }{" "}
            个 · 失败 {displayRows.filter((r) => r.status === "error").length} 个
          </small>
          {!running && displayRows.some(r => r.item?.kind === 'image') && <button onClick={() => onOrganize?.([...new Map(displayRows.filter(r => r.item?.kind === 'image').map(r => [r.item.id, r.item])).values()])}>整理已上传图片</button>}
          {running ? (
            <button
              onClick={() => {
                queuedIds.current.forEach(id=>{if(taskById.get(id)?.status==='queued')taskStore.cancel(id)});
              }}
            >
              停止后续上传
            </button>
          ) : pending ? (
            <button className="primary" onClick={run}>
              <Upload size={16} />
              {displayRows.some((r) => r.status === "error")
                ? "重试失败 / 继续上传"
                : "开始上传"}
            </button>
          ) : (
            <button onClick={onClose}>完成</button>
          )}
        </div>
        {running&&<p className="muted">可关闭此窗口，上传会继续；右上角「任务」可查看进度。</p>}
        {runError&&<p role="alert" className="error">{runError}</p>}
      </div>
    </Dialog>
  );
}
const exportModes = {
  portable: ["资料包 ZIP", "Markdown、原图、视频与元数据清单，适合迁移。"],
  images: ["图片包 ZIP", "只导出所选范围的原图，附图片标签和信息清单。"],
  markdown: ["Markdown ZIP", "笔记正文与所引用的图片、视频附件。"],
  json: ["JSON 元数据", "标题、正文、标签及分类；不包含媒体文件。"],
  html: ["离线网页 ZIP", "解压后阅读图文、浏览图片及播放浏览器支持的视频。"],
  backup: [
    "完整备份 ZIP",
    "所有知识库、数据库、图片与视频。包含登录数据，可恢复到其他设备。",
  ],
};
export function ExportDialog({ collections, currentCollection, onClose }) {
  const taskStore=useTaskStore();
  const [submitted,setSubmitted]=useState(false);
  const [mode, setMode] = useState("portable");
  const [scope, setScope] = useState(currentCollection || "all");
  const [trash, setTrash] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function download() {
    setBusy(true);
    setSubmitted(false);
    setError("");
    try {
      const params = new URLSearchParams({
        mode,
        include_trash: String(trash),
      });
      if (scope !== "all" && mode !== "backup") params.set("collection", scope);
      await startExport(taskStore,Object.fromEntries(params));
      setSubmitted(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title="导出知识库" onClose={onClose} className="export-dialog">
      <div className="feature-body">
        <div className="export-modes">
          {Object.entries(exportModes).map(([key, [name, description]]) => (
            <button
              key={key}
              className={mode === key ? "selected" : ""}
              onClick={() => setMode(key)}
              aria-pressed={mode === key}
            >
              <Download size={19} />
              <strong>{name}</strong>
              <small>{description}</small>
            </button>
          ))}
        </div>
        <label className="feature-field">
          导出范围
          <select
            aria-label="导出范围"
            value={mode === "backup" ? "all" : scope}
            onChange={(e) => setScope(e.target.value)}
            disabled={mode === "backup" || busy}
          >
            <option value="all">全部知识库</option>
            <option value="unfiled">未分类</option>
            {collections.map((c) => (
              <option value={c.id} key={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={mode === "backup" || trash}
            disabled={mode === "backup" || busy}
            onChange={(e) => setTrash(e.target.checked)}
          />
          包含回收站
        </label>
        <p className="muted">
          {mode === "backup"
            ? "可在备份设置中上传并预览恢复；完整备份包含全部知识库和访问设置。"
            : "图文包会附带笔记引用的图片，即使图片位于其他知识库，以保持阅读完整。"}
        </p>
        {error && <div className="error">{error}</div>}
        {submitted?<p role="status">导出已提交，可在「任务」或浏览器下载列表查看。</p>:<p className="muted">浏览器直接接收下载文件，无需在网页中暂存整包。右上角「任务」可查看导出状态。</p>}
        <div className="feature-actions">
          <button className="primary" onClick={download} disabled={busy}>
            {busy ? (
              <Loader2 className="spin" size={16} />
            ) : (
              <Download size={16} />
            )}{" "}
            {busy ? "正在打包…" : "下载导出文件"}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
export function BatchTagsDialog({ items, suggestions, collection, onClose, onSaved }) {
  const [tags, setTags] = useState([]),
    [mode, setMode] = useState("add"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <Dialog
      title={`批量标签 · ${items.length} 项内容`}
      onClose={()=>!busy&&onClose()}
      className="small-dialog"
    >
      <div className="feature-body">
        <label className="feature-field">
          操作方式
          <select
            aria-label="批量标签操作"
            value={mode}
            onChange={(e) => setMode(e.target.value)}
          >
            <option value="add">添加标签（保留原有标签）</option>
            <option value="remove">移除指定标签</option>
            <option value="replace">替换全部标签</option>
          </select>
        </label>
        <TagInput
          value={tags}
          onChange={setTags}
          suggestions={suggestions}
          collection={collection}
          label="批量编辑标签"
        />
        {error && <div className="error">{error}</div>}
        <div className="feature-actions">
          <button
            className="primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const result = await send("/api/items/batch-tags", {
                  undo: true,
                  items: items.map((i) => ({ id: i.id, version: i.version })),
                  tags,
                  mode,
                });
                onSaved(result);
                onClose();
              } catch (e) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            应用标签
          </button>
        </div>
      </div>
    </Dialog>
  );
}
export function PreferencesSections({
  collections,
  preferences,
  onPreferences,
  theme,
  setTheme,
  storage,
}) {
  const [error, setError] = useState("");
  return (
    <>
      <section>
        <div className="settings-title">
          <Moon size={20} />
          <h3>外观</h3><HelpHint label="外观设置">主题、色调和明暗模式保存在当前设备，刷新后仍然生效。</HelpHint>
        </div>
        <AppearanceSettings />
        <p className="appearance-label">明暗模式</p>
        <div className="theme-choices">
          {[
            ["light", "浅色", Sun],
            ["dark", "夜间", Moon],
            ["system", "跟随系统", Monitor],
          ].map(([key, label, Icon]) => (
            <button
              key={key}
              className={theme === key ? "selected" : ""}
              aria-pressed={theme === key}
              onClick={() => setTheme(key)}
            >
              <Icon size={17} />
              {label}
            </button>
          ))}
        </div>

      </section>
      <section>
        <div className="settings-title">
          <Home size={20} />
          <h3>默认展示的知识库</h3><HelpHint label="默认知识库">登录或打开首页时只展示选定知识库。未指定时显示知识库入口；此设置适用于你的所有设备。</HelpHint>
        </div>

        <select
          aria-label="默认展示的知识库"
          value={preferences.default_collection_id || ""}
          onChange={async (e) => {
            try {
              setError("");
              const result = await send(
                "/api/preferences",
                { default_collection_id: e.target.value || null },
                "PATCH",
              );
              onPreferences(result);
            } catch (e) {
              setError(e.message);
            }
          }}
        >
          <option value="">知识库入口（不混合展示图片）</option>
          <option value="unfiled">未分类</option>
          {collections.map((c) => (
            <option value={c.id} key={c.id}>
              {c.name}
            </option>
          ))}
        </select>

        {error && <div className="error">{error}</div>}
      </section>
      <section>
        <div className="settings-title">
          <HardDrive size={20} />
          <h3>存储占用</h3><HelpHint label="存储统计">原图按字节无损保存，仅压缩后更小时才采用压缩。缩略图在内存按需生成，视频保留原文件。统计包含回收站、数据库及日志，不含程序和备份；数据库有额外开销，不能保证总空间小于直接存文件。</HelpHint>
        </div>
        {storage ? (
          <>
            <div className="storage-metrics">
              <div>
                <small>原图与视频文件合计</small>
                <strong>{bytes(storage.source_bytes)}</strong>
              </div>
              <div>
                <small>实际媒体文件</small>
                <strong>{bytes(storage.media_bytes)}</strong>
              </div>
              <div>
                <small>数据库及日志</small>
                <strong>{bytes(storage.database_bytes)}</strong>
              </div>
              <div>
                <small>当前数据总计</small>
                <strong>{bytes(storage.total_bytes)}</strong>
              </div>
            </div>
            <p>
              媒体文件节省 {bytes(storage.media_saved_bytes)}；计入数据库后，
              {storage.total_saved_bytes >= 0 ? "总计节省" : "额外占用"}{" "}
              {bytes(Math.abs(storage.total_saved_bytes))}。
            </p>

          </>
        ) : (
          <p>正在读取存储信息…</p>
        )}
      </section>
    </>
  );
}
