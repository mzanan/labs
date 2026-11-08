import { Inngest } from "inngest";
import { config, inngestBaseUrl, requireEnv } from "./config";

export function createClient() {
  return new Inngest({
    id: config.appId,
    isDev: false,
    baseUrl: inngestBaseUrl(),
    eventKey: requireEnv("INNGEST_EVENT_KEY"),
    signingKey: requireEnv("INNGEST_SIGNING_KEY"),
  });
}
