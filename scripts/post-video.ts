import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
import fetch from 'node-fetch';
import type { ConceptConfig, TikTokTokens } from '../types'; // Assuming types.ts is accessible

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

// --- Google Drive Helper Functions (replicated from check-schedules.ts or similar) ---
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

// --- Helper function for formatting strings ---
function formatString(format: string, context: Record<string, string>): string {
  let result = format;
  for (const key in context) {
    result = result.replace(new RegExp(`{${key}}`, 'g'), context[key]);
  }
  return result;
}

// --- Helper function to refresh YouTube access token ---
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

// --- Helper function to refresh TikTok access token ---
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

// --- Helper function for listing videos in a folder ---
async function getVideosInFolder(drive: any, folderId: string): Promise<any[]> {
  const res = await drive.files.list({
    q: `'${folderId}' in parents and mimeType contains 'video/' and trashed=false`, // Assuming 'video/' covers all video types
    fields: 'files(id, name, createdTime, mimeType, webContentLink)', // webContentLink for downloading
  });
  return res.data.files || [];
}

// --- Main posting logic (reusable function) ---
export async function performVideoPosting(
  conceptId: string,
  serviceAccountJson: string,
  targetVideoId?: string, // Optional: for manual posting of a specific video
  targetPlatforms?: { YouTube?: boolean; TikTok?: boolean; boolean; Instagram?: boolean }, // Optional: for manual posting to specific platforms
  postDetailsOverride?: ConceptConfig['postDetails'] // Add this
) {
  console.log(`[performVideoPosting] Starting for concept: ${conceptId}`);

  const auth = getAuth(serviceAccountJson);
  await auth.authorize(); // Ensure token is fetched
  const drive = google.drive({ version: 'v3', auth });

  // 1. Get concept's config.json
  const configFile = await getFileByName(drive, conceptId, 'config.json');
  if (!configFile) {
    throw new Error(`config.json not found for concept ${conceptId}`);
  }
  const config: ConceptConfig = await getFileContent(drive, configFile.id!);
  console.log(`[performVideoPosting] Loaded config for ${config.name}`);

  // 2. Get global instagram_accounts.json (if Instagram is enabled)
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

  // 3. Find videos to post
  const queueFolder = await getFileByName(drive, conceptId, 'queue');
  if (!queueFolder) {
    throw new Error(`Queue folder not found for concept ${conceptId}`);
  }
  const videosInQueue = await getVideosInFolder(drive, queueFolder.id!); // Assuming getVideosInFolder is defined

  let videoToPost;
  if (targetVideoId) {
    videoToPost = videosInQueue.find((v: any) => v.id === targetVideoId);
    if (!videoToPost) {
      throw new Error(`Video with ID ${targetVideoId} not found in queue for concept ${conceptId}.`);
    }
  } else {
    // For scheduled posts, pick the oldest video in the queue
    videoToPost = videosInQueue.sort((a: any, b: any) => new Date(a.createdTime).getTime() - new Date(b.createdTime).getTime())[0];
  }

  if (!videoToPost) {
    console.log(`[performVideoPosting] No videos found in queue for concept ${config.name}.`);
    return;
  }
  console.log(`[performVideoPosting] Selected video to post: ${videoToPost.name} (ID: ${videoToPost.id})`);

  // Prepare context for formatting
  const formatContext = {
    video_name: videoToPost.name,
    concept_name: config.name,
    concept_name_tag: config.name.replace(/\s/g, ''), // For hashtags
    // TODO: Add other context variables as needed (e.g., youtube_link, description_from_drive, hashtags_from_drive)
  };

  // Determine effective post details (override if present, else concept default)
  const effectivePostDetails = videoToPost.postDetailsOverride || config.postDetails;

  // Generate title, description, hashtags
  const title = effectivePostDetails.title;
  const description = effectivePostDetails.description;
  const hashtags = effectivePostDetails.hashtags;
  const aiLabel = effectivePostDetails.aiLabel; // Get AI label

  console.log(`[performVideoPosting] Generated Title: ${title}`);
  console.log(`[performVideoPosting] Generated Description: ${description}`);
  console.log(`[performVideoPosting] Generated Hashtags: ${hashtags}`);
  console.log(`[performVideoPosting] AI Label: ${aiLabel}`);

  // 4. Authenticate with platforms and post
  const platformsToPost = targetPlatforms || config.platforms;

  if (platformsToPost.YouTube && config.apiKeys.youtube_refresh_token) {
    console.log(`[performVideoPosting] Posting to YouTube...`);
    try {
      const youtubeAccessToken = await refreshYouTubeAccessToken(config.apiKeys.youtube_refresh_token);
      const youtubeOAuth2Client = new google.auth.OAuth2();
      youtubeOAuth2Client.setCredentials({ access_token: youtubeAccessToken });
      const youtube = google.youtube({ version: 'v3', auth: youtubeOAuth2Client });

      // Download video file from Drive
      const videoFile = await drive.files.get({ fileId: videoToPost.id, alt: 'media' }, { responseType: 'stream' });

      await youtube.videos.insert({
        part: ['snippet', 'status'],
        requestBody: {
          snippet: {
            title: title,
            description: description,
            tags: hashtags.split(' ').filter(tag => tag.startsWith('#')).map(tag => tag.substring(1)), // Assuming hashtags are space-separated and start with #
            // categoryId: '22', // People & Blogs, or get from config
          },
          status: {
            privacyStatus: 'private', // or 'public', 'unlisted', get from config
          },
        },
        media: {
          mimeType: videoToPost.mimeType,
          body: videoFile.data,
        },
      });
      console.log(`[performVideoPosting] Video posted to YouTube: ${title}`);
    } catch (error) {
      console.error(`[performVideoPosting] Failed to post to YouTube:`, error);
    }
  }
  if (platformsToPost.TikTok && config.apiKeys.tiktok) {
    console.log(`[performVideoPosting] Posting to TikTok...`);
    try {
      let currentTikTokTokens = config.apiKeys.tiktok;
      // Check if token is expired (simple check, could be more robust)
      // TikTok access tokens are valid for 24 hours, refresh tokens for 365 days.
      // We'll refresh if access token is near expiration (e.g., less than 1 hour remaining).
      if (currentTikTokTokens.expires_in < 3600) { 
        console.log('[performVideoPosting] Refreshing TikTok access token...');
        const oldTikTokTokens = currentTikTokTokens; // Keep old tokens for comparison
        currentTikTokTokens = await refreshTikTokAccessToken(currentTikTokTokens);
        
        // Save updated tiktokTokens back to config.json
        if (JSON.stringify(oldTikTokTokens) !== JSON.stringify(currentTikTokTokens)) { // Only update if tokens actually changed
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

      // Download video file from Drive
      const videoFile = await drive.files.get({ fileId: videoToPost.id, alt: 'media' }, { responseType: 'arraybuffer' }); // TikTok needs ArrayBuffer

      // 1. Upload video to TikTok
      const uploadEndpoint = 'https://open.tiktokapis.com/v2/post/publish/video/init/';
      const uploadInitResponse = await fetch(uploadEndpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${currentTikTokTokens.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          post_info: {
            title: title,
            description: description + (hashtags ? `\n\n${hashtags}` : ''), // Append hashtags to description
            visibility_type: 'SELF_ONLY', // or 'PUBLIC', 'FRIENDS_ONLY', get from config
            // brand_content_toggle: false,
            ai_generated_content: aiLabel, // Add AI label
          },
          source_info: {
            source: 'PULL_FROM_URL', // Or 'UPLOAD_LOCAL_FILE'
            video_size: videoFile.data.byteLength,
            // video_url: videoToPost.webContentLink, // If using PULL_FROM_URL
          },
        }),
      });
      const uploadInitData = await uploadInitResponse.json();
      if (!uploadInitResponse.ok) {
        throw new Error(`TikTok upload init failed: ${uploadInitData.error?.message || 'Unknown error'}`);
      }

      const uploadUrl = uploadInitData.data.upload_url;
      const publishId = uploadInitData.data.publish_id;

      // 2. Upload video content
      const uploadContentResponse = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Range': `bytes 0-${videoFile.data.byteLength - 1}/${videoFile.data.byteLength}`,
          'Content-Type': videoToPost.mimeType,
        },
        body: videoFile.data, // ArrayBuffer
      });
      if (!uploadContentResponse.ok) {
        throw new Error(`TikTok video content upload failed: ${uploadContentResponse.statusText}`);
      }

      // 3. Publish video
      const publishEndpoint = 'https://open.tiktokapis.com/v2/post/publish/video/status/post/';
      const publishResponse = await fetch(publishEndpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${currentTikTokTokens.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          publish_id: publishId,
          // post_info: { title: title, description: description }, // Can update metadata here
        }),
      });
      const publishData = await publishResponse.json();
      if (!publishResponse.ok) {
        throw new Error(`TikTok video publish failed: ${publishData.error?.message || 'Unknown error'}`);
      }

      console.log(`[performVideoPosting] Video posted to TikTok: ${title}`);
    } catch (error) {
      console.error(`[performVideoPosting] Failed to post to TikTok:`, error);
    }
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

      // Download video file from Drive
      // Note: Instagram Graph API requires a publicly accessible URL for video_url.
      // webContentLink from Google Drive is usually not publicly accessible without authentication.
      // A more robust solution would involve: 
      // 1. Downloading the video to a temporary location on the server.
      // 2. Uploading it to a temporary public storage (e.g., Cloud Storage, S3) or using a signed URL.
      // 3. Providing that public URL to Instagram.
      // For now, we'll assume webContentLink might work in some contexts or needs further handling.
      // If webContentLink doesn't work, the error will be from Instagram API.

      // For now, we'll use webContentLink directly. If it fails, we'll need to implement a download/re-upload strategy.
      const videoUrl = videoToPost.webContentLink; 

      // 1. Upload video to Instagram (create media container)
      const uploadEndpoint = `https://graph.facebook.com/v19.0/${instagramUserId}/media`;
      const uploadResponse = await fetch(uploadEndpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${instagramPageAccessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          media_type: 'VIDEO',
          video_url: videoUrl, // Use webContentLink for direct upload from Drive
          caption: `${title}\n${description}\n${hashtags}`,
          is_ai_generated: aiLabel, // Add AI label
        }),
      });
      const uploadData = await uploadResponse.json();
      if (!uploadResponse.ok) {
        throw new Error(`Instagram media upload failed: ${uploadData.error?.message || 'Unknown error'}`);
      }

      const mediaContainerId = uploadData.id;

      // 2. Check media container status (wait for processing)
      let statusEndpoint = `https://graph.facebook.com/v19.0/${mediaContainerId}?fields=status,status_code&access_token=${instagramPageAccessToken}`;
      let mediaStatus: any;
      let attempts = 0;
      const maxAttempts = 10;
      const delayMs = 5000; // 5 seconds

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

      // 3. Publish video
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

  // 5. Move video to 'posted' folder
  const postedFolder = await getFileByName(drive, conceptId, 'posted');
  if (!postedFolder) {
    throw new Error(`Posted folder not found for concept ${conceptId}`);
  }
  await drive.files.update({
    fileId: videoToPost.id,
    addParents: postedFolder.id,
    removeParents: queueFolder.id,
    fields: 'id, parents',
  });
  console.log(`[performVideoPosting] Video ${videoToPost.name} moved to 'posted' folder.`);
}

// --- Script entry point (for scheduled runs) ---
if (require.main === module) {
  const conceptId = process.env.CONCEPT_ID;
  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

  if (!conceptId) {
    console.error('Error: CONCEPT_ID environment variable is not set.');
    process.exit(1);
  }
  if (!serviceAccountJson) {
    console.error('Error: GOOGLE_SERVICE_ACCOUNT_JSON environment variable is not set.');
    process.exit(1);
  }

  performVideoPosting(conceptId, serviceAccountJson).catch(error => {
    console.error(`Error processing concept ${conceptId}:`, error);
    process.exit(1);
  });
}