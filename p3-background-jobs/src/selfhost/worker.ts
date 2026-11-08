import { createServer } from "node:http";
import { serve } from "inngest/node";
import { createClient } from "./client";
import { config } from "./config";
import { createGuideRequestFunction } from "./functions";

const inngest = createClient();
const handler = serve({
  client: inngest,
  functions: [createGuideRequestFunction(inngest)],
  servePath: config.servePath,
});

const server = createServer((req, res) => {
  if (req.url?.startsWith(config.servePath)) return handler(req, res);
  res.statusCode = req.url === "/ready" ? 200 : 404;
  res.end();
});

server.listen(config.workerPort, "0.0.0.0", () => {
  console.log(`[selfhost-worker] listening on ${config.workerPort}`);
});
