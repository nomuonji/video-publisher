import type { VercelRequest, VercelResponse } from '@vercel/node';
import { uploadVideoToTiktok } from '../../services/tiktokService';

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

        // --- ここからが実際の投稿処理 ---

        // 1. Google認証のセットアップ (サービスアカウントを使用)
        // const auth = await getGoogleAuth();

        // 2. conceptIdから設定ファイル(config.json)を読み込む
        // const config = await getConceptConfig(auth, conceptId);
        // Placeholder for config
        const config = { 
            platforms: { YouTube: true, TikTok: true, Instagram: false }, 
            apiKeys: { tiktok: process.env.TIKTOK_ACCESS_TOKEN, youtube_refresh_token: '' }
        };

        // 3. videoIdを使ってGoogle Driveから動画ファイルをダウンロード
        // const videoFile = await downloadVideo(auth, videoId);
        console.log(`[Placeholder] Downloading video ${videoId}...`);

        // 4. Gemini APIを使って投稿内容を生成
        // const content = await generateContentWithGemini(config.name);
        console.log(`[Placeholder] Generating content for concept...`);

        // 5. 各プラットフォームに投稿
        const platformsToPost = manualPlatforms || config.platforms;
        for (const platform of Object.keys(platformsToPost)) {
            if (platformsToPost[platform]) {
                console.log(`Posting to ${platform}...`);
                if (platform === 'TikTok') {
                    // In a real app, you'd get these from a user-specific database record
                    const tiktokTokenInfo = JSON.parse(config.apiKeys.tiktok || '{}');
                    const accessToken = tiktokTokenInfo.access_token;
                    const openId = tiktokTokenInfo.open_id;

                    if (!accessToken || !openId) {
                        console.error('TikTok credentials not found in config.');
                        continue; // Skip to next platform
                    }

                    // This URL should point to the video file downloaded from Google Drive
                    const videoUrl = 'https://www.example.com/video.mp4'; // Placeholder

                    try {
                        const result = await uploadVideoToTiktok({ accessToken, openId, videoUrl });
                        console.log(`Successfully initiated TikTok upload. Publish ID: ${result.publish_id}`);
                    } catch (error) {
                        console.error(`Failed to post to TikTok:`, error);
                    }
                } else {
                    console.log(`[Placeholder] Posting to ${platform}...`);
                    // await postToPlatform(platform, videoFile, content);
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
        return res.status(500).json({ error: 'Internal Server Error', details: error.message });
    }
}
