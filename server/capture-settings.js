import { z } from 'zod';

const schema = z.object({ image_size_mode: z.enum(['original', 'compress']) });
export function captureSettings(db) {
  const value = db.prepare('SELECT value FROM settings WHERE key=?').get('capture_settings_v1')?.value;
  try { return schema.parse(JSON.parse(value)); }
  catch { return { image_size_mode: 'original' }; }
}
export function saveCaptureSettings(db, raw) {
  const value = schema.parse(raw);
  db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
    .run('capture_settings_v1', JSON.stringify(value));
  return value;
}
