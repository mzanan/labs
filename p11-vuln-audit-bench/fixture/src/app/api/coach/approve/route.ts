import { NextResponse } from "next/server";
import { z } from "zod";

import { resolvePendingWrite } from "@/lib/ai/coachApproval";
import { coachNdjsonResponse } from "@/lib/coachStream";
import { ensureProfile } from "@/lib/profile";
import { notifyGeneratedReply } from "@/lib/push";
import { requireApiUser } from "@/lib/session";

const bodySchema = z.object({
  approvalId: z.string().min(1),
  approved: z.boolean(),
  itemId: z.string().min(1).optional(),
});

export async function POST(request: Request) {
  const user = await requireApiUser();
  if (user instanceof NextResponse) return user;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const profile = await ensureProfile(user.id);

  return coachNdjsonResponse(
    (send) =>
      resolvePendingWrite(
        user.id,
        profile,
        parsed.data.approvalId,
        parsed.data.approved,
        parsed.data.itemId,
        send,
        request.signal,
      ),
    (result) => notifyGeneratedReply(user.id, result),
  );
}
