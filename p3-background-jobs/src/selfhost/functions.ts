import type { Inngest } from "inngest";
import { config } from "./config";
import { guideReplied, guideRequested } from "./events";
import { appendStepLog } from "./stepLog";

export function createGuideRequestFunction(inngest: Inngest.Any) {
  return inngest.createFunction(
    { id: "guide-request", triggers: [guideRequested] },
    async ({ event, step }) => {
      const { requestId, guide, timeout } = event.data;

      await step.run("notify-guide", async () => {
        await appendStepLog(config.stepLogPath, { requestId, step: "notify-guide", at: new Date().toISOString() });
        return { guide };
      });

      const reply = await step.waitForEvent("wait-guide-reply", {
        event: guideReplied,
        timeout,
        match: "data.requestId",
      });

      return step.run("record-outcome", async () => {
        const status = reply === null ? "escalated" : reply.data.answer === "yes" ? "confirmed" : "declined";
        await appendStepLog(config.stepLogPath, { requestId, step: `outcome:${status}`, at: new Date().toISOString() });
        return { requestId, status };
      });
    },
  );
}
