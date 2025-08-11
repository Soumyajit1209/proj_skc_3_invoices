/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Ensure API routes use Node.js runtime for JWT operations
    runtime: 'nodejs',
  },
  // Webpack configuration to handle node modules
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        crypto: false,
      };
    }
    return config;
  },
};

module.exports = nextConfig;