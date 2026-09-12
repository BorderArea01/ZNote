// ZNote integration, GPL-3.0-or-later. The encoder and ZIP reader are bundled
// upstream dependencies with their original licenses retained in the source pack.
importScripts('../lib/jszip.min.js', '../lib/pako.min.js', '../lib/UPNG.js');
self.onmessage = async ({ data }) => {
  try {
    const zip = await JSZip.loadAsync(data.zip), buffers = [], delays = []; let width, height, pixels = 0;
    for (const frame of data.frames) {
      const entry = zip.file(frame.file); if (!entry) throw Error('动图 ZIP 缺少帧：' + frame.file);
      if (entry._data?.uncompressedSize > 25 * 1024 * 1024) throw Error('单帧过大');
      const blob = await entry.async('blob'), bitmap = await createImageBitmap(blob);
      if (width && (bitmap.width !== width || bitmap.height !== height)) { bitmap.close(); throw Error('动图帧尺寸不一致'); }
      width = bitmap.width; height = bitmap.height; pixels += width * height;
      if (pixels > 32 * 1024 * 1024) { bitmap.close(); throw Error('动图解码总像素超过 3200 万，请使用原插件下载'); }
      const canvas = new OffscreenCanvas(width, height), ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0); bitmap.close();
      buffers.push(ctx.getImageData(0, 0, width, height).data.buffer); delays.push(frame.delay);
    }
    const png = UPNG.encode(buffers, width, height, 0, delays);
    self.postMessage({ png }, [png]);
  } catch (e) { self.postMessage({ error: e.message }); }
};
