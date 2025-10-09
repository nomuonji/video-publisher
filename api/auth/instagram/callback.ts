
import type { VercelRequest, VercelResponse } from '@vercel/node';
import fetch from 'node-fetch';
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';

console.log('Instagram callback module initializing…');

// --- Utility Functions ---

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

const renderResponseScript = (status: 'success' | 'error', service: string, message?: string) => `
  <!DOCTYPE html>
  <html>
    <head><title>Authentication ${status === 'success' ? 'Success' : 'Failed'}</title></head>
    <body>
      <script>
        window.opener.postMessage({ status: '${status}', service: '${service}', message: '${message || ''}' }, '*');
        window.close();
      </script>
      <p>Authentication ${status}! You can now close this window.</p>
    </body>
  </html>
`;

const GRAPH_API_URL = 'https://graph.facebook.com/v19.0';

// --- Main Handler ---

export default async function handler(req: VercelRequest, res: VercelResponse) {
  console.log('ENV GOOGLE_PRIVATE_KEY defined:', Boolean(process.env.GOOGLE_PRIVATE_KEY));
  console.log('ENV GOOGLE_PRIVATE_KEY length:', process.env.GOOGLE_PRIVATE_KEY?.length);
  console.log('ENV GOOGLE_SERVICE_ACCOUNT_EMAIL defined:', Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL));
  console.log('ENV GOOGLE_SERVICE_ACCOUNT_JSON defined:', Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON));
  console.log('ENV GOOGLE_SERVICE_ACCOUNT_JSON length:', process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.length);
  const { code, state } = req.query;

  if (!code || typeof code !== 'string') {
    return res.status(400).send('Authorization code is missing.');
  }
  if (!state || typeof state !== 'string') {
    return res.status(400).send('State is missing.');
  }

  let conceptId: string;
  try {
    conceptId = JSON.parse(state).conceptId;
    if (!conceptId) {
      throw new Error('Concept ID not found in state.');
    }
  } catch (error) {
    return res.status(400).send('Invalid state format.');
  }

  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'http';
  const redirectUri = `${proto}://${host}/api/auth/instagram/callback`;

    try {

      // Step 1: Exchange code for a short-lived User Access Token

      const tokenUrl = `${GRAPH_API_URL}/oauth/access_token`;

      const tokenParams = new URLSearchParams({

          client_id: process.env.INSTAGRAM_APP_ID!,

          client_secret: process.env.INSTAGRAM_APP_SECRET!,

          redirect_uri: redirectUri,

          code: code,

      });

  

      const tokenRes = await fetch(`${tokenUrl}?${tokenParams.toString()}`);

      const shortLivedTokenData = await tokenRes.json();

      if (!tokenRes.ok) {

          throw new Error(`Failed to get short-lived token: ${shortLivedTokenData.error?.message || 'Unknown error'}`);

      }

      const shortLivedToken = shortLivedTokenData.access_token;

  

      // Step 2: Exchange for a long-lived User Access Token

      const longLivedTokenUrl = `${GRAPH_API_URL}/oauth/access_token`;

      const longLivedTokenParams = new URLSearchParams({

          grant_type: 'fb_exchange_token',

          client_id: process.env.INSTAGRAM_APP_ID!,

          client_secret: process.env.INSTAGRAM_APP_SECRET!,

          fb_exchange_token: shortLivedToken,

      });

  

      const longLivedTokenRes = await fetch(`${longLivedTokenUrl}?${longLivedTokenParams.toString()}`);

      const longLivedTokenData = await longLivedTokenRes.json();

      if (!longLivedTokenRes.ok) {

          throw new Error(`Failed to get long-lived token: ${longLivedTokenData.error?.message || 'Unknown error'}`);

      }

      const longLivedToken = longLivedTokenData.access_token;

  

          // Step 3: Get the user's pages and find all linked Instagram accounts

  

          const pagesUrl = `${GRAPH_API_URL}/me/accounts`;

  

          const pagesParams = new URLSearchParams({

  

              access_token: longLivedToken,

  

              fields: 'id,name,access_token,instagram_business_account{id,name,username}',

  

          });

  

      

  

          const pagesRes = await fetch(`${pagesUrl}?${pagesParams.toString()}`);

  

          const pagesData = await pagesRes.json();

  

          if (!pagesRes.ok) {

  

              throw new Error(`Failed to get pages: ${pagesData.error?.message || 'Unknown error'}`);

  

          }

  

      

  

          const linkedAccounts = pagesData.data

  

              .filter((page: any) => page.instagram_business_account)

  

              .map((page: any) => ({

  

                  id: page.instagram_business_account.id,

  

                  name: page.instagram_business_account.name,

  

                  username: page.instagram_business_account.username,

  

                  page_id: page.id,

  

                  page_name: page.name,

  

                  page_access_token: page.access_token, // This is a long-lived Page Access Token

  

              }));

  

      

  

          if (linkedAccounts.length === 0) {

  

              throw new Error('No Instagram Business Account linked to any of your Facebook Pages was found.');

  

          }

  

      

  

          // Step 4: Find the v-stock folder and save the accounts to a global config file

  

          const serviceAuth = getServiceAccountAuth();

  

          const drive = google.drive({ version: 'v3', auth: serviceAuth });

  

      

  

          const vStockRes = await drive.files.list({

  

              q: `mimeType='application/vnd.google-apps.folder' and name='v-stock' and trashed=false`,

  

              fields: 'files(id)',

  

              pageSize: 1,

  

          });

  

          const vStockFolder = vStockRes.data.files?.[0];

  

          if (!vStockFolder || !vStockFolder.id) {

  

              throw new Error('The root \'v-stock\' folder was not found in your Google Drive.');

  

          }

  

      

  

          // Find or create the global instagram_accounts.json file

  

          const globalConfigRes = await drive.files.list({

  

              q: `'${vStockFolder.id}' in parents and name='instagram_accounts.json' and trashed=false`,

  

              fields: 'files(id)',

  

              pageSize: 1,

  

          });

  

      

  

          const globalConfigFile = globalConfigRes.data.files?.[0];

  

          const fileMetadata = {

  

              name: 'instagram_accounts.json',

  

              mimeType: 'application/json',

  

              parents: !globalConfigFile ? [vStockFolder.id] : undefined,

  

          };

  

          const media = {

  

              mimeType: 'application/json',

  

              body: JSON.stringify(linkedAccounts, null, 2),

  

          };

  

      

  

          if (globalConfigFile && globalConfigFile.id) {

  

              // Update existing file

  

              await drive.files.update({ fileId: globalConfigFile.id, media: media });

  

          } else {

  

              // Create new file

  

              await drive.files.create({ requestBody: fileMetadata, media: media });

  

          }

  

      

  

      res.setHeader('Content-Type', 'text/html');

      res.status(200).send(renderResponseScript('success', 'instagram'));

  

    } catch (error: any) {

      console.error('Instagram callback handler failed:', error);
      if (error && error.stack) {
        console.error('Instagram callback handler stack:', error.stack);
      }

      res.setHeader('Content-Type', 'text/html');

      res.status(500).send(renderResponseScript('error', 'instagram', error.message));

    }
}
