import type { NextConfig } from 'next';

const config: NextConfig = {
  output: 'standalone',
  turbopack: { root: process.cwd() },
  devIndicators: false,
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  serverExternalPackages: ['pg', 'pg-boss', 'twilio'],
  experimental: { serverActions: { bodySizeLimit: '32kb' } },
};
export default config;
