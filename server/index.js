import { createApp } from "./app.js";
const port = Number(process.env.PORT || 3741);
const { app, db, backups, webhooks, imports, trash } = createApp({ dataDir: process.env.DATA_DIR, port });
backups.start();
webhooks.start();
trash.start();
const server = app.listen(port, process.env.HOST || "0.0.0.0", () =>
    console.log(
      `ZNote 0.9.9 listening on port ${port}; open http://localhost:${port}`,
    ),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () =>
    server.close(async () => {
      await trash.stop();
      await imports.stop();
      await backups.stop();
      await webhooks.stop();
      db.close();
      process.exit(0);
    }),
  );
