export default function Home() {
  return (
    <main>
      <h1>p3-background-jobs</h1>
      <p>Throwaway lab. See README for the question and how to verify each candidate.</p>
      <ul>
        <li>GET /api/cron-direct: Vercel Cron hitting a plain route handler</li>
        <li>GET /api/cron-workflow-trigger: Vercel Cron starting a Workflow DevKit run</li>
        <li>POST /api/inngest: Inngest function served here, cron-triggered from Inngest Cloud</li>
      </ul>
    </main>
  );
}
