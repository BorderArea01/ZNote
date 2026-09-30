import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import sharp from 'sharp';
import { writePsdBuffer } from 'ag-psd';
import { createApp } from '../server/app.js';
import { filterUploadFiles } from '../src/file-drop.js';

function fixture() {
  const data=new Uint8ClampedArray(12*9*4);
  for(let i=0;i<data.length;i+=4){data[i]=210;data[i+1]=72;data[i+2]=109;data[i+3]=255;}
  return writePsdBuffer({width:12,height:9,imageData:{width:12,height:9,data}}, {generateThumbnail:false});
}

function layeredFixture() {
  const red = new Uint8ClampedArray(6 * 5 * 4).fill(255);
  const blue = new Uint8ClampedArray(6 * 5 * 4).fill(255);
  for (let i = 0; i < red.length; i += 4) { red[i + 1] = 0; red[i + 2] = 0; }
  for (let i = 0; i < blue.length; i += 4) { blue[i] = 0; blue[i + 1] = 0; }
  const transparent = new Uint8ClampedArray(12 * 9 * 4);
  return writePsdBuffer({ width: 12, height: 9,
    imageData: { width: 12, height: 9, data: transparent },
    children: [{ name: '绘画组', children: [
      { name: '红色图层', left: 2, top: 1, imageData: { width: 6, height: 5, data: red } },
      { name: '蓝色图层', left: 2, top: 1, imageData: { width: 6, height: 5, data: blue } },
    ] }],
  }, { generateThumbnail: false });
}

function zipEntry(buffer, target) {
  let cursor = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  while (cursor >= 0 && buffer.readUInt32LE(cursor) === 0x02014b50) {
    const method = buffer.readUInt16LE(cursor + 10), compressed = buffer.readUInt32LE(cursor + 20);
    const nameLength = buffer.readUInt16LE(cursor + 28), extra = buffer.readUInt16LE(cursor + 30), comment = buffer.readUInt16LE(cursor + 32);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString();
    const local = buffer.readUInt32LE(cursor + 42);
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    if (name === target) {
      const data = buffer.subarray(start, start + compressed);
      return method === 8 ? inflateRawSync(data) : data;
    }
    cursor += 46 + nameLength + extra + comment;
  }
  return null;
}

test('PSD keeps exact layered bytes while providing thumbnail, preview and grouping', async () => {
  const runtime=createApp({dataDir:await mkdtemp(join(tmpdir(),'znote-psd-'))});
  const server=runtime.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const base='http://127.0.0.1:'+server.address().port,original=fixture();
  try{
    assert.equal(filterUploadFiles([{name:'art.psd',type:''},{name:'notes.txt',type:'text/plain'}]).length,1);
    const setup=await fetch(base+'/api/auth/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'test-only'})});
    const headers={Cookie:setup.headers.get('set-cookie').split(';')[0]};
    const form=new FormData();form.append('file',new Blob([original],{type:'application/octet-stream'}),'layered.psd');form.append('group_key','upload:image:psd-test');form.append('group_index','0');
    const uploaded=await fetch(base+'/api/assets',{method:'POST',headers,body:form});if(uploaded.status!==201)assert.fail(await uploaded.text());
    const item=await uploaded.json();assert.equal(item.mime,'image/vnd.adobe.photoshop');assert.equal(item.kind,'image');assert.equal(item.group_key,'upload:image:psd-test');assert.equal(item.width,12);assert.equal(item.height,9);assert.equal(item.bytes,original.length);
    assert.equal(item.preview_url,`/media/${item.id}/preview`);
    const raw=await fetch(base+item.url,{headers});assert.equal(raw.status,200);assert.match(raw.headers.get('content-disposition'),/attachment.*\.psd/i);assert.deepEqual(Buffer.from(await raw.arrayBuffer()),original);
    for(const variant of ['thumbnail','preview']){const response=await fetch(base+item[variant+'_url'],{headers});assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/image\/webp/);const meta=await sharp(Buffer.from(await response.arrayBuffer())).metadata();assert.equal(meta.width,12);assert.equal(meta.height,9);}
    const exported=await fetch(base+'/api/export?mode=images&layout=legacy',{headers});assert.equal(exported.status,200);
    assert.deepEqual(zipEntry(Buffer.from(await exported.arrayBuffer()),`images/${item.id}.psd`),original);
    const layersForm=new FormData();layersForm.append('file',new Blob([layeredFixture()]),'layers.psd');
    const layersUpload=await fetch(base+'/api/assets',{method:'POST',headers,body:layersForm});assert.equal(layersUpload.status,201);
    const layered=await layersUpload.json();
    const tree=await(await fetch(base+`/api/items/${layered.id}/psd-layers`,{headers})).json();
    assert.equal(tree.count,3);assert.equal(tree.layers[0].name,'绘画组');assert.equal(tree.layers[0].children[0].name,'红色图层');assert.equal(tree.layers[0].children[1].name,'蓝色图层');
    const layerPath=tree.layers[0].children[0].path;
    for (const [suffix,format] of [['','webp'],['?download=1','png']]) {
      const response=await fetch(base+`/media/${layered.id}/layer/${layerPath}${suffix}`,{headers});assert.equal(response.status,200);
      assert.equal((await sharp(Buffer.from(await response.arrayBuffer())).metadata()).format,format);
    }
    const on=await fetch(base+`/media/${layered.id}/composite?v=111`,{headers});
    const lowerOnly=await fetch(base+`/media/${layered.id}/composite?v=110`,{headers});
    const off=await fetch(base+`/media/${layered.id}/composite?v=100`,{headers});
    const groupOff=await fetch(base+`/media/${layered.id}/composite?v=011`,{headers});
    assert.equal(on.status,200);assert.equal(lowerOnly.status,200);assert.equal(off.status,200);assert.equal(groupOff.status,200);
    const onPixels=await sharp(Buffer.from(await on.arrayBuffer())).ensureAlpha().raw().toBuffer();
    const lowerPixels=await sharp(Buffer.from(await lowerOnly.arrayBuffer())).ensureAlpha().raw().toBuffer();
    const sample=(2*12+3)*4;
    assert.ok(onPixels[sample+2]>onPixels[sample], 'upper blue layer should cover red');
    assert.ok(lowerPixels[sample]>lowerPixels[sample+2], 'hiding upper layer should reveal red');
    assert.ok((await sharp(Buffer.from(await off.arrayBuffer())).ensureAlpha().raw().toBuffer()).every((value,index)=>index%4!==3 || value===0));
    assert.ok((await sharp(Buffer.from(await groupOff.arrayBuffer())).ensureAlpha().raw().toBuffer()).every((value,index)=>index%4!==3 || value===0));
    assert.equal((await fetch(base+`/media/${layered.id}/composite?v=1`,{headers})).status,422);
    assert.equal((await fetch(base+`/media/${layered.id}/layer/99`,{headers})).status,422);
    const malformed=new FormData();malformed.append('file',new Blob([Buffer.from('8BPS')]),'broken.psd');const rejected=await fetch(base+'/api/assets',{method:'POST',headers,body:malformed});assert.equal(rejected.status,415);
    const compress=new FormData();compress.append('file',new Blob([original]),'layered.psd');compress.append('image_size_mode','compress');assert.equal((await fetch(base+'/api/assets',{method:'POST',headers,body:compress})).status,422);
  }finally{await Promise.all(['captures','weixin','trash','imports','backups','webhooks'].map(k=>runtime[k].stop()));await new Promise(r=>server.close(r));runtime.db.close();}
});
