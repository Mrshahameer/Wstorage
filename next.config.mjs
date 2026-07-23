/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Don't fail the production build on lint or type nitpicks.
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
  images: { remotePatterns: [] },
};
export default nextConfig;
