import sharp from 'sharp';

export const MAX_IMAGE_BYTES = 100 * 1024 * 1024;
export const COMPRESSED_IMAGE_BYTES = 25 * 1024 * 1024;

function isApng(buffer) {
  if (!buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return false;
  for (let offset = 8; offset + 12 <= buffer.length;) {
    if (buffer.toString('ascii', offset + 4, offset + 8) === 'acTL') return true;
    offset += 12 + buffer.readUInt32BE(offset);
  }
  return false;
}

// Explicit opt-in only. Never flatten an animation or silently reduce resolution.
export async function compressLargeImage(buffer) {
  if (buffer.length <= COMPRESSED_IMAGE_BYTES) return { buffer };
  const metadata = await sharp(buffer, { limitInputPixels: 80000000 }).metadata();
  if ((metadata.pages || 1) > 1 || isApng(buffer)) {
    throw Error('动图暂不支持低损压缩，请选择原图入库');
  }
  for (const quality of [90, 85, 80]) {
    const output = await sharp(buffer, { limitInputPixels: 80000000 })
      .rotate().keepIccProfile().webp({ quality, effort: 4 }).timeout({ seconds: 40 }).toBuffer();
    if (output.length <= COMPRESSED_IMAGE_BYTES)
      return { buffer: output, quality, originalBytes: buffer.length };
  }
  throw Error('保持尺寸与较高画质时无法压到 25 MB 内，请选择原图入库');
}
