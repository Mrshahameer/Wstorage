/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // We proxy all storage access; no remote image loader needed by default.
  // Add your B2 S3 endpoint host here if you ever render <Image> from previews.
  images: { remotePatterns: [] },
};
export default nextConfig;
