import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { envInt } from "@inclination/shared";
import { AppModule } from "./app.module";
import { AppConfig } from "./config/app-config";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    logger: ["log", "error", "warn"],
  });
  app.setGlobalPrefix("api");
  app.enableShutdownHooks();

  const config = app.get(AppConfig);
  // Lock CORS to the configured origin (spec §9). Same-origin (Caddy) needs no
  // CORS, but a separate dev frontend origin does; credentials stay off (the
  // API is bearer-token, not cookie-session).
  app.enableCors({ origin: config.corsOrigin, credentials: false });

  const port = envInt("API_PORT", 3001);
  await app.listen(port, "0.0.0.0");
  console.log(JSON.stringify({ level: "info", msg: "api listening", port }));
}

void bootstrap();
