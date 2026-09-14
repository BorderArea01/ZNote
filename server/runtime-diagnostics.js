import fs from 'node:fs';
import {join} from 'node:path';
import {VERSION} from './version.js';

// Process-local diagnostics: never installs an exception handler that masks a crash.
export function installRuntimeDiagnostics(dataDir, {port, heartbeatMs = 30000} = {}) {
  const dir = join(dataDir, 'logs'), reports = join(dir, 'reports');
  fs.mkdirSync(reports, {recursive:true});
  const statePath = join(dir, 'run-state.json');
  let state, timer, loggingErrorReported = false;
  const stderr = process.stderr.write.bind(process.stderr);
  const append = (name, chunk) => {
    const path = join(dir, name);
    if (fs.existsSync(path) && fs.statSync(path).size > 5 * 1024 * 1024) {
      fs.rmSync(path + '.previous', {force:true});
      fs.renameSync(path, path + '.previous');
    }
    fs.appendFileSync(path, chunk);
  };
  const safely = operation => {
    try { operation(); }
    catch (error) {
      if (!loggingErrorReported) { loggingErrorReported = true; stderr(`ZNote diagnostics could not write: ${error.message}\n`); }
    }
  };
  const record = (event, fields = {}) => safely(() => append('lifecycle.log', JSON.stringify({at:new Date().toISOString(), pid:process.pid, event, ...fields}) + '\n'));
  for (const [stream, name] of [[process.stdout, 'server.stdout.log'], [process.stderr, 'server.stderr.log']]) {
    const original = stream.write.bind(stream);
    stream.write = (chunk, encoding, callback) => {
      if (typeof encoding === 'function') { callback = encoding; encoding = undefined; }
      try { append(name, typeof chunk === 'string' ? Buffer.from(chunk, encoding) : chunk); }
      catch { return original(chunk, encoding, callback); }
      if (callback) process.nextTick(callback);
      return true;
    };
  }
  // Native failures (e.g. V8 heap exhaustion) can bypass JavaScript stderr hooks.
  // Reports contain stacks/resource statistics, with environment variables excluded.
  process.report.directory = reports;
  process.report.excludeEnv = true;
  process.report.excludeNetwork = true;
  process.report.reportOnFatalError = true;
  process.report.reportOnUncaughtException = true;
  safely(() => {
    const files = fs.readdirSync(reports).filter(name => /^report\..+\.json$/.test(name))
      .sort((a,b) => fs.statSync(join(reports,b)).mtimeMs - fs.statSync(join(reports,a)).mtimeMs);
    for (const name of files.slice(9)) fs.unlinkSync(join(reports,name));
  });
  const snapshot = () => {
    if (!state) return;
    state.lastSeenAt = new Date().toISOString();
    state.uptimeSeconds = Math.round(process.uptime());
    state.memory = process.memoryUsage();
    safely(() => {
      const temp = `${statePath}.${process.pid}.tmp`;
      fs.writeFileSync(temp, JSON.stringify(state,null,2));
      fs.renameSync(temp, statePath);
    });
  };
  process.on('uncaughtExceptionMonitor', (error, origin) => {
    if (state) state.failure = {origin, message:error.message};
    record('uncaught_exception', {origin, message:error.message, stack:error.stack, memory:process.memoryUsage()});
    snapshot();
  });
  process.on('exit', code => {
    clearInterval(timer);
    record('exit', {code, signal:state?.signal, failure:state?.failure});
    if (state) { state.phase = 'exited'; state.exitCode = code; snapshot(); }
  });
  return {
    // Call only after checking that this process owns the service port.
    begin() {
      try {
        const previous = JSON.parse(fs.readFileSync(statePath,'utf8'));
        if (previous.phase !== 'exited') record('previous_run_missing_exit', {previous});
      } catch (error) { if (error.code !== 'ENOENT') record('previous_state_unreadable', {message:error.message}); }
      state = {pid:process.pid, parentPid:process.ppid, port, version:VERSION, node:process.version, startedAt:new Date().toISOString(), phase:'running'};
      record('start', state);
      snapshot();
      timer = setInterval(snapshot, heartbeatMs);
      timer.unref();
    },
    observeShutdownSignals() {
      // Existing server handlers own shutdown; these listeners only record it.
      for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => {
        if (state) state.signal = signal;
        record('shutdown_signal', {signal}); snapshot();
      });
    },
  };
}
