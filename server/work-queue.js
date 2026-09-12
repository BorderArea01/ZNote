// Bounds CPU work and coalesces concurrent work for the same immutable original.
export class WorkQueue {
  constructor(concurrency = 2, maxPending = 128) {
    this.concurrency = concurrency;
    this.maxPending = maxPending;
    this.active = 0;
    this.pending = [];
    this.jobs = new Map();
    this.peak = 0;
  }
  run(key, task) {
    if (this.jobs.has(key)) return this.jobs.get(key);
    if (this.pending.length >= this.maxPending)
      return Promise.reject(Object.assign(new Error('图片处理队列已满，请稍后重试'), { status: 503 }));
    const promise = new Promise((resolve, reject) => {
      this.pending.push({ key, task, resolve, reject });
    });
    this.jobs.set(key, promise);
    this.drain();
    return promise;
  }
  drain() {
    while (this.active < this.concurrency && this.pending.length) {
      const job = this.pending.shift();
      this.active++;
      this.peak = Math.max(this.peak, this.active);
      Promise.resolve().then(job.task).then(job.resolve, job.reject).finally(() => {
        this.active--;
        this.jobs.delete(job.key);
        this.drain();
      });
    }
  }
}
