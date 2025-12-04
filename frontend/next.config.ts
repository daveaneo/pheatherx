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

    // Enable WASM support for cofhejs/tfhe (from official cofhejs docs)
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
      layers: true,
      topLevelAwait: true,
    };

    // Named module IDs for better debugging
    config.optimization = config.optimization || {};
    config.optimization.moduleIds = 'named';

    // Handle WASM files as static resources
    config.module.rules.push({
      test: /\.wasm$/,
      type: 'asset/resource',
    });

    // Set WASM output paths
    if (isServer) {
      config.output.webassemblyModuleFilename = './../static/wasm/tfhe_bg.wasm';
    } else {
      config.output.webassemblyModuleFilename = 'static/wasm/tfhe_bg.wasm';
      // Enable async functions in output environment for client
      config.output.environment = {
        ...config.output.environment,
        asyncFunction: true
      };
    }

    // Don't bundle cofhejs on server-side (it's client-only with WASM)
    if (isServer) {
      config.externals = config.externals || [];
      config.externals.push(
        /^cofhejs.*/,
        /^tfhe.*/,
        /^node-tfhe.*/
      );
    }

    // Ignore the 'wbg' import in tfhe - it's handled internally
    config.resolve.alias = {
      ...config.resolve.alias,
      'wbg': false,
    };

    // Provide fallbacks for Node.js modules used by cofhejs in browser
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        crypto: false,
      };
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
