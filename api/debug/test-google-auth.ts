
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { JWT } from 'google-auth-library';

const getServiceAccountAuth = () => {
  const serviceAccountJSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!serviceAccountJSON) {
    throw new Error('The GOOGLE_SERVICE_ACCOUNT_JSON environment variable is not set.');
  }

  try {
    const credentials = JSON.parse(serviceAccountJSON);
    const jwt = new JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: ['https://www.googleapis.com/auth/drive'],
    });
    return jwt;
  } catch (error: any) {
    throw new Error(`Failed to parse GOOGLE_SERVICE_ACCOUNT_JSON: ${error.message}`);
  }
};

export default async function handler(_req: VercelRequest, res: VercelResponse) {
    console.log('--- Running Google Auth Test ---');
    try {
        const auth = getServiceAccountAuth();
        console.log('Auth object created. Attempting to get access token...');
        
        const token = await auth.getAccessToken();
        
        console.log('Successfully obtained access token!');
        res.status(200).json({
            status: 'SUCCESS',
            message: 'Google Service Account authentication test passed.',
            token_preview: token.token?.substring(0, 20) + '...',
        });

    } catch (error: any) {
        console.error('Google Auth Test FAILED:', error);
        res.status(500).json({
            status: 'FAILED',
            message: 'Google Service Account authentication test failed.',
            error: {
                message: error.message,
                code: error.code,
                stack: error.stack,
            }
        });
    }
}
