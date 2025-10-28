import type { NextConfig } from "next";

const nextConfig: NextConfig = {
//     eslint: {
//     ignoreDuringBuilds: true, // Skip ESLint during `next build`
//   },
  typescript: {
    ignoreBuildErrors: true, // Skips type checking during `next build`
  },
    reactStrictMode: false,
/* config options here */
};

export default nextConfig;
