import net from 'node:net';
import {resolve, dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {installRuntimeDiagnostics} from '../server/runtime-diagnostics.js';

// Run the server in the task's own process so stopping the task stops the server.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = resolve(process.argv[2] || join(root, 'data'));
const port = Number(process.argv[3] || 3741);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid port');
process.chdir(root);
process.env.DATA_DIR = dataDir;
process.env.PORT = String(port);
process.env.HOST = '0.0.0.0';
const diagnostics = installRuntimeDiagnostics(dataDir, {port});
// Refuse duplicate startup before database initialization or background workers.
const probe = net.createServer();
await new Promise((accept, reject) => { probe.once('error', reject); probe.listen(port, '0.0.0.0', () => probe.close(accept)); });
diagnostics.begin();
await import('../server/index.js');
diagnostics.observeShutdownSignals();
