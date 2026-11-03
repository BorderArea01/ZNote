export const downloading = status => ['queued', 'running', 'saving'].includes(status);
export const downloadFailed = job => !job.retried_as && (job.status === 'failed' || job.status === 'completed' && job.bgm_status === 'failed');
export const retryableDownload = job => !job.retried_as && (downloadFailed(job) || job.type === 'import' && job.status === 'cancelled');
export function downloadJobs(remote) {
  return ['capture', 'import'].flatMap(type => (remote[type === 'capture' ? 'captures' : 'imports'] || []).map(job => ({
    ...job, type, remote_id: job.id, id: type + ':' + job.id,
    state: job.retried_as ? 'resubmitted' : downloading(job.status) ? 'active' : downloadFailed(job) ? 'failed' : job.status,
    title: job.title || job.source_url || '作品下载',activity_at:job.finished_at||job.last_attempt_at||job.created_at,
  }))).sort((a, b) => (Date.parse(b.activity_at) || 0) - (Date.parse(a.activity_at) || 0) || a.id.localeCompare(b.id));
}
export function filterDownloads(jobs, {scope = 'all', days = '7', status = 'all', now = Date.now()} = {}) {
  return jobs.filter(job => (scope === 'all' || (job.collection_id || 'unfiled') === scope)
    && (days === 'all' || Date.parse(job.activity_at||job.created_at) >= now - Number(days) * 86400000)
    && (status === 'all' || job.state === status));
}
export function downloadSource(value) {
  try { const u = new URL(value); return /^https?:$/.test(u.protocol) && !u.username && !u.password ? {href:u.href,host:u.hostname} : null; } catch { return null; }
}
// Recheck the original task before writing. A lost response must never cause
// an automatic second submission; its next GET reveals the accepted state.
export async function retryDownloads(jobs, {request, onProgress = () => {}, shouldContinue = () => true}) {
  const selected = [...new Map(jobs.filter(retryableDownload).map(j => [j.id, j])).values()];
  const result = {total:selected.length, submitted:0, skipped:0, errors:[], remaining:selected.length};
  for (const job of selected) {
    if (!shouldContinue()) break;
    const path = '/api/' + (job.type === 'capture' ? 'captures' : 'imports') + '/' + encodeURIComponent(job.remote_id);
    try {
      const current = await request(path);
      if (!shouldContinue()) break;
      if ((current.collection_id || null) !== (job.collection_id || null)) throw Error('任务所属知识库已变化，请刷新记录');
      if (!retryableDownload({...current,type:job.type})) result.skipped++;
      else { await request(path + '/retry', {method:'POST',body:'{}'}); result.submitted++; }
    } catch (error) {
      result.errors.push({id:job.id,title:job.title,message:error.message});
      // Capacity/auth failures apply to the rest too. Keep their records for
      // the next explicit retry instead of flooding the server with writes.
      if ([401,403,429].includes(error.status)) { result.remaining--; onProgress({...result}); break; }
    }
    result.remaining--; onProgress({...result});
  }
  return result;
}
