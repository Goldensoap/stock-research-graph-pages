import type { NextConfig } from 'next';

const DEFAULT_ALLOWED_DEV_ORIGINS = [
  '127.0.0.1',
  '10.*.*.*',
  '192.168.*.*',
  ...Array.from({ length: 16 }, (_, index) => `172.${index + 16}.*.*`),
];

/**
 * 读取开发环境允许访问 Next 内部资源的来源主机。
 * @returns 允许的开发来源主机列表。
 */
function getAllowedDevOrigins(): string[] {
  const configuredOrigins = process.env.NEXT_ALLOWED_DEV_ORIGINS;
  if (!configuredOrigins) {
    return DEFAULT_ALLOWED_DEV_ORIGINS;
  }

  return configuredOrigins
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

const nextConfig: NextConfig = {
  allowedDevOrigins: getAllowedDevOrigins(),
  serverExternalPackages: ['better-sqlite3'],
};

export default nextConfig;
