import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { hasWhoopEnv, whoopAuthorizeUrl } from "@/lib/integrations/whoop";
import { getUser } from "@/lib/session";

export async function GET(request: Request) {
  const user = await getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));
  if (!hasWhoopEnv()) {
    const next = new URL(request.url).searchParams.get("next");
    return NextResponse.redirect(new URL(next ?? "/settings?whoop=env", request.url));
  }

  const state = randomUUID();
  const res = NextResponse.redirect(whoopAuthorizeUrl(state));
  res.cookies.set("whoop_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 600,
    path: "/api/whoop",
  });
  return res;
}
