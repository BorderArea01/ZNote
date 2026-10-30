// A displacement field is code, not a baked screenshot: controls remain live.
import sharp from 'sharp';
import {writeFile} from 'node:fs/promises';
const fields=[];
for(const seed of [47,109,181]){
 let s=seed>>>0;const rand=()=>((s=(Math.imul(s,1664525)+1013904223)>>>0)/4294967296);
 const pixels=Buffer.alloc(32*256*4);let row=0;
 while(row<256){const height=1+Math.floor(rand()*10),value=Math.round(18+rand()*220);for(let y=row;y<Math.min(256,row+height);y++)for(let x=0;x<32;x++){const p=(y*32+x)*4;pixels[p]=value;pixels[p+1]=128;pixels[p+2]=128;pixels[p+3]=255;}row+=height;}
 fields.push((await sharp(pixels,{raw:{width:32,height:256,channels:4}}).png().toBuffer()).toString('base64'));
}
function filter(id,index,scale,trail){return `<filter id="${id}" x="-45%" y="-15%" width="190%" height="130%" color-interpolation-filters="sRGB"><feImage href="data:image/png;base64,${fields[index]}" x="0" y="0" width="100%" height="100%" preserveAspectRatio="none" result="bands"/><feDisplacementMap in="SourceGraphic" in2="bands" scale="${scale}" xChannelSelector="R" yChannelSelector="G" result="tear"/><feMorphology in="tear" operator="dilate" radius="${trail} 0" result="drag"/><feColorMatrix in="drag" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="red"/><feOffset in="red" dx="-2" result="red-shift"/><feColorMatrix in="drag" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0" result="cyan"/><feOffset in="cyan" dx="2" result="cyan-shift"/><feBlend in="red-shift" in2="cyan-shift" mode="screen"/></filter>`;}
await writeFile('public/themes/glitch/rupture.svg',`<svg xmlns="http://www.w3.org/2000/svg"><defs>${filter('tear-a',0,82,1)}${filter('tear-b',1,-116,3)}${filter('tear-c',2,152,5)}${filter('tear-hero',2,240,9)}</defs></svg>`);
console.log('Built four band displacement / pixel smear / RGB recombination filters.');
