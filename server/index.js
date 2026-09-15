import { createApp } from "./app.js";
import { VERSION } from './version.js';
const port = Number(process.env.PORT || 3741);
const { app, db, backups, webhooks, imports, captures, trash, weixin } = createApp({ dataDir: process.env.DATA_DIR, port });
backups.start();
webhooks.start();
trash.start();
weixin.start();
const server = app.listen(port, process.env.HOST || "0.0.0.0", () =>
    console.log(
      `ZNote ${VERSION} listening on port ${port}; open http://localhost:${port}`,
    ),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () =>
    server.close(async () => {
      await weixin.stop();
      await trash.stop();
      await imports.stop();
      await captures.stop();
      await backups.stop();
      await webhooks.stop();
      db.close();
      process.exit(0);
    }),
  );
