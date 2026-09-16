// A work identity is independent of tracking parameters, display title and job ID.
export function knownGalleryWork(value) {
  let url;try{url=new URL(value);}catch{return null;}
  if(!/^https?:$/.test(url.protocol)||url.username||url.password)return null;
  const host=url.hostname.replace(/^www\./,''),path=url.pathname;
  const pixiv=host==='pixiv.net'&&path.match(/^\/(?:[a-z]{2}\/)?artworks\/(\d+)\/?$/);
  if(pixiv)return {group_key:'pixiv:art:'+pixiv[1],source_url:'https://www.pixiv.net/artworks/'+pixiv[1]};
  const paw=/^pawchive\.(pw|st)$/.test(host)&&path.match(/^\/(fanbox|patreon)\/user\/([\w-]{1,64})\/post\/([\w-]{1,64})\/?$/);
  if(paw)return {group_key:`paw:${paw[1]}:${paw[2]}:${paw[3]}`,source_url:`https://${host}/${paw[1]}/user/${paw[2]}/post/${paw[3]}`};
  return null;
}
export async function galleryGrouping(group) {
  const known=knownGalleryWork(group.source_url);
  if(known)return {...known,group_title:String(group.title||'作品图片').slice(0,180)};
  const source=new URL(group.source_url);source.hash='';
  // Separate independent galleries on the same generic page; retries of the
  // same ordered gallery keep the same key. Known sites use the stable work ID.
  const bytes=new TextEncoder().encode(JSON.stringify([source.href,group.images]));
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return {source_url:source.href,group_key:'web:gallery:'+Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join(''),group_title:String(group.title||'作品图片').slice(0,180)};
}
// Only recognize untouched records produced by the old batch collector. Never
// infer a group from a filename alone or take ownership from a note/manual group.
export function legacyGalleryPage(row) {
  if(row.kind!=='image'||row.deleted_at||row.group_key||row.group_manual||row.group_order!==null||row.group_index!==0||row.version!==1||row.created_at!==row.updated_at)return null;
  const work=knownGalleryWork(row.source_url);if(!work)return null;
  const text=String(row.content||'').replace(/\r\n/g,'\n');
  const match=/^作品：([^\n]+)\n页码：(\d+) \/ (\d+)\n\n来源链接：([^\n]+)$/.exec(text);
  if(!match||match[4]!==row.source_url)return null;
  const index=Number(match[2])-1,total=Number(match[3]),title=match[1];
  if(total<2||total>200||index<0||index>=total||row.title!==`${title.slice(0,175)} · ${String(index+1).padStart(3,'0')}`)return null;
  return {...work,group_title:title.slice(0,180),group_index:index,total};
}
