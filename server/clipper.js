import archiver from 'archiver';
import { resolve } from 'node:path';

export function registerClipper(app) {
  app.get('/api/clipper/download', async (req, res) => {
    res.attachment('znote-clipper-0.8.5.zip');
    const archive = archiver('zip');
    const done = new Promise((yes, no) => { archive.once('error', no); res.once('finish', yes); res.once('close', () => res.writableFinished ? yes() : no(Object.assign(new Error('Download closed'), { status: 499 }))); });
    done.catch(() => {});
    archive.on('warning', error => archive.destroy(error));
    archive.on('error', error => res.destroy(error));
    res.on('close', () => archive.abort());
    archive.pipe(res); archive.directory(resolve(import.meta.dirname, '../extensions/clipper'), false);
    await Promise.race([archive.finalize(), done]); await done;
  });
}
