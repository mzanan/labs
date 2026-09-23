import "server-only";

import { and, eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { newId } from "@/lib/utils";

const { push_subscriptions } = schema;

export interface PushSubscriptionInput {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export async function saveSubscription(
  userId: string,
  input: PushSubscriptionInput,
): Promise<void> {
  await db
    .insert(push_subscriptions)
    .values({
      id: newId(),
      user_id: userId,
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      created_at: new Date(),
    })
    .onConflictDoUpdate({
      target: [push_subscriptions.user_id, push_subscriptions.endpoint],
      set: {
        p256dh: input.p256dh,
        auth: input.auth,
      },
    });
}

export async function deleteSubscription(
  userId: string,
  endpoint: string,
): Promise<void> {
  await db
    .delete(push_subscriptions)
    .where(
      eq(push_subscriptions.endpoint, endpoint),
    );
}

export async function deleteSubscriptionByEndpoint(
  endpoint: string,
): Promise<void> {
  await db
    .delete(push_subscriptions)
    .where(eq(push_subscriptions.endpoint, endpoint));
}

export async function getSubscriptionsForUser(
  userId: string,
): Promise<PushSubscriptionInput[]> {
  const rows = await db
    .select({
      endpoint: push_subscriptions.endpoint,
      p256dh: push_subscriptions.p256dh,
      auth: push_subscriptions.auth,
    })
    .from(push_subscriptions)
    .where(eq(push_subscriptions.user_id, userId));
  return rows;
}

export async function hasSubscription(userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: push_subscriptions.id })
    .from(push_subscriptions)
    .where(eq(push_subscriptions.user_id, userId))
    .limit(1);
  return rows.length > 0;
}
