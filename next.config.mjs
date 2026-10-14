/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The dev-tools badge sits over the sidebar's Password / Sign out buttons.
  devIndicators: false,
  // Self-contained server bundle for the Docker image (node server.js); `next start` is used locally.
  output: process.env.NEXT_OUTPUT === 'standalone' ? 'standalone' : undefined,
  // A separate build folder lets a verification build run next to a running dev server.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // /api/* is handled by the backend-for-frontend route (app/api/[...path]/route.js), not a rewrite,
  // so BACKEND_URL is read at runtime and the API address never reaches the browser.
};
export default nextConfig;
