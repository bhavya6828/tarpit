/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false, // strict-mode double-mount would open two audio sockets
  env: {
    NEXT_PUBLIC_TARPIT_SERVER: process.env.NEXT_PUBLIC_TARPIT_SERVER || 'localhost:8787',
    NEXT_PUBLIC_TARPIT_TOKEN: process.env.NEXT_PUBLIC_TARPIT_TOKEN || '',
  },
};
export default nextConfig;
