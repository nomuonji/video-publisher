import type { VercelRequest, VercelResponse } from '@vercel/node';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

// Temporary debug endpoint to inspect env loading at runtime.

const candidateEnvPaths = [
  path.resolve(process.cwd(), '.env.local'),
  path.resolve(process.cwd(), '.env'),
];

const resolvedEnvPath = candidateEnvPaths.find((candidate) => fs.existsSync(candidate));

console.log('[env-debug] module cwd:', process.cwd());
console.log('[env-debug] env candidates:', candidateEnvPaths);
console.log('[env-debug] resolved env path:', resolvedEnvPath);

if (resolvedEnvPath) {
  dotenv.config({ path: resolvedEnvPath });
  console.log('[env-debug] dotenv configured from:', resolvedEnvPath);
} else {
  console.warn('[env-debug] no env file found when module initialized');
}

const snapshotEnv = () => {
  const key = process.env.GOOGLE_PRIVATE_KEY;
  const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

  return {
    timestamp: new Date().toISOString(),
    cwd: process.cwd(),
    resolvedEnvPath,
    env: {
      GOOGLE_PRIVATE_KEY_defined: Boolean(key),
      GOOGLE_PRIVATE_KEY_length: key?.length ?? 0,
      GOOGLE_PRIVATE_KEY_preview: key ? `${key.slice(0, 10)}...${key.slice(-10)}` : undefined,
      GOOGLE_SERVICE_ACCOUNT_EMAIL: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      GOOGLE_SERVICE_ACCOUNT_JSON_defined: Boolean(json),
      GOOGLE_SERVICE_ACCOUNT_JSON_length: json?.length ?? 0,
      GOOGLE_SERVICE_ACCOUNT_JSON_preview: json ? `${json.slice(0, 30)}...${json.slice(-30)}` : undefined,
    },
  };
};

export default function handler(_req: VercelRequest, res: VercelResponse) {
  const data = snapshotEnv();
  console.log('[env-debug] handler snapshot:', data);
  res.status(200).json(data);
}
