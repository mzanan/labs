import { start } from 'workflow/api';
import { maintenanceWorkflow } from '@/app/workflows/maintenance-workflow';

export async function GET(req: Request) {
  const auth = req.headers.get('authorization');
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const run = await start(maintenanceWorkflow, ['vercel-cron']);
  return Response.json({ source: 'cron-workflow-trigger', run });
}
