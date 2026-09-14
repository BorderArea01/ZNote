import fs from 'node:fs';
import net from 'node:net';
import {resolve, dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

// Run the server in the task's own process so stopping the task stops the server.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = resolve(process.argv[2] || join(root, 'data'));
const port = Number(process.argv[3] || 3741);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid port');
process.chdir(root);
process.env.DATA_DIR = dataDir;
process.env.PORT = String(port);
process.env.HOST = '0.0.0.0';
const logDir = join(dataDir, 'logs');
fs.mkdirSync(logDir, {recursive:true});
function append(name, text) {
  const path = join(logDir, name);
  if (fs.existsSync(path) && fs.statSync(path).size > 5 * 1024 * 1024) {
    fs.rmSync(path + '.previous', {force:true});
    fs.renameSync(path, path + '.previous');
  }
  fs.appendFileSync(path, text);
}
for (const [stream, name] of [[process.stdout, 'server.stdout.log'], [process.stderr, 'server.stderr.log']]) {
  const originalWrite = stream.write.bind(stream);
  stream.write = (chunk, encoding, callback) => {
    if (typeof encoding === 'function') { callback = encoding; encoding = undefined; }
    try { append(name, typeof chunk === 'string' ? Buffer.from(chunk, encoding) : chunk); }
    catch { return originalWrite(chunk, encoding, callback); }
    if (callback) process.nextTick(callback);
    return true;
  };
}
const record = text => { try { append('lifecycle.log', `${new Date().toISOString()} pid=${process.pid} ${text}\n`); } catch {} };
process.on('exit', code => record(`Exited with code ${code}`));
process.on('uncaughtExceptionMonitor', error => record(`Uncaught exception: ${error.stack || error.message}`));
// Refuse duplicate startup before database initialization or background workers.
const probe = net.createServer();
await new Promise((accept, reject) => { probe.once('error', reject); probe.listen(port, '0.0.0.0', () => probe.close(accept)); });
record(`Starting ZNote on port ${port}`);
await import('../server/index.js');
