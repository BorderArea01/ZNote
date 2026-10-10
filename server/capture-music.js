const text=(value,max=200)=>typeof value==='string'?value.trim().slice(0,max):'';
function addresses(value,base,depth=0){
  if(depth>5||!value)return [];
  if(typeof value==='string'){
    if(!/^(?:https?:)?\/\//i.test(value))return [];
    try{const url=new URL(value,base);return /^https?:$/.test(url.protocol)&&!url.username&&!url.password&&url.href.length<=4096?[url.href]:[];}catch{return [];}
  }
  if(Array.isArray(value))return value.slice(0,8).flatMap(v=>addresses(v,base,depth+1));
  if(typeof value!=='object')return [];
  return ['url','src','url_list','urlList','play_url','playUrl','play_addr','playAddr','music_url','musicUrl','audio_url','audioUrl','masterUrl','backupUrls'].flatMap(key=>addresses(value[key],base,depth+1));
}
// Only the matching work's music record; never recommendation music or covers.
export function captureMusic(record,base){
  const music=record.music||record.musicInfo||record.music_info||record.noteCard?.musicInfo||record.note_card?.music_info;
  if(!music||typeof music!=='object')return null;
  const urls=[...new Set(addresses(music,base))].slice(0,8);
  return urls.length?{urls,title:text(music.title||music.name||music.musicName||music.music_name)||'作品配乐',author:text(music.author||music.authorName||music.author_name||music.singer)}:null;
}
