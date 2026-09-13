import {mkdir,readFile,writeFile} from 'node:fs/promises';import sharp from 'sharp';
const svg=await readFile('public/icon.svg');await mkdir('public/icons',{recursive:true});await mkdir('clients/desktop/build/icons',{recursive:true});
for(const size of [192,512])await sharp(svg).resize(size,size).png().toFile(`public/icons/icon-${size}.png`);
await sharp(svg).resize(180,180).png().toFile('public/icons/apple-touch-icon.png');
const padded=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#287464"/><g transform="translate(102.4 102.4) scale(4.8)">${svg.toString().replace(/^<svg[^>]*>/,'').replace(/<\/svg>\s*$/,'')}</g></svg>`);
await sharp(padded).png().toFile('public/icons/maskable-512.png');
await sharp(svg).resize(512,512).png().toFile('clients/desktop/build/icons/icon.png');await sharp(svg).resize(64,64).png().toFile('clients/desktop/launcher/icon.png');
const sizes=[16,32,48,256],buffers=await Promise.all(sizes.map(n=>sharp(svg).resize(n,n).png().toBuffer())),header=Buffer.alloc(6+16*sizes.length);header.writeUInt16LE(1,2);header.writeUInt16LE(sizes.length,4);let offset=header.length;buffers.forEach((b,i)=>{const at=6+i*16;header[at]=sizes[i]%256;header[at+1]=sizes[i]%256;header.writeUInt16LE(1,at+4);header.writeUInt16LE(32,at+6);header.writeUInt32LE(b.length,at+8);header.writeUInt32LE(offset,at+12);offset+=b.length});await writeFile('clients/desktop/build/icons/icon.ico',Buffer.concat([header,...buffers]));
