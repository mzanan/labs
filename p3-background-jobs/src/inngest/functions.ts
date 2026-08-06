import { inngest } from './client';

export const maintenanceCron = inngest.createFunction(
  { id: 'maintenance-cron' },
  { cron: '0 1 * * *' },
  async ({ step }) => {
    return step.run('log-run', async () => {
      const ranAt = new Date().toISOString();
      console.log(`[inngest-cron] ran at ${ranAt}`);
      return { ranAt };
    });
  },
);
