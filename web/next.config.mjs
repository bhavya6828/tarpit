/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false, // strict-mode double-mount would open two audio sockets
  env: {
    NEXT_PUBLIC_HONEYPOT_SERVER: process.env.NEXT_PUBLIC_HONEYPOT_SERVER || 'localhost:8787',
    NEXT_PUBLIC_HONEYPOT_TOKEN: process.env.NEXT_PUBLIC_HONEYPOT_TOKEN || '',
  },
};
export default nextConfig;
