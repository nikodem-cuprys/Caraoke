/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@singlearn/shared"],
  agentRules: false,
};

module.exports = nextConfig;
