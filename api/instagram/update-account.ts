import type { VercelRequest, VercelResponse } from '@vercel/node';
import fetch from 'node-fetch';
import { google } from 'googleapis';

// This API endpoint updates the instagram_accounts.json file in Google Drive.
// It now automatically fetches the user ID and username using the provided access token.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  try {
    const { googleAccessToken, instagramAccessToken } = req.body;

    if (!googleAccessToken) throw new Error('Google Access Token is required.');
    if (!instagramAccessToken) throw new Error('Instagram Access Token is required.');

    // Log a snippet of the token for verification purposes
    console.log(`Verifying token starting with: ${instagramAccessToken.substring(0, 10)}...`);

    // Step 1: Fetch user ID and username from Instagram API using the provided token
    // Use graph.facebook.com to align with the successful curl command
    const userProfileRes = await fetch(`https://graph.facebook.com/v19.0/me?fields=id,username&access_token=${instagramAccessToken}`);
    const userProfileData = await userProfileRes.json() as any;
    if (!userProfileRes.ok) {
        // Log the full error from Facebook/Instagram for better debugging
        console.error('Failed to get user profile from token. API Response:', userProfileData);
        throw new Error(`Failed to get user profile from token: ${userProfileData.error?.message || 'Invalid token'}`);
    }

    const newAccountInfo = {
        id: userProfileData.id,
        username: userProfileData.username,
        access_token: instagramAccessToken,
    };

    // Step 2: Authenticate with Google Drive using the user's token
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: googleAccessToken });
    const drive = google.drive({ version: 'v3', auth: oauth2Client });

    // Step 3: Find the 'v-stock' folder
    const vStockRes = await drive.files.list({ q: `mimeType='application/vnd.google-apps.folder' and name='v-stock' and trashed=false`, fields: 'files(id)', pageSize: 1 });
    if (!vStockRes.data.files || vStockRes.data.files.length === 0) {
        throw new Error('The root \'v-stock\' folder was not found in your Google Drive.');
    }
    const parentFolderId = vStockRes.data.files[0].id!;

    // Step 4: Find and read instagram_accounts.json
    const fileRes = await drive.files.list({ q: `'${parentFolderId}' in parents and name='instagram_accounts.json' and trashed=false`, fields: 'files(id)', pageSize: 1 });

    let existingAccounts: any[] = [];
    let existingFileId: string | null = null;

    if (fileRes.data.files && fileRes.data.files.length > 0) {
        existingFileId = fileRes.data.files[0].id!;
        try {
            const fileContentRes = await drive.files.get({ fileId: existingFileId, alt: 'media' });
            if (typeof fileContentRes.data === 'string') existingAccounts = JSON.parse(fileContentRes.data);
            else if (typeof fileContentRes.data === 'object') existingAccounts = fileContentRes.data as any[];
        } catch (error) {
            console.error('Error reading existing instagram_accounts.json', error);
        }
    }

    // Step 5: Merge new account info into existing list
    const accountIndex = existingAccounts.findIndex(acc => acc.id === newAccountInfo.id);
    if (accountIndex > -1) {
        existingAccounts[accountIndex] = { ...existingAccounts[accountIndex], ...newAccountInfo };
    } else {
        existingAccounts.push(newAccountInfo);
    }

    // Step 6: Write the updated list back to the file
    const media = { mimeType: 'application/json', body: JSON.stringify(existingAccounts, null, 2) };

    if (existingFileId) {
        await drive.files.update({ fileId: existingFileId, media: media });
    } else {
        await drive.files.create({ requestBody: { name: 'instagram_accounts.json', parents: [parentFolderId] }, media: media, fields: 'id' });
    }

    res.status(200).json({ success: true, message: 'Instagram account information updated successfully.' });

  } catch (error: any) {
    console.error('Update Instagram account failed:', error);
    res.status(500).json({ success: false, message: error.message });
  }
}
