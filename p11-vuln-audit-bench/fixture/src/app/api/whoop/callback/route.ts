import { NextRequest, NextResponse } from "next/server";

import { connectWhoop, syncWhoop } from "@/lib/integrations/whoop";
import { getUser } from "@/lib/session";

function settingsRedirect(request: NextRequest, status: string) {
  const res = NextResponse.redirect(
    new URL(`/settings?whoop=${status}`, request.url),
  );
  res.cookies.delete("whoop_oauth_state");
  return res;
}

export async function GET(request: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));

  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const expected = request.cookies.get("whoop_oauth_state")?.value;
  if (!code || (expected && state !== expected)) {
    return settingsRedirect(request, "error");
  }

  try {
    await connectWhoop(user.id, code);
    await syncWhoop(user.id);
    return settingsRedirect(request, "connected");
  } catch {
    return settingsRedirect(request, "error");
  }
}
