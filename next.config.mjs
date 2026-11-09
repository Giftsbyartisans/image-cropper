/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  // GitHub Pages hosts this project below the repository name.
  basePath: process.env.GITHUB_PAGES === 'true' ? '/image-cropper' : undefined,
};
export default nextConfig;
