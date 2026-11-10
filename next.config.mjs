/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Don't fail the production build on lint or type nitpicks.
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
  images: { remotePatterns: [] },
  // Shown in the sidebar so you always know which deploy you are looking at.
  env: {
    NEXT_PUBLIC_BUILD_SHA: (process.env.VERCEL_GIT_COMMIT_SHA || "local").slice(0, 7),
    NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
  },
};
export default nextConfig;
