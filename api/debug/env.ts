
import type { VercelRequest, VercelResponse } from '@vercel/node';

// Temporary debug endpoint to inspect env loading at runtime.

const snapshotEnv = () => {
  const key = process.env.GOOGLE_PRIVATE_KEY;
  const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

  return {
    timestamp: new Date().toISOString(),
    cwd: process.cwd(),
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
