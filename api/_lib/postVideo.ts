
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
import fetch from 'node-fetch';
import type { ConceptConfig, TikTokTokens } from '../../types';
import { withNormalizedPostingTimes } from '../../utils/schedule';

// --- Authentication ---
function getAuth(serviceAccountJson: string) {
  const serviceAccountKey = JSON.parse(serviceAccountJson);
  return new JWT({
    email: serviceAccountKey.client_email,
    key: serviceAccountKey.private_key,
    scopes: [
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/youtube.upload', // For YouTube uploads
      'https://www.googleapis.com/auth/youtube', // For YouTube data
    ],
  });
}

// --- Google Drive Helper Functions ---
async function getFolderIdByName(drive: any, name: string): Promise<string | null> {
  const res = await drive.files.list({
    q: `mimeType='application/vnd.google-apps.folder' and name='${name}' and trashed=false`,
    fields: 'files(id)',
    pageSize: 1,
  });
  return res.data.files?.[0]?.id || null;
}

async function getFileByName(drive: any, parentId: string, name: string): Promise<any | null> {
  const res = await drive.files.list({
    q: `'${parentId}' in parents and name='${name}' and trashed=false`,
    fields: 'files(id)',
    pageSize: 1,
  });
  return res.data.files?.[0] || null;
}

async function getFileContent(drive: any, fileId: string): Promise<any> {
  const res = await drive.files.get({ fileId: fileId, alt: 'media' });
  return res.data;
}

// --- Helpers ---
async function refreshYouTubeAccessToken(refreshToken: string): Promise<string> {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  );
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  const { credentials } = await oauth2Client.refreshAccessToken();
  if (!credentials.access_token) {
    throw new Error('Failed to refresh YouTube access token.');
  }
  return credentials.access_token;
}

async function refreshTikTokAccessToken(tiktokTokens: TikTokTokens): Promise<TikTokTokens> {
  const tokenEndpoint = 'https://open.tiktokapis.com/v2/oauth/token/';
  const params = new URLSearchParams();
  params.append('client_key', process.env.TIKTOK_CLIENT_KEY!);
  params.append('client_secret', process.env.TIKTOK_CLIENT_SECRET!);
  params.append('grant_type', 'refresh_token');
  params.append('refresh_token', tiktokTokens.refresh_token);

  const response = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  const newTokens = await response.json();
  if (!response.ok) {
    throw new Error(`Failed to refresh TikTok access token: ${newTokens.error_description || 'Unknown error'}`);
  }
  return newTokens as TikTokTokens;
}

async function getVideosInFolder(drive: any, folderId: string): Promise<any[]> {
  const res = await drive.files.list({
    q: `'${folderId}' in parents and mimeType contains 'video/' and trashed=false`,
    fields: 'files(id, name, createdTime, mimeType, webContentLink, properties)',
  });
  return res.data.files || [];
}

const AI_LABEL_MESSAGE = 'This video includes altered or synthetic content.';

function applyAiLabelToDescription(description: string, aiLabel: boolean): string {
  if (!aiLabel) return description;
  if (description.includes(AI_LABEL_MESSAGE)) return description;
  return `${description.trim()}\n\n${AI_LABEL_MESSAGE}`;
}

export interface PerformVideoPostingOptions {
  conceptId: string;
  serviceAccountJson: string;
  targetVideoId?: string;
  targetPlatforms?: { YouTube?: boolean; TikTok?: boolean; Instagram?: boolean };
  postDetailsOverride?: ConceptConfig['postDetails'];
}

