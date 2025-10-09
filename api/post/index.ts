
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
import { uploadVideoToTiktok } from '../../services/tiktokService';
import { postVideoToInstagram } from '../../services/instagramService';

// --- Service Account Client for Drive ---
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


export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).end(`Method ${req.method} Not Allowed`);
    }

    try {
        const { videoId, conceptId, platforms: manualPlatforms } = req.body;

        if (!videoId || !conceptId) {
            return res.status(400).json({ error: 'Missing videoId or conceptId in request body' });
        }

        console.log(`Received request to post video ${videoId} for concept ${conceptId}`);

        // 1. Google認証のセットアップ (サービスアカウントを使用)
        const serviceAuth = getServiceAccountAuth();
        const drive = google.drive({ version: 'v3', auth: serviceAuth });

        // 2. conceptIdから設定ファイル(config.json)を読み込む
        const fileRes = await drive.files.list({
            q: `'${conceptId}' in parents and name='config.json' and trashed=false`,
            fields: 'files(id)',
            pageSize: 1,
        });

        const configFile = fileRes.data.files?.[0];
        if (!configFile || !configFile.id) {
            throw new Error(`config.json not found for concept ${conceptId}`);
        }

        const contentRes = await drive.files.get({ fileId: configFile.id, alt: 'media' });
        const config = contentRes.data as any; // Using as any for simplicity

        // 3. videoIdを使ってGoogle Driveから動画ファイルをダウンロード
        // const videoFile = await downloadVideo(auth, videoId);
        console.log(`[Placeholder] Downloading video ${videoId}...`);
        const videoUrl = 'https://www.example.com/video.mp4'; // Placeholder

        // 4. Gemini APIを使って投稿内容を生成
        // const content = await generateContentWithGemini(config.name);
        console.log(`[Placeholder] Generating content for concept...`);
        const caption = "This is a great video!"; // Placeholder

        // 5. 各プラットフォームに投稿
        const platformsToPost = manualPlatforms || config.platforms;
        for (const platform of Object.keys(platformsToPost)) {
            if (platformsToPost[platform]) {
                console.log(`Posting to ${platform}...`);
                if (platform === 'TikTok') {
                    if (!config.apiKeys.tiktok) {
                        console.error('TikTok credentials not found in config.');
                        continue;
                    }
                    try {
                        const tiktokTokenInfo = JSON.parse(config.apiKeys.tiktok);
                        const accessToken = tiktokTokenInfo.access_token;
                        const openId = tiktokTokenInfo.open_id;
                        if (!accessToken || !openId) throw new Error('TikTok token data is incomplete.');
                        
                        await uploadVideoToTiktok({ accessToken, openId, videoUrl });

                    } catch (error) {
                        console.error(`Failed to post to TikTok:`, error);
                    }
                } else if (platform === 'Instagram') {
                    const selectedAccountId = config.apiKeys.instagram;
                    if (!selectedAccountId) {
                        console.error('No Instagram account selected for this concept.');
                        continue;
                    }
                    try {
                        // Fetch the global list of accounts
                        const accountsFileRes = await drive.files.list({
                            q: `name='instagram_accounts.json' and trashed=false`,
                            spaces: 'drive',
                            fields: 'files(id)',
                            pageSize: 1,
                        });
                        const accountsFile = accountsFileRes.data.files?.[0];
                        if (!accountsFile || !accountsFile.id) {
                            throw new Error('instagram_accounts.json not found.');
                        }
                        const accountsContentRes = await drive.files.get({ fileId: accountsFile.id, alt: 'media' });
                        const allIgAccounts = accountsContentRes.data as any[];

                        const accountToUse = allIgAccounts.find(acc => acc.id === selectedAccountId);
                        if (!accountToUse) {
                            throw new Error(`Selected Instagram account with ID ${selectedAccountId} not found in global list.`);
                        }

                        const accessToken = accountToUse.page_access_token;
                        const instagramAccountId = accountToUse.id;

                        await postVideoToInstagram({ accessToken, instagramAccountId, videoUrl, caption });

                    } catch (error) {
                        console.error(`Failed to post to Instagram:`, error);
                    }
                } else {
                    console.log(`[Placeholder] Posting to ${platform}...`);
                }
            }
        }

        // 6. Google Drive上で動画を "Posted" フォルダに移動
        // await moveVideoToPosted(auth, videoId, config.postedFolderId);
        console.log(`[Placeholder] Moving video to 'Posted' folder...`);


        // --- 処理完了 ---

        return res.status(200).json({ message: `Successfully started post process for video ${videoId}` });

    } catch (error: any) {
        console.error('Error in /api/post:', error);
        // Return a more descriptive error to the client
        res.status(500).json({ error: 'Internal Server Error', details: error.message });
    }
}
