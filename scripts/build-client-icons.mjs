import {mkdir,readFile,writeFile} from 'node:fs/promises';import sharp from 'sharp';
sharp.concurrency(1);
const svg=await readFile('public/icon.svg');await mkdir('public/icons',{recursive:true});await mkdir('clients/desktop/build/icons',{recursive:true});await mkdir('addons/browser/clipper/icons',{recursive:true});
await mkdir('public/themes/glitch',{recursive:true});await writeFile('public/themes/glitch/icon.svg',svg);
for(const size of [192,512])await sharp(svg).resize(size,size).png().toFile(`public/icons/icon-${size}.png`);
await sharp(svg).resize(180,180).png().toFile('public/icons/apple-touch-icon.png');
const background=svg.toString().match(/<rect\b[^>]*fill="([^"]+)"/)?.[1];
if(!background)throw new Error('Icon background is missing');
// The mark already lies inside the central 80% maskable safe circle. Fill
// the complete square instead of shrinking an already padded rounded tile.
const maskable=Buffer.from(svg.toString().replaceAll('rx="16"','rx="0"'));
await sharp(maskable).resize(512,512).png().toFile('public/icons/maskable-512.png');
await sharp(svg).resize(512,512).png().toFile('clients/desktop/build/icons/icon.png');await sharp(svg).resize(64,64).png().toFile('clients/desktop/launcher/icon.png');
await sharp(svg).resize(64,64).png().toFile('clients/desktop/launcher/icon-glitch.png');
const sizes=[16,32,48,256],buffers=[];for(const n of sizes)buffers.push(await sharp(svg).resize(n,n).png().toBuffer());const header=Buffer.alloc(6+16*sizes.length);header.writeUInt16LE(1,2);header.writeUInt16LE(sizes.length,4);let offset=header.length;buffers.forEach((b,i)=>{const at=6+i*16;header[at]=sizes[i]%256;header[at+1]=sizes[i]%256;header.writeUInt16LE(1,at+4);header.writeUInt16LE(32,at+6);header.writeUInt32LE(b.length,at+8);header.writeUInt32LE(offset,at+12);offset+=b.length});await writeFile('clients/desktop/build/icons/icon.ico',Buffer.concat([header,...buffers]));
for(const size of [16,32,48,128])await sharp(svg).resize(size,size).png().toFile(`addons/browser/clipper/icons/icon-${size}.png`);
// Android uses the same rasterized master, preserving gradients and clipped
// RGB strips instead of silently dropping them in a one-path approximation.
const native='clients/android/app/src/main/res/drawable-nodpi';await mkdir(native,{recursive:true});
await sharp(svg).resize(512,512).png().toFile(native+'/ic_brand.png');
await sharp(svg).resize(512,512).png().toFile(native+'/ic_glitch.png');
await writeFile('clients/android/app/src/main/res/drawable/ic_launcher.xml','<bitmap xmlns:android="http://schemas.android.com/apk/res/android" android:src="@drawable/ic_brand" android:gravity="fill" android:filter="true"/>\n');