export async function performVideoPosting({
  conceptId,
  serviceAccountJson,
  targetVideoId,
  targetPlatforms,
  postDetailsOverride,
}: PerformVideoPostingOptions): Promise<void> {
  console.log(`[performVideoPosting] Starting for concept: ${conceptId}`);

  const auth = getAuth(serviceAccountJson);
  await auth.authorize();
  const drive = google.drive({ version: 'v3', auth });

  const configFile = await getFileByName(drive, conceptId, 'config.json');
  if (!configFile) {
    throw new Error(`config.json not found for concept ${conceptId}`);
  }
  const rawConfig: ConceptConfig = await getFileContent(drive, configFile.id!);
  const config = withNormalizedPostingTimes(rawConfig);
  console.log(`[performVideoPosting] Loaded config for ${config.name}`);

  // Instagram accounts
  let instagramAccounts: any[] = [];
  if (config.platforms.Instagram || (targetPlatforms && targetPlatforms.Instagram)) {
    const vStockFolderId = await getFolderIdByName(drive, 'v-stock');
    if (!vStockFolderId) {
      throw new Error("'v-stock' folder not found for Instagram accounts.");
    }
    const instagramAccountsFile = await getFileByName(drive, vStockFolderId, 'instagram_accounts.json');
    if (instagramAccountsFile) {
      instagramAccounts = await getFileContent(drive, instagramAccountsFile.id!);
      console.log(`[performVideoPosting] Loaded ${instagramAccounts.length} Instagram accounts.`);
    } else {
      console.warn("[performVideoPosting] instagram_accounts.json not found, Instagram posting might fail.");
    }
  }

  const queueFolder = await getFileByName(drive, conceptId, 'queue');
  if (!queueFolder) {
    throw new Error(`Queue folder not found for concept ${conceptId}`);
  }
  const postedFolder = await getFileByName(drive, conceptId, 'posted');
  if (!postedFolder) {
    throw new Error(`Posted folder not found for concept ${conceptId}`);
  }

  const videosInQueue = await getVideosInFolder(drive, queueFolder.id!);

  let videoToPost;
  let videoSourceFolderId = queueFolder.id!;
  if (targetVideoId) {
    videoToPost = videosInQueue.find((v: any) => v.id === targetVideoId);
    if (!videoToPost) {
      const videosInPosted = await getVideosInFolder(drive, postedFolder.id!);
      videoToPost = videosInPosted.find((v: any) => v.id === targetVideoId);
      if (!videoToPost) {
        throw new Error(`Video with ID ${targetVideoId} not found in queue or posted folder for concept ${conceptId}.`);
      }
      videoSourceFolderId = postedFolder.id!;
    }
  } else {
    videoToPost = videosInQueue.sort((a: any, b: any) => new Date(a.createdTime).getTime() - new Date(b.createdTime).getTime())[0];
  }

  if (!videoToPost) {
    console.log(`[performVideoPosting] No videos found in queue for concept ${config.name}.`);
    return;
  }
  const originLabel = videoSourceFolderId === queueFolder.id ? 'queue' : 'posted';
  const videoMimeType = videoToPost.mimeType || 'video/mp4';
  console.log(`[performVideoPosting] Selected video to post: ${videoToPost.name} (ID: ${videoToPost.id}) from ${originLabel} folder.`);

  const effectivePostDetails = {
    ...config.postDetails,
    ...(videoToPost.postDetailsOverride ?? {}),
    ...(postDetailsOverride ?? {}),
  };

  const title = effectivePostDetails.title;
  const description = applyAiLabelToDescription(effectivePostDetails.description, effectivePostDetails.aiLabel);
  const hashtags = effectivePostDetails.hashtags;
  const aiLabel = effectivePostDetails.aiLabel;

  console.log(`[performVideoPosting] Generated Title: ${title}`);
  console.log(`[performVideoPosting] Generated Description: ${description}`);
  console.log(`[performVideoPosting] Generated Hashtags: ${hashtags}`);
  console.log(`[performVideoPosting] AI Label: ${aiLabel}`);

  const platformsToPost = targetPlatforms || config.platforms;

  if (platformsToPost.YouTube && config.apiKeys.youtube_refresh_token) {
    console.log(`[performVideoPosting] Posting to YouTube...`);
    try {
      const youtubeAccessToken = await refreshYouTubeAccessToken(config.apiKeys.youtube_refresh_token);
      const youtubeOAuth2Client = new google.auth.OAuth2();
      youtubeOAuth2Client.setCredentials({ access_token: youtubeAccessToken });
      const youtube = google.youtube({ version: 'v3', auth: youtubeOAuth2Client });

      const videoFileResponse = await drive.files.get({ fileId: videoToPost.id, alt: 'media' }, { responseType: 'stream' });
      const videoStream = videoFileResponse.data as any;

      await youtube.videos.insert({
        part: ['snippet', 'status'],
        requestBody: {
          snippet: {
            title,
            description,
            tags: hashtags
              .split(' ')
              .filter((tag: string) => tag.startsWith('#'))
              .map((tag: string) => tag.substring(1)),
          },
          status: {
            privacyStatus: 'private',
            madeForKids: false,
            selfDeclaredMadeForKids: false,
            // The YouTube Data API may introduce an explicit AI-generated flag in future versions.
            ...(aiLabel ? ({ aiGeneratedContent: true } as Record<string, unknown>) : {}),
          } as any,
        },
        media: {
          mimeType: videoMimeType,
          body: videoStream,
        },
      });
      console.log(`[performVideoPosting] Video posted to YouTube: ${title}`);
    } catch (error) {
      console.error(`[performVideoPosting] Failed to post to YouTube:`, error);
    }
  }

  const tiktokTokensConfig = config.apiKeys.tiktok;
  if (platformsToPost.TikTok && tiktokTokensConfig && tiktokTokensConfig.refresh_token) {
    console.log(`[performVideoPosting] Posting to TikTok...`);
    try {
      let currentTikTokTokens: TikTokTokens = { ...tiktokTokensConfig };
      if (typeof currentTikTokTokens.expires_in === 'number' && currentTikTokTokens.expires_in < 3600) {
        console.log('[performVideoPosting] Refreshing TikTok access token...');
        const oldTikTokTokens = currentTikTokTokens;
        const refreshedTokens = await refreshTikTokAccessToken(currentTikTokTokens);
        currentTikTokTokens = { ...currentTikTokTokens, ...refreshedTokens };

        if (JSON.stringify(oldTikTokTokens) !== JSON.stringify(currentTikTokTokens)) {
          const updatedConfig = { ...config, apiKeys: { ...config.apiKeys, tiktok: currentTikTokTokens } };
          const configContent = JSON.stringify(updatedConfig, null, 2);
          await drive.files.update({
            fileId: configFile.id!,
            media: {
              mimeType: 'application/json',
              body: configContent,
            },
          });
          console.log('[performVideoPosting] Updated TikTok tokens saved to config.json.');
        }
      }

      const videoFileResponse = await drive.files.get({ fileId: videoToPost.id, alt: 'media' }, { responseType: 'arraybuffer' });
      const videoBuffer = videoFileResponse.data as ArrayBuffer;
      const videoByteLength = videoBuffer.byteLength;
      const videoBody = Buffer.from(videoBuffer);

      const uploadEndpoint = 'https://open.tiktokapis.com/v2/post/publish/video/init/';
      const uploadInitResponse = await fetch(uploadEndpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${currentTikTokTokens.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          post_info: {
            title,
            description: description + (hashtags ? `\n\n${hashtags}` : ''),
            visibility_type: 'SELF_ONLY',
            ai_generated_content: aiLabel,
          },
          source_info: {
            source: 'PULL_FROM_URL',
            video_size: videoByteLength,
          },
        }),
      });
      const uploadInitData = await uploadInitResponse.json();
      if (!uploadInitResponse.ok) {
        throw new Error(`TikTok upload init failed: ${uploadInitData.error?.message || 'Unknown error'}`);
      }

      const uploadUrl = uploadInitData.data.upload_url;
      const publishId = uploadInitData.data.publish_id;

      const uploadContentResponse = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Range': `bytes 0-${videoByteLength - 1}/${videoByteLength}`,
          'Content-Type': videoMimeType,
        },
        body: videoBody,
      });
      if (!uploadContentResponse.ok) {
        throw new Error(`TikTok video content upload failed: ${uploadContentResponse.statusText}`);
      }

      const publishEndpoint = 'https://open.tiktokapis.com/v2/post/publish/video/status/post/';
      const publishResponse = await fetch(publishEndpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${currentTikTokTokens.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          publish_id: publishId,
        }),
      });
      const publishData = await publishResponse.json();
      if (!publishResponse.ok) {
        throw new Error(`TikTok video publish failed: ${publishData.error?.message || 'Unknown error'}`);
      }

      console
      console.log(`[performVideoPosting] Video posted to TikTok: ${title}`);
    } catch (error) {
      console.error(`[performVideoPosting] Failed to post to TikTok:`, error);
    }
  } else if (platformsToPost.TikTok) {
    console.warn('[performVideoPosting] Skipping TikTok posting: no connected TikTok account.');
  }

  if (platformsToPost.Instagram && config.apiKeys.instagram && instagramAccounts.length > 0) {
    console.log(`[performVideoPosting] Posting to Instagram...`);
    try {
      const targetInstagramAccount = instagramAccounts.find(acc => acc.id === config.apiKeys.instagram);
      if (!targetInstagramAccount) {
        console.error(`[performVideoPosting] Target Instagram account ${config.apiKeys.instagram} not found in loaded accounts.`);
        return;
      }
      const instagramPageAccessToken = targetInstagramAccount.page_access_token;
      const instagramUserId = targetInstagramAccount.id;

      const videoUrl = videoToPost.webContentLink;

      const uploadEndpoint = `https://graph.facebook.com/v19.0/${instagramUserId}/media`;
      const uploadResponse = await fetch(uploadEndpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${instagramPageAccessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          media_type: 'VIDEO',
          video_url: videoUrl,
          caption: `${title}\n${description}\n${hashtags}`,
          is_ai_generated: aiLabel,
        }),
      });
      const uploadData = await uploadResponse.json();
      if (!uploadResponse.ok) {
        throw new Error(`Instagram media upload failed: ${uploadData.error?.message || 'Unknown error'}`);
      }

      const mediaContainerId = uploadData.id;

      let statusEndpoint = `https://graph.facebook.com/v19.0/${mediaContainerId}?fields=status,status_code&access_token=${instagramPageAccessToken}`;
      let mediaStatus: any;
      let attempts = 0;
      const maxAttempts = 10;
      const delayMs = 5000;

      do {
        await new Promise(resolve => setTimeout(resolve, delayMs));
        const statusResponse = await fetch(statusEndpoint);
        mediaStatus = await statusResponse.json();
        console.log(`[performVideoPosting] Instagram media container status: ${mediaStatus.status_code}`);
        attempts++;
      } while (mediaStatus.status_code !== 'FINISHED' && attempts < maxAttempts);

      if (mediaStatus.status_code !== 'FINISHED') {
        throw new Error(`Instagram media container processing timed out or failed: ${mediaStatus.status_code}`);
      }

      const publishEndpoint = `https://graph.facebook.com/v19.0/${instagramUserId}/media_publish`;
      const publishResponse = await fetch(publishEndpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${instagramPageAccessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          creation_id: mediaContainerId,
        }),
      });
      const publishData = await publishResponse.json();
      if (!publishResponse.ok) {
        throw new Error(`Instagram media publish failed: ${publishData.error?.message || 'Unknown error'}`);
      }

      console.log(`[performVideoPosting] Video posted to Instagram: ${title}`);
    } catch (error) {
      console.error(`[performVideoPosting] Failed to post to Instagram:`, error);
    }
  }

  if (videoSourceFolderId === queueFolder.id) {
    await drive.files.update({
      fileId: videoToPost.id,
      addParents: postedFolder.id,
      removeParents: queueFolder.id,
      fields: 'id, parents',
    });
    console.log(`[performVideoPosting] Video ${videoToPost.name} moved to 'posted' folder.`);
  } else {
    console.log(`[performVideoPosting] Video ${videoToPost.name} is already in 'posted' folder; skipping move.`);
  }
}
