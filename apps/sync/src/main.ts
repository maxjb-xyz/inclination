import { envInt } from "@inclination/shared";
import { createSyncServer } from "./server.js";

async function bootstrap(): Promise<void> {
  const server = createSyncServer();
  const port = envInt("SYNC_PORT", 3002);
  await server.listen(port);
  console.log(JSON.stringify({ level: "info", msg: "sync listening", port }));

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      void server.close().then(() => process.exit(0));
    });
  }
}

void bootstrap();
