import archiver from 'archiver';
import { resolve } from 'node:path';
import { access,readFile } from 'node:fs/promises';

export function registerClipper(app) {
  app.get('/api/clipper/pixiv/:artifact', async (req, res) => {
    if (!['download', 'source'].includes(req.params.artifact)) return res.status(404).json({ error: '文件不存在' });
    const file = resolve(import.meta.dirname, '../integrations/pixiv/build', req.params.artifact === 'source' ? 'source.zip' : 'znote-pixiv.zip');
    try { await access(file); } catch { return res.status(503).json({ error: 'Pixiv 增强版尚未构建，请在服务端运行 npm run pixiv:build' }); }
    res.download(file, req.params.artifact === 'source' ? 'znote-pixiv-source.zip' : 'znote-pixiv-enhanced.zip');
  });
  app.get('/api/clipper/download', async (req, res) => {
    const manifest=JSON.parse(await readFile(resolve(import.meta.dirname,'../extensions/clipper/manifest.json'),'utf8'));
    res.attachment(`znote-clipper-${manifest.version}.zip`);
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
