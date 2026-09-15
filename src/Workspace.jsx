import {isImageGroup} from './image-group.js';
import {detachImageFromGroup} from './group-detach.js';
import {TrashDialog} from './TrashDialog.jsx';
import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from "react";
import { VirtualItems } from './VirtualItems.jsx';
import { PageLoader, readAutoPages, saveAutoPages } from './PageLoader.jsx';
import { ReadingProgress, useReadingProgress } from './ReadingProgress.jsx';
import { VideoHistory } from './VideoProgress.jsx';
import { extendPageWindow } from './page-window.js';
import { changeSelection, collectSelection, resolveSelectionCards } from './selection.js';
import { GroupSelectionDialog } from './GroupSelectionDialog.jsx';
import { SelectionBar } from './SelectionBar.jsx';
import { SelectionEntry } from './SelectionEntry.jsx';
import {useAppBack} from './back-navigation.js';
import {ExternalAssistantLink} from './ExternalAssistant.jsx';
import './selection.css';
import { readBrowse, writeBrowse, captureAnchor } from './browse-memory.js';
import { UndoCenter } from './UndoCenter.jsx';
import { DraftsDialog } from './NoteDrafts.jsx';
import { useSavedViews, SavedViewList } from './SavedViews.jsx';
const SavedViewDialog = React.lazy(() => import('./SavedViewDialog.jsx'));
const GroupOrganizeDialog = React.lazy(() => import('./GroupOrganizeDialog.jsx'));
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
  Grid3X3,
  ListFilter,
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
  History,
  BookmarkPlus,
  ArrowUpToLine,
  ChevronUp,
  CheckCheck,
} from "lucide-react";
import { api, send } from "./api.js";
import { HelpHint } from './HelpHint.jsx';
import { IconButton } from "./ui.jsx";
import { UploadDialog, ExportDialog, BatchTagsDialog } from "./features.jsx";
import { OrganizeDialog } from './organize.jsx';
import { TagFilter } from './TagFilter.jsx';
import {useTagPage} from './useTagPage.js';
import { ImportsDialog } from './Imports.jsx';
import {TaskButton,TaskCenter,useTaskStore,queueUploads} from './Tasks.jsx';
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
  const [groupOrganizing, setGroupOrganizing] = useState(false);
  const [purging,setPurging]=useState(null);
  const [selectionRows,setSelectionRows]=useState({}),[groupSelecting,setGroupSelecting]=useState(false);
  const groupRequest=useRef(0);
  const detailDetachPlan=useRef(null);
  const [groupPicker,setGroupPicker]=useState(null);
  const [selectionProgress, setSelectionProgress] = useState(null), [knownGroups, setKnownGroups] = useState({});
  const selectionRequest = useRef(null);
  const itemById = useMemo(() => new Map(items.map(item => [item.id, item])), [items]);
  const selectedIds = useMemo(() => new Set(selection), [selection]);
  const selectedGroups = useMemo(() => new Set(Object.entries(knownGroups).filter(([,ids])=>ids.length&&ids.every(id=>selectedIds.has(id))).map(([key])=>key)),[knownGroups,selectedIds]);
  const chosenItems=selection.map(id=>{
    const cached=selectionRows[id],visible=itemById.get(id);
    return !cached || (visible && visible.version >= cached.version) ? visible : cached;
  }).filter(Boolean);
  const selectedGroupCounts = new Map();
  chosenItems.forEach(row=>{if(row.group_key)selectedGroupCounts.set(row.group_key,(selectedGroupCounts.get(row.group_key)||0)+1);});
  const cardSelected = item => isImageGroup(item) ? selectedGroups.has(item.group_key) : selectedIds.has(item.id);
  const cardPartial = item => isImageGroup(item)&&!cardSelected(item)&&!!selectedGroupCounts.get(item.group_key);
  const [batchBusy, setBatchBusy] = useState(false);
  const [gallery, setGallery] = useState(null);
  const [galleryBusy, setGalleryBusy] = useState(false);
  const [openingItem, setOpeningItem] = useState(null);
  const [undoReceipt, setUndoReceipt] = useState(null), [undoOpen, setUndoOpen] = useState(false);
  const [draftsOpen, setDraftsOpen] = useState(false);
  const [readingOpen, setReadingOpen] = useState(false);
  const taskStore=useTaskStore(),[tasksOpen,setTasksOpen]=useState(false);
  const recordUndo = result => { if (result?.undo) { setToast(''); setUndoReceipt(result.undo); } };
  const saved = result => {
    if (result?.items) {
      const changed = new Map(result.items.map(row => [row.id, row]));
      setSelectionRows(previous => ({...previous,...Object.fromEntries(changed)}));
      setItems(previous => previous.map(row => changed.has(row.id) ? {...row,...changed.get(row.id)} : row));
      setSelection(previous => previous.filter(id => {
        const row = changed.get(id);
        return !row || (row.collection_id === actualCollection && Boolean(row.deleted_at) === (view === 'trash'));
      }));
    }
    recordUndo(result); refresh();
  };
  const taskRefresh=useRef();taskRefresh.current=()=>refresh();
  useEffect(()=>{let last=taskStore.getSnapshot().changes,timer;const unsubscribe=taskStore.subscribe(()=>{const current=taskStore.getSnapshot().changes;if(last!==current){last=current;clearTimeout(timer);timer=setTimeout(()=>taskRefresh.current(),500);}});return()=>{unsubscribe();clearTimeout(timer)}},[taskStore]);
  const [pageOffset, setPageOffset] = useState(0), [paging, setPaging] = useState(false);
  const [autoPages, setAutoPages] = useState(readAutoPages), [pageError, setPageError] = useState(null);
  const [resumeBrowse, setResumeBrowse] = useState(null);
  const [awayFromStart, setAwayFromStart] = useState(false);
  const selectedRowsRef = useRef(chosenItems); selectedRowsRef.current = chosenItems;
  const [updatesAvailable, setUpdatesAvailable] = useState(false);
  const pagingRequest = useRef(null), restoreAnchor = useRef(null), pendingBrowse = useRef(null);
  const selectionAnchor = useRef(null), browsing = useRef(null), previousParams = useRef(null);
  const eventCursor = useRef(0);
  const routeTrail = useRef([]);
  function rememberRoute(nextCollection,nextView) {
    if(collection===nextCollection&&view===nextView)return;
    routeTrail.current.push({collection,view});
  }
  browsing.current = { library: collection, view, query, tags: selectedTags, mode: tagMode, sort, layout, loading, offset: pageOffset };
  function rememberBrowse() {
    const state = browsing.current;
    if (!state || state.loading) return;
    writeBrowse(state.library, state.view, { query: state.query, tags: state.tags, mode: state.mode, sort: state.sort, layout: state.layout, anchor: captureAnchor(), offset: state.offset, awayFromStart: state.offset > 0 || window.scrollY > 600 });
  }
  function restoreBrowse(id, targetView, restorePosition = false) {
    const saved = readBrowse(id, targetView);
    pendingBrowse.current = restorePosition ? saved.anchor : null;
    setResumeBrowse(!restorePosition && saved.anchor && saved.awayFromStart ? { library:id, ...saved } : null);
    setView(saved.view); setQuery(saved.query); setSearch(saved.query);
    setSelectedTags(saved.tags); setTagMode(saved.mode); setSort(saved.sort); setLayout(saved.layout);
  }
  useEffect(() => {
    let timer;
    const schedule = () => { clearTimeout(timer); timer = setTimeout(rememberBrowse, 350); };
    const leave = () => { if (document.visibilityState === 'hidden') rememberBrowse(); };
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('pagehide', rememberBrowse); document.addEventListener('visibilitychange', leave);
    return () => { clearTimeout(timer); window.removeEventListener('scroll', schedule); window.removeEventListener('pagehide', rememberBrowse); document.removeEventListener('visibilitychange', leave); };
  }, []);
  useEffect(() => {
    let frame = 0;
    const measure = () => { frame = 0; setAwayFromStart(old => { const next = window.scrollY > Math.max(600, innerHeight * .8); return old === next ? old : next; }); };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    window.addEventListener('scroll', schedule, {passive:true}); window.addEventListener('resize', schedule); measure();
    return () => { cancelAnimationFrame(frame); window.removeEventListener('scroll', schedule); window.removeEventListener('resize', schedule); };
  }, []);
  useEffect(() => { if (ready && !loading) rememberBrowse(); }, [ready, loading, query, selectedTags, tagMode, sort, layout, view, collection]);
  useLayoutEffect(() => {
    if (loading) return;
    const anchor = restoreAnchor.current;
    if (!anchor) return;
    let active = true, expectedScroll = window.scrollY;
    const restore = () => {
      if (!active) return;
      const card = [...document.querySelectorAll('.item-card[data-item-id]')].find(el => el.dataset.itemId === anchor.id);
      if (card) window.scrollBy({ top: card.getBoundingClientRect().top - anchor.top, behavior: 'instant' });
      else window.scrollTo({ top: 0, behavior: 'instant' });
      expectedScroll = window.scrollY;
    };
    restore();
    // Tags and history panels can settle after the list response. Keep the
    // anchor through those layout changes, but yield immediately to the user.
    const stop = () => { active = false; observer.disconnect(); if(restoreAnchor.current===anchor)restoreAnchor.current=null; };
    const scrolled = () => { if(Math.abs(window.scrollY-expectedScroll)>1)stop(); };
    const observer = new ResizeObserver(restore);
    const content = document.querySelector('.main-content');
    if(anchor.id && content)observer.observe(content);
    const frame = requestAnimationFrame(() => { restore(); if(!anchor.id)stop(); });
    const inputs=['wheel','touchstart','pointerdown','keydown'];
    inputs.forEach(type=>window.addEventListener(type,stop,{passive:true,capture:true}));
    window.addEventListener('scroll',scrolled,{passive:true});
    return () => { cancelAnimationFrame(frame); stop(); inputs.forEach(type=>window.removeEventListener(type,stop,true)); window.removeEventListener('scroll',scrolled); };
  }, [loading, items, selecting]);
  const [imageExpanded,setImageExpanded] = useState(false);
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
  const refresh = () => { pendingBrowse.current = captureAnchor(); setUpdatesAvailable(false); setRevision((n) => n + 1); },
    notify = (message, receipt = null) => { setUndoReceipt(receipt); setToast(receipt && !selected ? '' : message); };
  const actualCollection = collection === "unfiled" ? null : collection;
  const reading = useReadingProgress(actualCollection, ready && view !== 'home', revision);
  const videoProgress = useReadingProgress(actualCollection, ready && view !== 'home', revision, 'video');
  async function resumeVideo(row) {
    const current=++detailGeneration.current;
    try {
      const item=await api('/api/items/'+row.item_id);
      if(current!==detailGeneration.current)return;
      if(item.deleted_at||item.collection_id!==actualCollection||item.kind!=='video')throw Error('视频已移动、删除或更换，请刷新播放记录');
      setGallery([]);setSelected({...item,resume_position:row.completed?0:row.position});
    }catch(e){if(current===detailGeneration.current){notify(e.message);videoProgress.reload();}}
  }
  useEffect(() => { if (selected?.kind === 'image' && !selected.deleted_at && selected.collection_id === actualCollection) reading.record(selected.id); }, [selected?.id, actualCollection]);
  async function resumeReading(row) {
    const current = ++detailGeneration.current;
    try {
      const item = await api('/api/items/' + row.item_id);
      if (current !== detailGeneration.current) return;
      if (item.deleted_at || item.collection_id !== actualCollection || item.group_key !== row.group_key) throw Error('这张图片已移动、删除或重新分组，请刷新浏览记录');
      if (item.group_key) await openItem({...item,group_count:row.total});
      else { setGallery([{id:item.id,thumbnail_url:item.thumbnail_url}]); setSelected(item); }
    } catch (e) { if (current === detailGeneration.current) { notify(e.message); reading.reload(); } }
  }
  const savedViews = useSavedViews(actualCollection, ready && view !== 'home');
  const sidebarTags=useTagPage(actualCollection,{limit:30,revision,enabled:ready&&view!=='home'}),tags=sidebarTags.tags;
  const [savedViewEditor, setSavedViewEditor] = useState(null);
  const currentViewConfig = { view, query, tags: selectedTags, mode: tagMode, sort, layout };
  const editSavedView = row => setSavedViewEditor({ row, current: currentViewConfig, library: actualCollection });
  const applySavedView = row => {
    if (row.collection_id !== actualCollection) return;
    resetScope(); const config = row.config;
    setView(config.view); setQuery(config.query); setSearch(config.query); setSelectedTags(config.tags);
    setTagMode(config.mode); setSort(config.sort); setLayout(config.layout);
  };
  function openPurge(ids){closeDetail();setPurging({collectionId:actualCollection,ids,libraryName:collections.find(c=>c.id===actualCollection)?.name||'未分类'});}
  async function selectCards(cards, mode='toggle', {enter=false,picker=false,announce=false}={}) {
    if(groupSelecting||batchBusy||selectionProgress||loading)return;
    const request=++groupRequest.current,current=generation.current,anchor=captureAnchor();
    setGroupSelecting(true);
    try{
      const result=await resolveSelectionCards(api,cards,{collectionId:actualCollection,trash:view==='trash'});
      if(request!==groupRequest.current||current!==generation.current)return;
      const members=result.rows.map(row=>({...itemById.get(row.id),...selectionRows[row.id],...row}));
      setKnownGroups(previous=>({...previous,...result.groups}));
      if(picker){setToast('');setGroupPicker({title:cards[0].group_title||cards[0].title,groupKey:cards[0].group_key,rows:members});return;}
      const memberIds=members.map(row=>row.id);
      let ids;
      if(mode==='invert'){
        const remove=[],add=[];
        for(const card of cards){const targets=card.group_key&&card.group_count?result.groups[card.group_key]:[card.id];(targets.every(id=>selectedIds.has(id))?remove:add).push(...targets);}
        ids=changeSelection(changeSelection(selection,remove,'remove'),add,'add');
      }else ids=changeSelection(enter?[]:selection,memberIds,mode);
      if(enter){pendingBrowse.current=null;restoreAnchor.current=anchor;closeDetail();setSelecting(true);}
      setSelectionRows(previous=>({...previous,...Object.fromEntries(members.map(row=>[row.id,row]))}));setSelection(ids);
      if(announce){const next=new Set(ids);notify((memberIds.every(id=>next.has(id))?'已选中整组 ':'已取消整组 ')+members.length+' 张图片');}
    }catch(e){if(request===groupRequest.current&&current===generation.current)notify(e.message);}
    finally{if(request===groupRequest.current)setGroupSelecting(false);}
  }
  function selectGroup(item){
    return selectCards([{...item,group_key:item.kind==='note'?'note:'+item.id:item.group_key,group_count:1}],'toggle',{enter:!selecting,announce:true});
  }
  const toggleSelection = (id, event) => {
    if(batchBusy||groupSelecting||selectionProgress||loading)return;
    const from=items.findIndex(item=>item.id===selectionAnchor.current),to=items.findIndex(item=>item.id===id),item=itemById.get(id);
    const range=event?.shiftKey&&from>=0&&to>=0?items.slice(Math.min(from,to),Math.max(from,to)+1):[item];
    void selectCards(range,range.length===1?'toggle':cardSelected(item)?'remove':'add');
    if(!event?.shiftKey||from<0)selectionAnchor.current=id;
  };
  function cancelSelectionRequest() {
    selectionRequest.current?.abort(); selectionRequest.current=null; setSelectionProgress(null);
  }
  function clearSelection() {
    cancelSelectionRequest(); selectionAnchor.current=null; setSelection([]); setSelectionRows({});
  }
  function toggleSelectionMode(item = null) {
    if(batchBusy||groupSelecting||loading)return;
    cancelSelectionRequest();
    pendingBrowse.current=captureAnchor();
    if(item){selectionAnchor.current=item.id;void selectCards([item],'add',{enter:true});return;}
    restoreAnchor.current=pendingBrowse.current;pendingBrowse.current=null;
    setSelection([]);setSelectionRows({});setSelecting(!selecting);
  }
  async function selectFiltered() {
    if(!selecting||batchBusy||groupSelecting||loading||query!==search||selectionRequest.current)return;
    const controller=new AbortController(),current=generation.current;
    selectionRequest.current=controller;setSelectionProgress({loaded:0,total});
    try {
      const rows=await collectSelection(api,params(0),{signal:controller.signal,onProgress:setSelectionProgress});
      if(controller.signal.aborted||current!==generation.current)return;
      const ids=changeSelection(selection,rows.map(row=>row.id),'add');
      if(!search&&!selectedTags.length&&['all','images'].includes(view)){
        const groups={};rows.forEach(row=>{if(row.group_key)(groups[row.group_key]||=[]).push(row.id);});
        setKnownGroups(previous=>({...previous,...groups}));
      }
      setSelectionRows(previous=>({...previous,...Object.fromEntries(rows.map(row=>[row.id,row]))}));
      setSelection(ids);notify(`已选中当前筛选的全部 ${rows.length} 项内容`);
    } catch(e) { if(!controller.signal.aborted&&current===generation.current)notify(e.message); }
    finally {if(selectionRequest.current===controller){selectionRequest.current=null;setSelectionProgress(null);}}
  }
  useEffect(()=>()=>selectionRequest.current?.abort(),[]);
  const closeDetail = () => {
    window.dispatchEvent(new Event('znote:leaving-preview'));
    reading.leave();
    ++detailGeneration.current;
    setSelected(null); setGallery(null); setGalleryBusy(false); setOpeningItem(null);
    if (window.location.hash.startsWith('#item/')) history.replaceState(null, '', location.pathname + location.search);
  };
  const resetScope = () => {
    cancelSelectionRequest();setKnownGroups({});
    setReadingOpen(false);
    rememberBrowse(); selectionAnchor.current = null;
    pagingRequest.current = null; setPaging(false); setPageOffset(0); setPageError(null);
    ++groupRequest.current;setGroupPicker(null);setGroupSelecting(false);setSelectionRows({});
    ++generation.current;
    listRequest.current?.abort();
    closeDetail();
    setItems([]); setTotal(0); setLoadError(''); setLoading(true);
    setSelectedTags([]); setQuery(''); setSearch('');
    setSelection([]); setSelecting(false); setMobile(false);
    // Re-entering the current scope must also fetch again after clearing it.
    pendingBrowse.current = null; setResumeBrowse(null); setUpdatesAvailable(false); setRevision(n => n + 1);
  };
  const resumeLastBrowse = () => {
    if (!resumeBrowse || resumeBrowse.library !== collection || resumeBrowse.view !== view || resumeBrowse.query !== query || resumeBrowse.sort !== sort || resumeBrowse.mode !== tagMode || resumeBrowse.tags.join('\0') !== selectedTags.join('\0')) return;
    pendingBrowse.current = resumeBrowse.anchor; setResumeBrowse(null); setUpdatesAvailable(false); setRevision(n => n + 1);
  };
  const jumpToStart = () => {
    pendingBrowse.current = null; restoreAnchor.current = {id:'',top:0}; setResumeBrowse(null); setUpdatesAvailable(false); setAwayFromStart(false);
    window.scrollTo({top:0,behavior:'instant'}); if (pageOffset > 0) setRevision(n => n + 1);
  };
  const chooseCollection = (id) => {
    if(id!==collection)rememberRoute(id,'all');
    resetScope(); setStats({});
    setCollection(id);
    restoreBrowse(id);
  };
  const goHome = () => {
    if (preferences.default_collection_id)
      chooseCollection(preferences.default_collection_id);
    else {
      rememberRoute(null,'home');
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
          restoreBrowse(home, undefined, false);
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
        summary: 'true',
        grouped: view==='trash' ? 'false' : 'true',
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
    [sort, search, collection, selectedTags, tagMode, view],
  );
  async function openItem(item) {
    const current = ++detailGeneration.current;
    let hydrated = false;
    if (item.summary) {
      setOpeningItem(item.id);
      try {
        const fresh = await api(`/api/items/${item.id}`);
        if (current !== detailGeneration.current) return;
        if (fresh.collection_id !== item.collection_id || !!fresh.deleted_at !== !!item.deleted_at) throw Error('内容已移动或删除，请刷新后打开');
        item = { ...fresh, group_count: item.group_count };
        hydrated = true;
      } catch (e) { if (current === detailGeneration.current) notify(e.message); return; }
      finally { if (current === detailGeneration.current) setOpeningItem(null); }
    }
    if (item.kind === 'note') {
      try {
        const fresh = hydrated ? item : await api(`/api/items/${item.id}`);
        if (current !== detailGeneration.current) return;
        if (fresh.collection_id !== item.collection_id || !!fresh.deleted_at !== !!item.deleted_at) throw Error('笔记已移动或删除，请刷新列表后打开');
        setSelected(fresh); setGallery(null); setGalleryBusy(false);
      } catch (e) { if (current === detailGeneration.current) notify(e.message); }
      return;
    }
    setSelected(item);
    if (item.kind !== 'image') { setGallery(null); setGalleryBusy(false); return; }
    setGallery(items.filter(i => i.kind === 'image'));
    setGalleryBusy(true);
    try {
      // Freeze only lightweight IDs; editing a title or sort timestamp cannot
      // move the page boundary and skip an image during continuous organizing.
      const groupParams = isImageGroup(item)
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
    cancelSelectionRequest();
    const current = ++generation.current;
    const controller = new AbortController();
    listRequest.current = controller;
    const signature = params(0);
    const keepSelection = previousParams.current === signature;
    previousParams.current = signature;
    const anchor = pendingBrowse.current; pendingBrowse.current = null;
    restoreAnchor.current = anchor || { id: '', top: 0 };
    pagingRequest.current = null; setPaging(false); setPageError(null);
    const read = path => api(path, { signal: controller.signal });
    setLoading(true);
    setLoadError("");
    if (!keepSelection) { setSelection([]);setSelectionRows({}); selectionAnchor.current = null; }
    else setSelectionRows(Object.fromEntries(chosenItems.map(row => [row.id, row])));
    Promise.all([
      view === "home"
        ? Promise.resolve({ items: [], total: 0 })
        : read(`/api/items?${signature}${anchor ? '&anchor=' + encodeURIComponent(anchor.id) : ''}`),
      read(`/api/stats?collection=${encodeURIComponent(collection || 'unfiled')}`),
      read("/api/collections"),
    ])
      .then(([result, stats, libs]) => {
        if (controller.signal.aborted || current !== generation.current) return;
        setItems(result.items);
        setPageOffset(result.offset || 0);
        eventCursor.current = result.event_cursor || 0;
        if (keepSelection) setSelectionRows(previous => Object.fromEntries(Object.entries(previous).map(([id, row]) => [id, result.items.find(item => item.id === id) || row])));
        setUpdatesAvailable(false);
        setTotal(result.total);
        setStats(stats);
        setCollections(libs);
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
    // A return from another app must not destroy selection, pagination or an
    // open editor. Offer an explicit refresh instead of replacing the list.
    let checking = false;
    const focus = async () => {
      if (checking || browsing.current?.view === 'home' || browsing.current?.loading) return;
      checking = true;
      const current = generation.current;
      try { const result = await api('/api/events?latest=true'); if (current === generation.current && result.cursor > eventCursor.current) setUpdatesAvailable(true); }
      catch { /* Keep the current working view when the server is unreachable. */ }
      finally { checking = false; }
    };
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
    rememberRoute(collection||'unfiled',v);
    resetScope();
    restoreBrowse(collection || 'unfiled', v);
    if (!collection) setCollection('unfiled');
  };
  useAppBack(()=>{
    if(document.querySelector('[role="dialog"]'))return true;
    if(mobile){setMobile(false);return true;}
    if(selecting){
      if(batchBusy||groupSelecting)return true;
      if(selectionProgress)cancelSelectionRequest();
      else if(selection.length)clearSelection();
      else toggleSelectionMode();
      return true;
    }
    let previous;
    while(routeTrail.current.length){
      const entry=routeTrail.current.pop();
      if(!entry.collection||entry.collection==='unfiled'||collections.some(c=>c.id===entry.collection)){previous=entry;break;}
    }
    if(previous){resetScope();setStats({});setCollection(previous.collection);if(previous.view==='home')setView('home');else restoreBrowse(previous.collection||'unfiled',previous.view,true);return true;}
    if(view!=='home'){resetScope();setView('home');setCollection(null);return true;}
    return false;
  },ready);
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
  async function loadPage(previous = false, automatic = false) {
    if (pagingRequest.current || loading || query !== search || (previous ? !pageOffset : pageOffset + items.length >= total)) return;
    const focused = document.activeElement?.closest('.item-card')?.dataset.itemId;
    if (automatic && items.length >= 600 && items.slice(0, 60).some(item => item.id === focused)) return;
    const current = generation.current, request = Symbol('page');
    pagingRequest.current = request; setPaging(true); setPageError(null);
    const offset = previous ? Math.max(0, pageOffset - 60) : pageOffset + items.length;
    try {
      const result = await api(`/api/items?${params(offset)}&cursor=${eventCursor.current}`, { signal: listRequest.current?.signal });
      if (current !== generation.current || pagingRequest.current !== request) return;
      const window = extendPageWindow(items, pageOffset, result, previous);
      // Preserve the visible card even when the browser would otherwise anchor
      // to the footer and pull it downward, continuously triggering more pages.
      restoreAnchor.current = captureAnchor();
      setSelectionRows(Object.fromEntries(selectedRowsRef.current.map(row => [row.id, row])));
      setPageOffset(window.offset); setItems(window.items);
      setTotal(result.total);
    } catch (e) { if (current === generation.current && e.name !== 'AbortError') { const changed = e.status === 409 || e.message.includes('分页已变化'); setPageError({ message: e.message, previous, changed }); if (changed) setUpdatesAvailable(true); } }
    finally { if (pagingRequest.current === request) { pagingRequest.current = null; setPaging(false); } }
  }
  async function uploadFiles(files, insertInNote, targetCollection) {
    const results = [];
    const failures = [];
    const target = targetCollection !== undefined ? targetCollection : selected?.collection_id ?? actualCollection;
    for (const [i, file] of [...files].entries()) {
      setUploading(`上传 ${i + 1} / ${files.length}：${file.name}`);
      try {
        const queued=queueUploads(taskStore,[file],target)[0];const result=await queued.promise;if(!result.ok)throw result.error;results.push(result.value);
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
        e.target.closest?.('[role="dialog"]') ||
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
      if (e.isComposing || e.defaultPrevented) return;
      if (document.querySelector('[role="dialog"]')) {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') e.preventDefault();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        if (view === "home") setView("all");
        searchInput.current?.focus();
      }
      if (e.key === "Escape") setMobile(false);
      if(e.target.closest?.('input,textarea,select,[contenteditable="true"]'))return;
      if(selecting && (e.metaKey||e.ctrlKey) && e.key.toLowerCase()==='a') {
        e.preventDefault();selectFiltered();
      }
      if(selecting && e.key==='Escape' && !batchBusy && !groupSelecting) {
        e.preventDefault();
        if(selectionProgress)cancelSelectionRequest();
        else if(selection.length)clearSelection();
        else toggleSelectionMode();
      }
    };
    window.addEventListener("keydown", hotkey);
    return () => window.removeEventListener("keydown", hotkey);
  }, [view, selecting, selection, batchBusy, groupSelecting, selectionProgress, loading, query, search, params]);
  async function favorite(item) {
    try {
      if(isImageGroup(item)) {
        const result=await send('/api/item-groups/favorite',{group_key:item.group_key,collection_id:item.collection_id,favorite:!item.favorite,undo:true});saved(result);return;
      }
      const result = await send(
        `/api/items/${item.id}`,
        { favorite: !item.favorite, version: item.version, undo: true },
        "PATCH",
      );
      saved(result);
    } catch (e) {
      notify(e.message);
    }
  }
  async function remove(item) {
    if(item.kind==='video')videoProgress.cancelItems([item.id]);
    try {
      const result = await send('/api/items/batch-trash', { items: [{id:item.id, version:item.version}], collection_id:item.collection_id, undo:true });
      recordUndo(result);
      setSelected(null);
      refresh();
      notify("已移至回收站，可以随时恢复", result.undo);
    } catch (e) {
      if(item.kind==='video')videoProgress.allowItem(item.id);
      notify(e.message);
    }
  }
  async function detachFromGroup(row,retryPlan=null) {
    try {
      const result=await detachImageFromGroup(row,retryPlan||((detailDetachPlan.current?.id===row.id&&detailDetachPlan.current.plan)||null));
      detailDetachPlan.current=null;
      const key=row.group_key;
      if(key)setKnownGroups(previous=>({...previous,[key]:(previous[key]||[]).filter(id=>id!==row.id)}));
      if(selected?.id===row.id){setGallery(result.item?[result.item]:null);setSelected(result.item||null)}
      saved(result.item?{...result,items:[result.item]}:result);
      notify('已将 1 张图片移出图片组，可撤销',result.undo);
      return result;
    } catch(e) {
      detailDetachPlan.current=e.retryPlan?{id:row.id,plan:e.retryPlan}:null;
      throw e;
    }
  }
  async function batchTrash() {
    if(batchBusy || groupSelecting || selectionProgress || loading || !selection.length) return;
    setBatchBusy(true);
    try {
      const chosen=chosenItems;
      if(chosen.length!==selection.length) throw new Error('选择内容已变化，请重新选择');
      const result = await send('/api/items/batch-trash',{items:chosen.map(({id,version})=>({id,version})),collection_id:actualCollection,restore:view==='trash',undo:true});
      if(browsing.current.library===collection&&browsing.current.view===view)saved(result);
      else {recordUndo(result);refresh();}
      notify(view==='trash'?`已恢复 ${chosen.length} 项内容`:`已将 ${chosen.length} 项移至回收站，可随时恢复`,result.undo);
    } catch(e) { notify(e.message); } finally {setBatchBusy(false);}
  }
  async function batchFavorite() {
    if(batchBusy||groupSelecting||selectionProgress||loading||!selection.length)return;
    setBatchBusy(true);
    try {
      if(chosenItems.length!==selection.length)throw Error('选择内容已变化，请重新选择');
      const value=!chosenItems.every(row=>row.favorite);
      const result=await send('/api/items/batch-organize',{items:chosenItems.map(({id,version})=>({id,version})),favorite:value,undo:true});
      if(browsing.current.library===collection&&browsing.current.view===view)saved(result);
      else {recordUndo(result);refresh();}
      notify(`${value?'已收藏':'已取消收藏'} ${chosenItems.length} 项内容`,result.undo);
    }catch(e){notify(e.message);}finally{setBatchBusy(false);}
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
                <span className={v === 'images' ? 'image-nav-count' : undefined}>
                  {stats[
                    {
                      all: "total_cards",
                      images: "images",
                      videos: 'videos',
                      notes: "notes",
                      favorites: "favorite_cards",
                    }[v]
                  ] || 0}{v === 'images' && <> 张<small>{stats.image_cards || 0} 卡片</small></>}
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
                <span>{c.card_count ?? c.count}</span>
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
        {view !== 'home' && <SavedViewList model={savedViews} config={currentViewConfig} onApply={applySavedView} onEdit={editSavedView} onCreate={() => editSavedView(null)}/>}
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
          {sidebarTags.error?<button onClick={refresh}>重新加载标签</button>:sidebarTags.loading?<small>正在加载标签…</small>:!tags.length&&<small>为内容加上多个标签，轻松找回灵感</small>}
        </div>
        <div className="sidebar-bottom">
          <button
            className={view === "trash" ? "active" : ""}
            onClick={() => navigate("trash")}
          >
            <Trash2 size={17} />
            回收站<span>{stats.trash || ""}</span>
          </button>
          <button onClick={() => {setMobile(false);setSettings(true);}}>
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
            {view!=='home'&&<ExternalAssistantLink collection={actualCollection}/>}
            <TaskButton onClick={()=>setTasksOpen(true)}/>
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
                    <p>{c.card_count ?? c.count} 张卡片</p>
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
                    <IconButton label="紧密网格视图" className={layout==='compact-grid'?'chosen':''} onClick={()=>setLayout('compact-grid')}><Grid3X3 size={17}/></IconButton>
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
                    <IconButton label="紧密列表视图" className={layout==='compact-list'?'chosen':''} onClick={()=>setLayout('compact-list')}><ListFilter size={17}/></IconButton>
                  </div>
                  <IconButton label="刷新内容" onClick={refresh}>
                    <RefreshCw size={16} />
                  </IconButton>
                  <IconButton label="保存当前筛选" onClick={() => editSavedView(null)}><BookmarkPlus size={16}/></IconButton>
                </div>
              </section>
              {updatesAvailable && <div className="browse-update" role="status"><span>有内容更新，当前浏览位置和选择已保留</span><button onClick={refresh}><RefreshCw size={14}/>刷新内容</button><IconButton label="忽略更新提示" onClick={() => setUpdatesAvailable(false)}><X size={14}/></IconButton></div>}
              {view==='videos'?<VideoHistory progress={videoProgress} onOpen={resumeVideo} disabled={loading||selecting} open={readingOpen} setOpen={setReadingOpen}/>:view !== 'trash' && <ReadingProgress key={'reading:' + (actualCollection || 'unfiled')} progress={reading} onOpen={resumeReading} disabled={loading || galleryBusy || selecting} open={readingOpen} setOpen={setReadingOpen}/>}
              <TagFilter key={actualCollection || 'unfiled'} collection={actualCollection} revision={revision} selected={selectedTags} mode={tagMode} videos={view === 'videos'}
                onToggle={toggleTag} onMode={setTagMode} onClear={() => setSelectedTags([])}
                onBrowse={['notes', 'videos'].includes(view) ? null : browseFilteredImages}
                busy={loading || galleryBusy || query !== search || !!loadError} />
              <div className="results-caption">
                <span>
                  {query ? `“${query}” 的搜索结果` : ""}
                  <b>{total} 项内容</b>
                </span>
                <div className="result-actions">
                  <button className="text-button" onClick={() => setDraftsOpen(true)}>本地草稿</button>
                  <button className="text-button" onClick={() => setUndoOpen(true)}><History size={15}/>最近操作</button>
                  {view==='trash'&&<button className="text-button danger" disabled={!stats.trash} onClick={()=>openPurge(null)}><Trash2 size={14}/>清空回收站</button>}
                  <SelectionEntry key={`${actualCollection}:${view}`} selecting={selecting}
                    disabled={batchBusy||groupSelecting||loading} onToggle={()=>toggleSelectionMode()}/>
                  <button
                    className="text-button"
                    onClick={() => markdownInput.current.click()}
                  >
                    <Download size={14} />
                    导入 Markdown
                  </button>
                </div>
              </div>
              {selecting && <SelectionBar
                count={selection.length} loadedCount={items.length} total={total}
                allLoaded={!!items.length&&items.every(cardSelected)} someLoaded={items.some(i=>cardSelected(i)||cardPartial(i))}
                locked={batchBusy||groupSelecting||!!selectionProgress||loading||query!==search||!!loadError}
                progress={selectionProgress} working={batchBusy||groupSelecting} trash={view==='trash'}
                imagesOnly={chosenItems.length===selection.length&&chosenItems.every(i=>i.kind==='image')}
                allFavorite={chosenItems.length===selection.length&&chosenItems.every(i=>i.favorite)}
                showStart={awayFromStart||pageOffset>0} showPrevious={pageOffset>0}
                startLabel={sort==='title'?'回到列表开头':'回到最新'} previousLabel={sort==='title'?'加载靠前':'加载较新'}
                onStart={jumpToStart} onPrevious={()=>loadPage(true)}
                onLoaded={e=>selectCards(items,e.target.checked?'add':'remove')}
                onAll={selectFiltered} onInvert={()=>selectCards(items,'invert')}
                onClear={clearSelection} onExit={()=>toggleSelectionMode()} onCancel={cancelSelectionRequest}
                onTags={()=>setBatchTags(true)} onOrganize={()=>setOrganizing(true)} onFavorite={batchFavorite}
                onGroup={()=>{setToast('');setGroupOrganizing(true);}} onTrash={batchTrash} onPurge={()=>openPurge(selection)}
              />}
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
                <>
                {resumeBrowse?.library===collection&&resumeBrowse.view===view&&resumeBrowse.query===query&&resumeBrowse.sort===sort&&resumeBrowse.mode===tagMode&&resumeBrowse.tags.join('\0')===selectedTags.join('\0')&&pageOffset===0&&<div className="browse-resume"><button onClick={resumeLastBrowse}>继续上次浏览位置</button><HelpHint label="浏览位置">当前先显示列表开头。选择继续后会回到此知识库和分类上次看到的内容；筛选、排序和视图设置已经保留。</HelpHint><button aria-label="忽略上次浏览位置" onClick={()=>setResumeBrowse(null)}><X size={14}/></button></div>}
                {(awayFromStart||pageOffset>0) && !selecting && !selected && <div className="floating-action-dock browse-window-actions"><button disabled={paging} onClick={jumpToStart}><ArrowUpToLine size={15}/>{sort==='title'?'回到列表开头':'回到最新内容'}</button>{pageOffset>0&&<button disabled={paging} onClick={() => loadPage(true)}><ChevronUp size={15}/>{paging ? '正在加载…' : sort==='title'?'加载靠前内容':'加载较新内容'}</button>}<span className="dock-divider" aria-hidden="true"/><button onClick={()=>toggleSelectionMode()}><CheckCheck size={15}/>多选</button><HelpHint label="分页导航">向下浏览约一屏后即可直接回到列表开头。长列表只在内存中保留当前位置附近 300 项摘要和少量可见卡片；当前筛选和已选内容保留。</HelpHint></div>}
                <VirtualItems selecting={selecting} items={items} layout={layout} restoreId={restoreAnchor.current?.id}>
                  {(item) => (
                    <article onClick={e=>{if(selecting&&!e.target.closest('button,input,label'))toggleSelection(item.id,e);}} data-item-id={item.id} className={`item-card ${item.kind}${selecting&&cardSelected(item)?' is-selected':selecting&&cardPartial(item)?' is-partial':''}`} key={item.id}>
                      {selecting && (
                        <label className="card-select">
                          <input
                            type="checkbox"
                            aria-label={`选择 ${isImageGroup(item)?item.group_title||item.title:item.title}`}
                            checked={cardSelected(item)} ref={node=>{if(node)node.indeterminate=!!cardPartial(item);}}
                            disabled={batchBusy || groupSelecting || !!selectionProgress || loading || (selection.length >= 10000 && !cardSelected(item)&&!cardPartial(item))}
                            onClick={e => toggleSelection(item.id, e)}
                            onChange={() => {}}
                          />
                        </label>
                      )}
                      <button
                        className="card-main"
                        onKeyDown={e=>{if(!selecting&&(e.ctrlKey||e.metaKey)&&(e.key==='Enter'||e.key===' ')){e.preventDefault();toggleSelectionMode(item);}}}
                        aria-busy={openingItem === item.id || undefined}
                        onClick={(e) => selecting ? toggleSelection(item.id, e) : (e.ctrlKey||e.metaKey) ? toggleSelectionMode(item) : openItem(item)}
                        aria-pressed={selecting ? cardPartial(item)?'mixed':cardSelected(item) : undefined}
                        disabled={selecting && (batchBusy || groupSelecting || !!selectionProgress || loading || (selection.length >= 10000 && !cardSelected(item)&&!cardPartial(item)))}
                        aria-label={`${selecting ? cardSelected(item)?'取消选择':'选择' : '打开'} ${isImageGroup(item) ? item.group_title || item.title : item.title}`}
                      >
                        <div className="card-preview">
                          {openingItem === item.id && <span className="card-opening"><Loader2 size={16} className="spin"/>正在打开…</span>}
                          {item.kind === "image" ? (
                            <img
                              src={item.thumbnail_url}
                              alt={item.title}
                              loading="lazy"
                              decoding="async"
                            />
                          ) : item.kind === 'video' ? (
                            <div className="video-card-preview">{item.thumbnail_url&&<img className="video-cover" src={item.thumbnail_url} alt="视频首帧" loading="lazy" onError={e=>{e.currentTarget.hidden=true}}/>}<Film size={42} /><strong>点击预览视频</strong><small>{item.video_codec || 'VIDEO'} · {item.duration ? `${Math.round(item.duration)} 秒` : '原文件'}</small></div>
                          ) : (
                            <>
                              {item.thumbnail_url&&<img className="note-cover" src={item.thumbnail_url} alt={`${item.title} · 正文封面`} loading="lazy" decoding="async" onError={e=>{e.currentTarget.hidden=true}}/>}
                              <span className="note-type">
                                <FileText size={15} /> MARKDOWN
                              </span>
                              <h3>{item.title}</h3>
                              <p>
                                {item.content
                                  .replace(/<!--[\s\S]*?(?:-->|$)/g, "")
                                  .replace(/!\[[^\]]*\]\([^)]*\)/g, "[图片]")
                                  .replace(/[#*`>]/g, "")
                                  .slice(0, 240) || "一页空白，无限可能。"}
                              </p>
                            </>
                          )}
                          <span className={`kind-chip${isImageGroup(item) ? ' group-chip' : ''}`}>
                            {isImageGroup(item) ? <><Layers size={13} /> {item.group_count} 张</> : item.kind === "image" ? (
                              <Image size={13} />
                            ) : (
                              item.kind === 'video' ? <Film size={13} /> : <FileText size={13} />
                            )}
                          </span>
                        </div>
                        <div className="card-body">
                          <h3>{isImageGroup(item) ? item.group_title || item.title : item.title}</h3>
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
                            <div className="card-meta-text">
                            <span>{date(item.updated_at)}</span>
                            <span>
                              {item.kind !== "note"
                                ? `${item.width} × ${item.height}`
                                : `${item.content_length ?? item.content.length} 字符`}
                            </span>
                            </div>
                          </div>
                        </div>
                      </button>
                      <div className="card-actions">
                        {selecting&&isImageGroup(item)&&<button className="group-members-button" disabled={groupSelecting||batchBusy||!!selectionProgress||loading} aria-label={`选择组内图片 ${item.group_title||item.title}`} onClick={()=>selectCards([item],'toggle',{picker:true})}>选择组内图片{selectedGroupCounts.get(item.group_key)?` · ${selectedGroupCounts.get(item.group_key)}`:''}</button>}
                        {isImageGroup(item)&&<button className="select-group-button" disabled={groupSelecting||batchBusy||!!selectionProgress||loading} aria-label={`${selecting&&selectedGroups.has(item.group_key)?'取消整组':'选择整组'} ${item.group_title||item.title}`} title="切换该组全部图片的选择，包含筛选隐藏和未加载的成员" onClick={()=>selectGroup(item)}><Layers size={14}/>{selecting&&selectedGroups.has(item.group_key)?'取消整组':'选择整组'}</button>}
                        {view === "trash" ? (
                          <><IconButton
                            disabled={batchBusy||groupSelecting||!!selectionProgress}
                            label={`恢复 ${item.title}`}
                            onClick={() => restore(item)}
                          >
                            <RefreshCw size={16} />
                          </IconButton><IconButton disabled={batchBusy||groupSelecting||!!selectionProgress} label={`永久删除 ${item.title}`} onClick={()=>openPurge([item.id])}><Trash2 size={16}/></IconButton></>
                        ) : null}
                      </div>
                      {view!=="trash" && (
                          <IconButton className="icon-button card-favorite-button" aria-pressed={!!item.favorite}
                            disabled={batchBusy||groupSelecting||!!selectionProgress}
                            label={
                              item.favorite
                                ? `取消收藏 ${item.title}`
                                : `收藏 ${item.title}`
                            }
                            onClick={() => favorite(item)}
                          >
                            <Star
                              size={16}
                              fill={item.favorite ? "currentColor" : "none"}
                              color="currentColor"
                            />
                          </IconButton>
                      )}
                    </article>
                  )}
                </VirtualItems>
                </>
              )}
              {!!items.length && !loading && <div className="browse-pagination" data-window-size={items.length} data-window-offset={pageOffset}>
                <div className="browse-pagination-meta"><span>显示 {pageOffset + 1}–{pageOffset + items.length} / {total} 项</span><label><input type="checkbox" checked={autoPages} onChange={e => { setAutoPages(e.target.checked); saveAutoPages(e.target.checked); }}/>滚动自动加载</label><HelpHint label="连续浏览">列表只保留附近 300 项摘要，向前可加载之前的内容；已选内容保留。打开详情再读取完整正文。网络失败或内容更新时暂停加载。</HelpHint></div>
                {pageError ? <div className="browse-page-error" role="status"><span>{pageError.message}</span><button onClick={() => pageError.changed ? refresh() : loadPage(pageError.previous)}>{pageError.changed ? '刷新内容' : '重试加载'}</button></div> : pageOffset + items.length < total ? <PageLoader automatic={autoPages && !selected && !settings && !collectionModal && !mobile && !uploadBatch && !exporting && !importing && !organizing && !groupOrganizing && !batchTags && !purging && !savedViewEditor && !draftsOpen && !undoOpen && !readingOpen && !tasksOpen} disabled={paging || query !== search} onLoad={automatic => loadPage(false, automatic)}>{paging ? '正在加载…' : '加载更多内容'}</PageLoader> : <span className="muted">已到末尾</span>}
              </div>}
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
        <div role="status" className={`toast${undoReceipt ? ' above-undo' : ''}`}>
          <Check size={17} />
          {toast}
          <IconButton label="关闭提示" onClick={() => setToast("")}>
            <X size={14} />
          </IconButton>
        </div>
      )}
      <UndoCenter receipt={undoReceipt} open={undoOpen} onClose={() => setUndoOpen(false)} onDismiss={() => setUndoReceipt(null)} blocked={!!selected || batchBusy || organizing || groupOrganizing || !!savedViewEditor || draftsOpen || readingOpen || tasksOpen || batchTags || !!purging} onUndone={action => { setSelection([]); setSelectionRows({}); refresh(); setUndoReceipt(null); notify('已撤销'+action.label); }}/>
      {tasksOpen&&<TaskCenter collection={actualCollection} collections={collections} onClose={()=>setTasksOpen(false)} onImports={()=>{setTasksOpen(false);setImporting(true)}} onBackup={()=>{setTasksOpen(false);setSettings(true)}} onOpen={async id=>{try{const item=await api('/api/items/'+id);if(item.deleted_at)throw Error('内容已在回收站');if(item.collection_id!==actualCollection)chooseCollection(item.collection_id||'unfiled');setTasksOpen(false);setGallery(item.kind==='image'?[item]:[]);setSelected(item);}catch(e){notify(e.message)}}}/>}
      {savedViewEditor && <React.Suspense fallback={null}><SavedViewDialog initial={savedViewEditor.row} current={savedViewEditor.current} library={savedViewEditor.library} libraryName={collections.find(c => c.id === savedViewEditor.library)?.name || '未分类'} onClose={() => setSavedViewEditor(null)} onChanged={(_row, message) => { savedViews.reload(); notify(message); }}/></React.Suspense>}
      {draftsOpen && <DraftsDialog library={actualCollection} collections={collections} onClose={() => setDraftsOpen(false)} onOpen={async draft => {
        let note;
        if (draft.note_id) { try { note = await api('/api/items/' + draft.note_id); } catch (e) {
          if (!e.status && draft.base) { note = {...draft.base,id:draft.note_id,kind:'note',version:draft.base_version,favorite:false}; notify('正在离线续写，恢复连接后可保存到知识库'); }
          else if (e.status !== 404) throw e;
        } }
        if (!note || note.deleted_at) { note = {kind:'note',title:'',content:'',tags:[],favorite:false,collection_id:actualCollection}; draft = {...draft,base_version:0,fields:{...draft.fields,collection_id:actualCollection}}; if(draft.note_id)notify('原笔记已删除，草稿将作为新笔记保存'); }
        if (draft.fields.collection_id && !collections.some(c => c.id === draft.fields.collection_id)) draft = {...draft,fields:{...draft.fields,collection_id:note.collection_id||null}};
        if (note.collection_id !== actualCollection) chooseCollection(note.collection_id || 'unfiled');
        setDraftsOpen(false); setSelected({...note,_draft:draft});
      }}/>}
      {selected && (
        <Detail
          key={selected.id || "new"}
          item={selected}
          expandedImage={imageExpanded}
          onExpandedImageChange={setImageExpanded}
          collections={collections}
          suggestions={tags}
          onClose={()=>{setImageExpanded(false);closeDetail();}}
          onSaved={saved}
          onTagSearch={tag=>{closeDetail();setImageExpanded(false);setView('all');setQuery('');setSearch('');setSelectedTags([tag]);setTagMode('all');setMobile(false);}}
          onSelectGroup={selectGroup}
          onDetachGroup={detachFromGroup}
          groupSelecting={groupSelecting}
          onGroupOrdered={result=>{if(result.item.kind==='image')setGallery(result.items);}}
          onDelete={remove}
          onRestore={restore}
          onPurge={item=>openPurge([item.id])}
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
          onImageViewed={id => reading.record(id)}
          videoProgress={videoProgress}
          onBeforeItemChange={ids => {reading.cancelItems(ids);videoProgress.cancelItems(ids);}}
          galleryItems={galleryItems}
          galleryIndex={galleryIndex}
          previousAvailable={galleryIndex > 0}
          nextAvailable={galleryIndex >= 0 && galleryIndex < galleryItems.length - 1}
          galleryBusy={galleryBusy}
          galleryPosition={galleryIndex >= 0 ? `第 ${galleryIndex + 1} / ${galleryItems.length} 张` : null}
        />
      )}
      {purging&&<TrashDialog {...purging} onClose={()=>setPurging(null)} onDone={result=>{setPurging(null);setSelection([]);refresh();notify('已永久删除 '+result.count+' 项'+(result.pending_files?'，部分原文件等待自动释放':''));}}/>}
      {groupPicker&&<GroupSelectionDialog group={groupPicker} selected={selectedIds} onClose={()=>setGroupPicker(null)} onApply={ids=>{const next=changeSelection(changeSelection(selection,groupPicker.rows.map(row=>row.id),'remove'),ids,'add');setSelectionRows(previous=>({...previous,...Object.fromEntries(groupPicker.rows.map(row=>[row.id,row]))}));setSelection(next);setGroupPicker(null);}} onDetach={detachFromGroup} onDetached={()=>setGroupPicker(null)}/>}
      {organizing && <OrganizeDialog items={chosenItems} collections={collections} onClose={() => setOrganizing(false)} onDone={result => { saved(result); notify('已完成批量整理',result?.undo); }} />}
      {groupOrganizing && <React.Suspense fallback={null}><GroupOrganizeDialog items={chosenItems} library={actualCollection} onClose={() => setGroupOrganizing(false)} onDone={result => { setSelecting(false); setSelection([]); setSelectionRows({}); saved(result); notify(`已整理 ${result.changed_count} 张图片${result.copied_count ? `，其中 ${result.copied_count} 张共享笔记原图` : ''}`,result.undo); }}/></React.Suspense>}
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
          items={chosenItems}
          collection={actualCollection}
          suggestions={tags}
          onClose={() => setBatchTags(false)}
          onSaved={saved}
        />
      )}
    </div>
  );
}
