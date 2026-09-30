import { getLayerImageData, initializeCanvas, readPsd } from 'ag-psd';
import sharp from 'sharp';

// Read the flattened composite only. The layered PSD is stored byte for byte.
initializeCanvas(() => { throw Error('PSD canvas is unavailable'); },
  (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }));

export const PSD_MIME = 'image/vnd.adobe.photoshop';
const MAX_LAYERS = 1000;
const MAX_LAYER_PIXELS = 40_000_000;

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

function readStructure(buffer, raw = false) {
  psdDimensions(buffer);
  return readPsd(buffer, {
    skipCompositeImageData: true,
    skipThumbnail: true,
    skipLinkedFilesData: true,
    ...(raw ? { useRawData: true } : { skipLayerImageData: true }),
  });
}

export function psdLayers(buffer) {
  const psd = readStructure(buffer);
  let total = 0;
  function walk(children = [], prefix = '') {
    return children.map((layer, index) => {
      if (++total > MAX_LAYERS) throw Error('PSD 图层数量超出支持范围');
      const path = prefix ? `${prefix}.${index}` : String(index);
      const width = Math.max(0, (layer.right ?? 0) - (layer.left ?? 0));
      const height = Math.max(0, (layer.bottom ?? 0) - (layer.top ?? 0));
      return {
        path, name: layer.name || `图层 ${total}`, group: !!layer.children,
        hidden: !!layer.hidden, opacity: layer.opacity ?? 1,
        blend_mode: layer.blendMode || 'normal', width, height,
        children: layer.children ? walk(layer.children, path) : [],
      };
    });
  }
  const layers = walk(psd.children);
  return { width: psd.width, height: psd.height, count: total, layers };
}

export async function psdLayerImage(buffer, path, { download = false } = {}) {
  const psd = readStructure(buffer, true);
  const parts = String(path).split('.');
  if (!parts.length || parts.length > 32 || parts.some(part => !/^(0|[1-9]\d{0,3})$/.test(part))) throw Error('图层路径无效');
  let layer, children = psd.children;
  for (const part of parts) {
    layer = children?.[Number(part)];
    if (!layer) throw Error('图层不存在');
    children = layer.children;
  }
  if (layer.children) throw Error('请选择组内的具体图层');
  const width = (layer.right ?? 0) - (layer.left ?? 0), height = (layer.bottom ?? 0) - (layer.top ?? 0);
  if (width <= 0 || height <= 0 || width * height > MAX_LAYER_PIXELS) throw Error('图层没有可导出的像素或尺寸过大');
  const image = getLayerImageData(layer);
  if (!image || !ArrayBuffer.isView(image.data) || image.data.byteLength !== width * height * 4)
    throw Error('这个图层没有可读取的像素');
  const source = sharp(Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength),
    { raw: { width, height, channels: 4 }, limitInputPixels: MAX_LAYER_PIXELS });
  if (download) return { buffer: await source.png().toBuffer(), mime: 'image/png' };
  const left = Math.max(0, layer.left), top = Math.max(0, layer.top);
  const fromLeft = Math.max(0, -layer.left), fromTop = Math.max(0, -layer.top);
  const cropWidth = Math.min(width - fromLeft, psd.width - left), cropHeight = Math.min(height - fromTop, psd.height - top);
  if (cropWidth <= 0 || cropHeight <= 0) throw Error('图层位于画布外，无法生成预览');
  const rendered = await source.extract({ left: fromLeft, top: fromTop, width: cropWidth, height: cropHeight })
    .extend({ left, top, right: psd.width - left - cropWidth, bottom: psd.height - top - cropHeight,
      background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .resize({ width: 1800, height: 1800, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 88 }).toBuffer();
  return { buffer: rendered, mime: 'image/webp' };
}

const BLEND = {
  normal: 'over', multiply: 'multiply', screen: 'screen', overlay: 'overlay',
  darken: 'darken', lighten: 'lighten', 'linear dodge': 'add',
  'color dodge': 'color-dodge', 'color burn': 'color-burn',
  'hard light': 'hard-light', 'soft light': 'soft-light',
  difference: 'difference', exclusion: 'exclusion',
};

export async function psdComposite(buffer, visibility) {
  const psd = readStructure(buffer, true);
  if (typeof visibility !== 'string' || !/^[01]{1,1000}$/.test(visibility)) throw Error('图层显示状态无效');
  const layers = [];
  let index = 0;
  function walk(children = [], parentVisible = true) {
    for (const layer of children) {
      if (index >= visibility.length) throw Error('图层显示状态与文件不匹配');
      const enabled = visibility[index++] === '1';
      const visible = parentVisible && enabled;
      if (layer.children) walk(layer.children, visible);
      else if (visible) layers.push(layer);
    }
  }
  walk(psd.children);
  if (index !== visibility.length) throw Error('图层显示状态与文件不匹配');
  if (layers.length > 150) throw Error('一次最多合成 150 个可见图层');
  const scale = Math.min(1, 1200 / Math.max(psd.width, psd.height));
  const outputWidth = Math.max(1, Math.round(psd.width * scale));
  const outputHeight = Math.max(1, Math.round(psd.height * scale));
  let canvas = Buffer.alloc(outputWidth * outputHeight * 4);
  // ag-psd exposes this file's drawable layers in bottom-to-top order.
  for (const layer of layers) {
    const width = (layer.right ?? 0) - (layer.left ?? 0), height = (layer.bottom ?? 0) - (layer.top ?? 0);
    if (width <= 0 || height <= 0) continue;
    if (width * height > MAX_LAYER_PIXELS) throw Error('图层尺寸过大，无法重新合成');
    const image = getLayerImageData(layer);
    if (!image) continue;
    const left = Math.max(0, layer.left), top = Math.max(0, layer.top);
    const fromLeft = Math.max(0, -layer.left), fromTop = Math.max(0, -layer.top);
    const cropWidth = Math.min(width - fromLeft, psd.width - left), cropHeight = Math.min(height - fromTop, psd.height - top);
    if (cropWidth <= 0 || cropHeight <= 0) continue;
    const scaledLeft = Math.round(left * scale), scaledTop = Math.round(top * scale);
    const scaledWidth = Math.min(outputWidth - scaledLeft, Math.max(1, Math.round(cropWidth * scale)));
    const scaledHeight = Math.min(outputHeight - scaledTop, Math.max(1, Math.round(cropHeight * scale)));
    if (scaledWidth <= 0 || scaledHeight <= 0) continue;
    const pixels = Buffer.from(image.data);
    const opacity = Math.max(0, Math.min(1, layer.opacity ?? 1));
    if (opacity < 1) for (let pixel = 3; pixel < pixels.length; pixel += 4) pixels[pixel] = Math.round(pixels[pixel] * opacity);
    const overlay = await sharp(pixels, { raw: { width, height, channels: 4 }, limitInputPixels: MAX_LAYER_PIXELS })
      .extract({ left: fromLeft, top: fromTop, width: cropWidth, height: cropHeight })
      .resize(scaledWidth, scaledHeight).png().toBuffer();
    canvas = await sharp(canvas, { raw: { width: outputWidth, height: outputHeight, channels: 4 } })
      .composite([{ input: overlay, left: scaledLeft, top: scaledTop, blend: BLEND[layer.blendMode] || 'over' }])
      .raw().toBuffer();
  }
  return sharp(canvas, { raw: { width: outputWidth, height: outputHeight, channels: 4 } }).webp({ quality: 88 }).toBuffer();
}
