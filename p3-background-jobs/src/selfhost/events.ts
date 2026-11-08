import { eventType } from "inngest";
import { z } from "zod";
import { config } from "./config";

export const guideRequested = eventType(config.events.requested, {
  schema: z.object({
    requestId: z.string(),
    guide: z.string(),
    timeout: z.string(),
  }),
});

export const guideReplied = eventType(config.events.replied, {
  schema: z.object({
    requestId: z.string(),
    answer: z.enum(["yes", "no"]),
  }),
});
