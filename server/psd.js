import { initializeCanvas, readPsd } from 'ag-psd';
import sharp from 'sharp';

// Read the flattened composite only. The layered PSD is stored byte for byte.
initializeCanvas(() => { throw Error('PSD canvas is unavailable'); },
  (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }));

export const PSD_MIME = 'image/vnd.adobe.photoshop';

export function psdDimensions(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 26 || buffer.toString('ascii', 0, 4) !== '8BPS' || buffer.readUInt16BE(4) !== 1)
    throw Error('PSD 文件头无效');
  const height = buffer.readUInt32BE(14), width = buffer.readUInt32BE(18), bits = buffer.readUInt16BE(22);
  if (!width || !height || width * height > 80_000_000) throw Error('PSD 尺寸超出支持范围');
  if (bits !== 8) throw Error('目前支持 8 位 PSD 预览，请先在绘图软件导出 8 位副本');
  return { width, height };
}

export async function psdPreview(buffer, maxEdge = 1800) {
  const dimensions = psdDimensions(buffer);
  const psd = readPsd(buffer, {
    skipLayerImageData: true,
    skipThumbnail: true,
    skipLinkedFilesData: true,
    useImageData: true,
  });
  const image = psd.imageData;
  if (!image || image.width !== dimensions.width || image.height !== dimensions.height ||
      !ArrayBuffer.isView(image.data) || image.data.BYTES_PER_ELEMENT !== 1 || image.data.byteLength !== image.width * image.height * 4)
    throw Error('PSD 缺少可预览的合成图层');
  return sharp(Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength),
    { raw: { width: image.width, height: image.height, channels: 4 }, limitInputPixels: 80_000_000 })
    .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 84 })
    .toBuffer();
}
