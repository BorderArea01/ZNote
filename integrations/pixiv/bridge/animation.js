// ZNote integration, GPL-3.0-or-later.
export async function animation(blob, frames, signal) {
  const zip = await blob.arrayBuffer(); signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./animation.worker.js', import.meta.url));
    const done = (error, png) => { clearTimeout(timer); worker.terminate(); signal.removeEventListener('abort', abort); error ? reject(error) : resolve(new Blob([png], { type: 'image/png' })); };
    const abort = () => done(Error('已停止'));
    const timer = setTimeout(() => done(Error('动图转换超时，请用原插件下载')), 120000);
    signal.addEventListener('abort', abort, { once: true }); worker.onerror = () => done(Error('动图转换失败'));
    worker.onmessage = ({ data }) => done(data.error ? Error(data.error) : null, data.png);
    worker.postMessage({ zip, frames }, [zip]);
  });
}
