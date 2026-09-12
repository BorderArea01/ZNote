// GPL-3.0-or-later. Only an explicitly requested library crawl bypasses auto-download.
const handled = new WeakSet<object>();
export const libraryRouting = {
  active: false,
  handled: (result: object) => handled.has(result),
  release: (result: object) => handled.delete(result),
  finish(result: object) {
    handled.add(result);
    this.active = false;
  },
};
