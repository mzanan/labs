import { withWorkflow } from 'workflow/next';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    '/api/extract/**': ['./fixtures/**'],
  },
};

export default withWorkflow(nextConfig);
