import test from 'node:test';
import assert from 'node:assert/strict';
import { filesFromDataTransfer, filterUploadFiles } from '../src/file-drop.js';

const file = (name, type) => new File(['data'], name, { type });
const fileEntry = value => ({ isFile: true, isDirectory: false, file(resolve) { queueMicrotask(() => resolve(value)); } });
const directoryEntry = children => {
  let read = false;
  return { isFile: false, isDirectory: true, createReader() { return { readEntries(resolve) { queueMicrotask(() => { resolve(read ? [] : children); read = true; }); } }; } };
};

test('dragged folders are recursively expanded and preserve file order', async () => {
  const one = file('one.png', 'image/png'), two = file('nested/two.webp', 'image/webp'), three = file('nested/three.txt', 'text/plain');
  const dataTransfer = { items: [
    { kind: 'file', webkitGetAsEntry: () => directoryEntry([fileEntry(one), directoryEntry([fileEntry(two), fileEntry(three)])]) },
  ], files: [] };
  assert.deepEqual((await filesFromDataTransfer(dataTransfer)).map(value => value.name), ['one.png', 'nested/two.webp', 'nested/three.txt']);
  assert.deepEqual(filterUploadFiles([one, two, three], 'image').map(value => value.name), ['one.png', 'nested/two.webp']);
});

test('ordinary file drops still use the FileList fallback', async () => {
  const image = file('image.png', 'image/png');
  assert.deepEqual(await filesFromDataTransfer({ items: [], files: [image] }), [image]);
});
