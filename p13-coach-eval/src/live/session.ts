import { createHmac, randomBytes, randomUUID } from "node:crypto";
import type pg from "pg";

export async function openSession(client: pg.Client, userId: string, secret: string) {
  const token = randomBytes(24).toString("hex");
  const id = randomUUID();
  await client.query(
    `insert into session (id, "expiresAt", token, "createdAt", "updatedAt", "userId", "userAgent") values ($1, now() + interval '1 day', $2, now(), now(), $3, 'p13-live-eval')`,
    [id, token, userId],
  );
  const signature = createHmac("sha256", secret).update(token).digest("base64");
  return {
    cookie: `fit-coach.session_token=${encodeURIComponent(`${token}.${signature}`)}`,
    close: () => client.query("delete from session where id=$1", [id]),
  };
}
