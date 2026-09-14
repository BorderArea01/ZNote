// GPL-3.0-or-later. Retry only transient request failures, never validation errors.
export const RETRY_DELAYS = [5000, 15000, 45000, 120000];
export const retryableStatus = status => status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 599);
export function requestError(message, response) {
  const error = new Error(message);
  error.status = response.status;
  error.retryable = retryableStatus(response.status);
  const value = response.headers.get('retry-after');
  const seconds = value === null ? NaN : Number(value);
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value || '') - Date.now();
  error.retryAfter = Number.isFinite(delay) ? Math.min(3600000, Math.max(0, delay)) : 0;
  return error;
}
export function networkError(error, signal) {
  if (signal?.aborted) return signal.reason || error;
  const next = new Error(error?.name === 'TimeoutError' ? '网络请求超时' : '网络连接中断，请检查网络或知识库服务');
  next.retryable = true;
  return next;
}
export async function request(url, options = {}, timeout = 45000) {
  const signal = options.signal;
  try { return await fetch(url, {...options, signal:AbortSignal.any([signal, AbortSignal.timeout(timeout)].filter(Boolean))}); }
  catch (error) { throw networkError(error, signal); }
}
export async function responseJSON(response, signal) {
  try { return await response.json(); }
  catch (error) {
    if (signal?.aborted) throw signal.reason || error;
    const next = new Error('服务器响应不完整或格式无效'); next.retryable = true; throw next;
  }
}
export function scheduleRetry(state, error, now = Date.now()) {
  const count = Number(state.retryCount) || 0;
  if (!error?.retryable || count >= RETRY_DELAYS.length) return 0;
  state.retryCount = count + 1;
  return now + Math.max(RETRY_DELAYS[count], Number(error.retryAfter) || 0);
}
export function retryMessage(count, at) {
  return `等待自动重试 ${count} / ${RETRY_DELAYS.length} · ${new Date(at).toLocaleTimeString()} 后重试`;
}
export function waitForRetry(at, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => {clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(signal.reason);};
    const timer = setTimeout(() => {signal?.removeEventListener('abort',abort);resolve();},Math.max(0,at-Date.now()));
    signal?.addEventListener('abort',abort,{once:true});
    if (signal?.aborted) abort();
  });
}
