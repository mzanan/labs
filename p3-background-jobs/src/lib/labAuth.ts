export function requireLabSecret(request: Request): Response | null {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.LAB_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  return null;
}
