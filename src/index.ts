import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import cors from "@fastify/cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { seedDefaults } from "./db/index.js";
import { loadSettingsFromDb } from "./settings.js";
import { registerRoutes } from "./api.js";
import { startScheduler } from "./scheduler.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  seedDefaults();
  loadSettingsFromDb();

  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });
  await registerRoutes(app);
  await app.register(fastifyStatic, {
    root: path.join(__dirname, "web"),
    prefix: "/",
  });

  startScheduler();

  await app.listen({ port: config.PORT, host: config.HOST });
  console.log(`AIPAC running at http://${config.HOST}:${config.PORT}`);
}

// Node 内置 sqlite 在部分版本需显式开启；tsx/dev 下通常可直接 import
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
