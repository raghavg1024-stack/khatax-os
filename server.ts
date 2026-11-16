import nextEnv from "@next/env";
import next from "next";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { relayVoice } from "./src/lib/voice-relay";

nextEnv.loadEnvConfig(process.cwd());
process.env.DATABASE_URL ||= "file:./khatax.db";
const dev = !process.argv.includes("--production");
const port = Number(process.env.PORT || 3000);
const app = next({ dev, hostname: "127.0.0.1", port, turbopack: false });
await app.prepare();
const handle = app.getRequestHandler();
const upgrade = app.getUpgradeHandler();
const server = createServer((req, res) => handle(req, res));
const wss = new WebSocketServer({ noServer: true, maxPayload: 8192 });
server.on("upgrade", (req, socket, head) => {
  const path = new URL(req.url || "/", `http://${req.headers.host}`).pathname;
  if (path !== "/api/voice") {
    void upgrade(req, socket, head);
    return;
  }
  const origin = req.headers.origin;
  if (origin && origin !== `http://${req.headers.host}`) {
    socket.destroy();
    return;
  }
  if (wss.clients.size >= 3) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (client) => {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    void relayVoice(client, url.searchParams.get("language"));
  });
});
server.listen(port, "127.0.0.1", () =>
  console.log(`KhataX OS ready at http://localhost:${port}`),
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    wss.clients.forEach((c) => c.close());
    wss.close();
    server.close(() => process.exit(0));
  });
