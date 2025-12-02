import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Webpack configuration for handling optional modules
  webpack: (config, { isServer }) => {
    // Handle optional/react-native modules used by MetaMask SDK
    config.resolve.alias = {
      ...config.resolve.alias,
      'pino-pretty': false,
      '@react-native-async-storage/async-storage': false,
    };

    // Enable WASM support for cofhejs/tfhe
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
      layers: true,
    };

    // Handle WASM files
    config.module.rules.push({
      test: /\.wasm$/,
      type: 'webassembly/async',
    });

    // Don't bundle cofhejs on server-side (it's client-only with WASM)
    if (isServer) {
      config.externals = config.externals || [];
      config.externals.push('cofhejs', 'cofhejs/web', 'tfhe');
    }

    return config;
  },

  // TypeScript config
  typescript: {
    ignoreBuildErrors: false,
  },

  // Transpile packages that have ESM issues
  transpilePackages: ['@walletconnect/ethereum-provider'],

  // Optimize package imports
  experimental: {
    optimizePackageImports: ['ethers', 'viem'],
  },
};

export default nextConfig;
