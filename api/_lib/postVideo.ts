
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
import fetch from 'node-fetch';
import type { ConceptConfig, TikTokTokens, PostResult } from '../../types.js';
import { withNormalizedPostingTimes } from '../../utils/schedule.js';
import { postVideoToInstagram } from '../../services/instagramService.js';
import { infoLog, debugLog, errorLog } from '../../utils/logger.js';

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
}: PerformVideoPostingOptions): Promise<PostResult> {
  infoLog(`[performVideoPosting] Starting for concept: ${conceptId}`);
  const results: PostResult = {};

  const auth = getAuth(serviceAccountJson);
  await auth.authorize();
  const drive = google.drive({ version: 'v3', auth });

  const configFile = await getFileByName(drive, conceptId, 'config.json');
  if (!configFile) {
    throw new Error(`config.json not found for concept ${conceptId}`);
  }
  const rawConfig: ConceptConfig = await getFileContent(drive, configFile.id!);
  const config = withNormalizedPostingTimes(rawConfig);
  infoLog(`[performVideoPosting] Loaded config for ${config.name}`);

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
      debugLog(`[performVideoPosting] Loaded ${instagramAccounts.length} Instagram accounts.`);
    } else {
      infoLog("[performVideoPosting] instagram_accounts.json not found, Instagram posting might fail.");
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
    videoToPost = videosInQueue[Math.floor(Math.random() * videosInQueue.length)];
  }

  if (!videoToPost) {
    infoLog(`[performVideoPosting] No videos found in queue for concept ${config.name}.`);
    return {}; // No video to post, return empty result
  }
  const originLabel = videoSourceFolderId === queueFolder.id ? 'queue' : 'posted';
  const videoMimeType = videoToPost.mimeType || 'video/mp4';
  infoLog(`[performVideoPosting] Selected video to post: ${videoToPost.name} (ID: ${videoToPost.id}) from ${originLabel} folder.`);

  const effectivePostDetails = {
    ...config.postDetails,
    ...(videoToPost.postDetailsOverride ?? {}),
    ...(postDetailsOverride ?? {}),
  };

  const title = effectivePostDetails.title;
  const description = applyAiLabelToDescription(effectivePostDetails.description, effectivePostDetails.aiLabel);
  const hashtags = effectivePostDetails.hashtags;
  const aiLabel = effectivePostDetails.aiLabel;

  debugLog(`[performVideoPosting] Generated Title: ${title}`);
  debugLog(`[performVideoPosting] Generated Description: ${description}`);
  debugLog(`[performVideoPosting] Generated Hashtags: ${hashtags}`);
  debugLog(`[performVideoPosting] AI Label: ${aiLabel}`);

  const platformsToPost = targetPlatforms || config.platforms;

  // --- YouTube Posting ---
  if (platformsToPost.YouTube && config.apiKeys.youtube_refresh_token) {
    infoLog(`[performVideoPosting] Posting to YouTube...`);
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
            description: `${description}\n\n${hashtags}`,
            tags: hashtags
              .split(' ')
              .filter((tag: string) => tag.startsWith('#'))
              .map((tag: string) => tag.substring(1)),
          },
          status: {
            privacyStatus: 'public',
            madeForKids: false,
            selfDeclaredMadeForKids: false,
            ...(aiLabel ? ({ aiGeneratedContent: true } as Record<string, unknown>) : {}),
          } as any,
        },
        media: {
          mimeType: videoMimeType,
          body: videoStream,
        },
      });
      infoLog(`[performVideoPosting] Video posted to YouTube: ${title}`);
      results.YouTube = { success: true, message: `Successfully posted to YouTube: ${title}` };
    } catch (error: any) {
      errorLog(`[performVideoPosting] Failed to post to YouTube:`, error);
      results.YouTube = { success: false, message: 'Failed to post to YouTube.', error: error.message };
    }
  }

  // --- TikTok Posting ---
  const tiktokTokensConfig = config.apiKeys.tiktok;
  if (platformsToPost.TikTok && tiktokTokensConfig && tiktokTokensConfig.refresh_token) {
    infoLog(`[performVideoPosting] Posting to TikTok...`);
    try {
      let currentTikTokTokens: TikTokTokens = { ...tiktokTokensConfig };
      if (typeof currentTikTokTokens.expires_in === 'number' && currentTikTokTokens.expires_in < 3600) {
        debugLog('[performVideoPosting] Refreshing TikTok access token...');
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
          debugLog('[performVideoPosting] Updated TikTok tokens saved to config.json.');
        }
      }

      const videoFileResponse = await drive.files.get({ fileId: videoToPost.id, alt: 'media' }, { responseType: 'arraybuffer' });
      const videoBuffer = videoFileResponse.data as ArrayBuffer;
      const videoByteLength = videoBuffer.byteLength;
      const videoBody = Buffer.from(videoBuffer);

      let chunkSize = 20 * 1024 * 1024; // 20MB
      const totalChunkCount = Math.ceil(videoByteLength / chunkSize);
      if (totalChunkCount === 1) {
        chunkSize = videoByteLength;
      }

      const uploadEndpoint = 'https://open.tiktokapis.com/v2/post/publish/video/init/';
      const uploadInitBody = {
        post_info: {
          privacy_level: 'SELF_ONLY',
        },
        source_info: {
          source: 'FILE_UPLOAD',
          video_size: videoByteLength,
          chunk_size: chunkSize,
          total_chunk_count: totalChunkCount,
        },
      };
      const uploadInitHeaders = {
        'Authorization': `Bearer ${currentTikTokTokens.access_token}`,
        'Content-Type': 'application/json',
      };

      debugLog('[performVideoPosting] TikTok Upload Init Request:');
      debugLog('- Endpoint:', uploadEndpoint);
      debugLog('- Headers:', JSON.stringify(uploadInitHeaders, null, 2));
      debugLog('- Body:', JSON.stringify(uploadInitBody, null, 2));

      const uploadInitResponse = await fetch(uploadEndpoint, {
        method: 'POST',
        headers: uploadInitHeaders,
        body: JSON.stringify(uploadInitBody),
      });
      const uploadInitData = await uploadInitResponse.json();

      debugLog('[performVideoPosting] TikTok Upload Init Response:');
      debugLog('- Status:', uploadInitResponse.status);
      debugLog('- Body:', JSON.stringify(uploadInitData, null, 2));

      if (!uploadInitResponse.ok) {
        throw new Error(`TikTok upload init failed: ${uploadInitData.error?.message || 'Unknown error'}`);
      }

      const uploadUrl = uploadInitData.data.upload_url;
      const publishId = uploadInitData.data.publish_id;

      const uploadContentHeaders = {
        'Content-Range': `bytes 0-${videoByteLength - 1}/${videoByteLength}`,
        'Content-Type': videoMimeType,
      };

      debugLog('[performVideoPosting] TikTok Upload Content Request:');
      debugLog('- URL:', uploadUrl);
      debugLog('- Headers:', JSON.stringify(uploadContentHeaders, null, 2));

      const uploadContentResponse = await fetch(uploadUrl, {
        method: 'PUT',
        headers: uploadContentHeaders,
        body: videoBody,
      });

      debugLog('[performVideoPosting] TikTok Upload Content Response:');
      debugLog('- Status:', uploadContentResponse.status);
      debugLog('- Status Text:', uploadContentResponse.statusText);


      if (!uploadContentResponse.ok) {
        throw new Error(`TikTok video content upload failed: ${uploadContentResponse.statusText}`);
      }

      const publishEndpoint = 'https://open.tiktokapis.com/v2/post/publish/video/status/post/';
      const publishBody = {
        publish_id: publishId,
      };
      const publishHeaders = {
        'Authorization': `Bearer ${currentTikTokTokens.access_token}`,
        'Content-Type': 'application/json',
      };

      debugLog('[performVideoPosting] TikTok Publish Request:');
      debugLog('- Endpoint:', publishEndpoint);
      debugLog('- Headers:', JSON.stringify(publishHeaders, null, 2));
      debugLog('- Body:', JSON.stringify(publishBody, null, 2));

      const publishResponse = await fetch(publishEndpoint, {
        method: 'POST',
        headers: publishHeaders,
        body: JSON.stringify(publishBody),
      });
      const publishData = await publishResponse.json();

      debugLog('[performVideoPosting] TikTok Publish Response:');
      debugLog('- Status:', publishResponse.status);
      debugLog('- Body:', JSON.stringify(publishData, null, 2));

      if (!publishResponse.ok) {
        throw new Error(`TikTok video publish failed: ${publishData.error?.message || 'Unknown error'}`);
      }

      infoLog(`[performVideoPosting] Video posted to TikTok: ${title}`);
      results.TikTok = { success: true, message: `Successfully posted to TikTok: ${title}` };
    } catch (error: any) {
      errorLog(`[performVideoPosting] Failed to post to TikTok:`, error);
      results.TikTok = { success: false, message: 'Failed to post to TikTok.', error: error.message };
    }
  } else if (platformsToPost.TikTok) {
    infoLog('[performVideoPosting] Skipping TikTok posting: no connected TikTok account.');
    results.TikTok = { success: false, message: 'Skipping TikTok posting: no connected TikTok account.' };
  }

  // --- Instagram Posting ---
  if (platformsToPost.Instagram && config.apiKeys.instagram && instagramAccounts.length > 0) {
    infoLog(`[performVideoPosting] Posting to Instagram...`);
    try {
      const targetInstagramAccount = instagramAccounts.find(acc => acc.id === config.apiKeys.instagram);
      if (!targetInstagramAccount) {
        throw new Error(`Target Instagram account ${config.apiKeys.instagram} not found in loaded accounts.`);
      }
      const instagramPageAccessToken = targetInstagramAccount.page_access_token;
      const instagramUserId = targetInstagramAccount.id;

      const fields = 'name,thumbnailLink,videoMediaMetadata';
      const [videoFileResponse, videoMetaResponse] = await Promise.all([
        drive.files.get({ fileId: videoToPost.id, alt: 'media' }, { responseType: 'arraybuffer' }),
        drive.files.get({ fileId: videoToPost.id, fields }),
      ]);
      const videoBuffer = Buffer.from(videoFileResponse.data as ArrayBuffer);
      if (!videoBuffer.length) {
        throw new Error('Downloaded video buffer is empty. Check Google Drive file accessibility.');
      }
      const meta = videoMetaResponse.data as { name?: string; thumbnailLink?: string; videoMediaMetadata?: { width?: number; height?: number; durationMillis?: number; } };
      const captionParts = [title, description, hashtags]
        .map(part => (part ?? "").trim())
        .filter(Boolean);
      const caption = captionParts.join("\n\n");

      const publishResult = await postVideoToInstagram({
        accessToken: instagramPageAccessToken,
        instagramAccountId: instagramUserId,
        videoBuffer,
        caption,
        isAiGenerated: aiLabel ?? undefined,
        videoName: meta.name ?? videoToPost.name,
        videoId: videoToPost.id,
        coverUrl: meta.thumbnailLink ?? undefined,
        videoWidth: meta.videoMediaMetadata?.width ?? undefined,
        videoHeight: meta.videoMediaMetadata?.height ?? undefined,
        videoDurationSeconds: typeof meta.videoMediaMetadata?.durationMillis === 'number'
          ? meta.videoMediaMetadata.durationMillis / 1000
          : undefined,
      });

      infoLog(`[performVideoPosting] Video posted to Instagram: ${title}`, publishResult);
      results.Instagram = { success: true, message: `Successfully posted to Instagram: ${title}` };
    } catch (error: any) {
      errorLog(
        `[performVideoPosting] Failed to post to Instagram: ${error?.message ?? error}`,
      );
      if (error?.stack) {
        errorLog(error.stack);
      }
      results.Instagram = { success: false, message: 'Failed to post to Instagram.', error: error.message };
    }
  }

  const wasAnyPostSuccessful = Object.values(results).some(result => result.success);

  // --- Move video to 'posted' folder ---
  if (wasAnyPostSuccessful && videoSourceFolderId === queueFolder.id) {
    await drive.files.update({
      fileId: videoToPost.id,
      addParents: postedFolder.id,
      removeParents: queueFolder.id,
      fields: 'id, parents',
    });
    infoLog(`[performVideoPosting] Video ${videoToPost.name} moved to 'posted' folder because it was successfully posted to at least one platform.`);
  } else if (videoSourceFolderId === queueFolder.id) {
    infoLog(`[performVideoPosting] Video ${videoToPost.name} was not posted to any platform. Keeping it in the 'queue' folder.`);
  } else {
    infoLog(`[performVideoPosting] Video ${videoToPost.name} is already in 'posted' folder; skipping move.`);
  }

  return results;
}
