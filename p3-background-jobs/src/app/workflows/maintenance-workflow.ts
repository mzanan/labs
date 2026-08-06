export async function maintenanceWorkflow(trigger: string) {
  'use workflow';

  const result = await runMaintenanceStep(trigger);
  return result;
}

async function runMaintenanceStep(trigger: string) {
  'use step';

  const ranAt = new Date().toISOString();
  console.log(`[workflow-step] ran at ${ranAt}, trigger=${trigger}`);
  return { trigger, ranAt };
}
