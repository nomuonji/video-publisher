import type { VercelRequest, VercelResponse } from '@vercel/node';
import { performVideoPosting } from '../../scripts/post-video'; // Adjust path as needed
import { JWT } from 'google-auth-library';
import { google } from 'googleapis';

// --- Authentication (Service Account) ---
function getServiceAccountAuth() {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON environment variable is not set.');
  }
  const serviceAccountKey = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  return new JWT({
    email: serviceAccountKey.client_email,
    key: serviceAccountKey.private_key,
    scopes: [
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/youtube.upload',
      'https://www.googleapis.com/auth/youtube',
    ],
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { videoId, conceptId, platforms, postDetailsOverride } = req.body;

  if (!videoId || !conceptId || !platforms) {
    return res.status(400).json({ error: 'Missing videoId, conceptId, or platforms in request body.' });
  }

  try {
    // Authenticate with Service Account for Drive access
    const serviceAccountAuth = getServiceAccountAuth();
    await serviceAccountAuth.authorize(); // Ensure token is fetched

    // Call the reusable posting logic
    await performVideoPosting(conceptId, process.env.GOOGLE_SERVICE_ACCOUNT_JSON!, videoId, platforms, postDetailsOverride);

    res.status(200).json({ message: 'Posting process initiated successfully.' });
  } catch (error: any) {
    console.error('Manual posting API failed:', error);
    res.status(500).json({ error: error.message || 'Failed to initiate posting process.' });
  }
}