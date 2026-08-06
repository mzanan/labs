export async function GET(req: Request) {
  const auth = req.headers.get('authorization');
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const ranAt = new Date().toISOString();
  console.log(`[cron-direct] fired at ${ranAt}`);
  return Response.json({ source: 'cron-direct', ranAt });
}
