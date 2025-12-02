const requiredEnvVars = [
  'NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID',
] as const;

const networkEnvVars = [
  'NEXT_PUBLIC_PHEATHERX_ADDRESS_LOCAL',
  'NEXT_PUBLIC_SWAP_ROUTER_ADDRESS_LOCAL',
] as const;

export function validateEnv(): void {
  const missing: string[] = [];

  for (const key of requiredEnvVars) {
    if (!process.env[key]) {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.join(', ')}`);
    if (process.env.NODE_ENV === 'production') {
      throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }
  }

  // Warn about missing network vars in development
  if (process.env.NODE_ENV === 'development') {
    for (const key of networkEnvVars) {
      if (!process.env[key]) {
        console.warn(`Warning: ${key} not set. Some features may not work.`);
      }
    }
  }
}
