
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { JWT } from 'google-auth-library';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });

const getServiceAccountAuth = () => {
  console.log('[getServiceAccountAuth] ENTERED');
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY;
  console.log(`[getServiceAccountAuth] Email defined: ${!!email}, Key defined: ${!!key}`);
  if (!email || !key) {
    throw new Error('Google Service Account credentials are not set in environment variables.');
  }
  console.log('[getServiceAccountAuth] ABOUT TO CALL new JWT()');
  const jwt = new JWT({
    email: email,
    key: key,
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
  console.log('[getServiceAccountAuth] new JWT() SUCCEEDED');
  return jwt;
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
