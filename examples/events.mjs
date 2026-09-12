// Poll a single incremental page. Persist the returned cursor in your integration.
const base = (process.env.ZNOTE_URL || 'http://localhost:3741').replace(/\/$/, '');
if (!process.env.ZNOTE_TOKEN) throw new Error('Set ZNOTE_TOKEN to a read or write token');
const after = Number(process.argv[2] || 0);
if (!Number.isSafeInteger(after) || after < 0) throw new Error('Cursor must be a nonnegative integer');
const response = await fetch(`${base}/api/events?after=${after}`, { headers: { Authorization: `Bearer ${process.env.ZNOTE_TOKEN}` } });
if (!response.ok) throw new Error(`Request failed: ${response.status}`);
console.log(JSON.stringify(await response.json(), null, 2));
