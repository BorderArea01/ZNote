const IMAGE_EXTENSIONS = /\.(?:avif|gif|jpe?g|png|webp)$/i;
const VIDEO_EXTENSIONS = /\.(?:mkv|mov|mp4|webm)$/i;
const MAX_DROPPED_FILES = 2000;

function readEntry(entry) {
  if (!entry) return Promise.resolve([]);
  if (entry.isFile) {
    return new Promise(resolve => entry.file(file => resolve(file ? [file] : []), () => resolve([])));
  }
  if (!entry.isDirectory || typeof entry.createReader !== 'function') return Promise.resolve([]);
  const reader = entry.createReader();
  const readEntries = () => new Promise(resolve => reader.readEntries(resolve, () => resolve([])));
  const all = [];
  const read = async () => {
    const entries = await readEntries();
    if (!entries.length) return all;
    for (const child of entries) {
      if (all.length >= MAX_DROPPED_FILES) break;
      all.push(...await readEntry(child));
    }
    return all;
  };
  return read();
}

function uniqueFiles(files) {
  const seen = new Set();
  return files.filter(file => {
    if (!file || seen.has(file)) return false;
    seen.add(file);
    return true;
  }).slice(0, MAX_DROPPED_FILES);
}

/** Read files and directories from a browser drag event. */
export async function filesFromDataTransfer(dataTransfer) {
  const items = [...(dataTransfer?.items || [])].filter(item => item.kind === 'file');
  const entries = items.map(item => item.webkitGetAsEntry?.()).filter(Boolean);
  const direct = [...(dataTransfer?.files || [])];
  if (entries.length) return uniqueFiles([...(await Promise.all(entries.map(readEntry))).flat(), ...direct]);
  return uniqueFiles(direct);
}

export function isUploadFile(file, kind = 'image') {
  if (!file) return false;
  if (kind === 'video') return /^video\//i.test(file.type || '') || VIDEO_EXTENSIONS.test(file.name || '');
  return /^image\//i.test(file.type || '') || IMAGE_EXTENSIONS.test(file.name || '');
}

export function filterUploadFiles(files, kind = 'image') {
  return [...files || []].filter(file => isUploadFile(file, kind));
}
