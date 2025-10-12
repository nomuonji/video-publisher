import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import process from 'process';
import fetch from 'node-fetch';
import { google } from 'googleapis';
import { postVideoToInstagram } from '../services/instagramService.js';

interface RealTestConfig {
  accessToken: string;
  instagramUserId: string;
  videoBuffer: Buffer;
  caption: string;
  isAiGenerated?: boolean;
  videoName?: string;
  videoId?: string;
  coverUrl?: string;
  videoWidth?: number;
  videoHeight?: number;
  videoDurationSeconds?: number;
}

function resolveCaption(): string {
  const direct = process.env.IG_CAPTION;
  if (direct) {
    return direct;
  }
  const file = process.env.IG_CAPTION_FILE;
  if (file) {
    return fs.readFileSync(path.resolve(file), 'utf-8');
  }
  console.warn('[real-test] Caption not provided. Using empty string.');
  return '';
}

async function downloadFromGoogleDrive(fileId: string): Promise<{ buffer: Buffer; name?: string; thumbnailLink?: string; width?: number; height?: number; durationMs?: number; }> {
  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const serviceAccountPath = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_PATH;
  let credentialsJson: string | undefined;

  if (serviceAccountJson && serviceAccountJson.trim().startsWith('{')) {
    credentialsJson = serviceAccountJson;
  } else if (serviceAccountJson) {
    credentialsJson = fs.readFileSync(path.resolve(serviceAccountJson), 'utf-8');
  } else if (serviceAccountPath) {
    credentialsJson = fs.readFileSync(path.resolve(serviceAccountPath), 'utf-8');
  }

  if (credentialsJson) {
    const credentials = JSON.parse(credentialsJson);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    });
    const client = await auth.getClient();
    const drive = google.drive({ version: 'v3', auth: client });
    const meta = await drive.files.get({ fileId, fields: 'name,thumbnailLink,videoMediaMetadata' });
    const response = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' });
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      response.data.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
      response.data.on('end', resolve);
      response.data.on('error', reject);
    });
    return {
      buffer: Buffer.concat(chunks),
      name: meta.data.name ?? undefined,
      thumbnailLink: meta.data.thumbnailLink ?? undefined,
      width: meta.data.videoMediaMetadata?.width ?? undefined,
      height: meta.data.videoMediaMetadata?.height ?? undefined,
      durationMs: meta.data.videoMediaMetadata?.durationMillis ?? undefined,
    };
  }

  // fallback: public download link
  const fallbackUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
  const res = await fetch(fallbackUrl);
  if (!res.ok) {
    throw new Error(`Failed to download video from Google Drive: ${res.status} ${res.statusText}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  return { buffer: Buffer.from(arrayBuffer), name: fileId };
}

function loadVideoFromFile(filePath: string): { buffer: Buffer; name: string } {
  const resolved = path.resolve(filePath);
  return { buffer: fs.readFileSync(resolved), name: path.basename(resolved) };
}

async function buildConfig(): Promise<RealTestConfig> {
  const accessToken = process.env.IG_ACCESS_TOKEN;
  const instagramUserId = process.env.IG_USER_ID;
  if (!accessToken || !instagramUserId) {
    throw new Error('IG_ACCESS_TOKEN と IG_USER_ID を環境変数で指定してください。');
  }

  const videoPath = process.env.IG_VIDEO_PATH;
  const driveFileId = process.env.GOOGLE_DRIVE_FILE_ID;
  const isAiGenerated = process.env.IG_IS_AI ? ['1', 'true', 'yes'].includes(process.env.IG_IS_AI.toLowerCase()) : undefined;

  let videoBuffer: Buffer;
  let videoName: string | undefined;
  let videoId: string | undefined;
  let coverUrl: string | undefined;
  let videoWidth: number | undefined;
  let videoHeight: number | undefined;
  let videoDurationSeconds: number | undefined;

  if (videoPath) {
    const video = loadVideoFromFile(videoPath);
    videoBuffer = video.buffer;
    videoName = video.name;
  } else if (driveFileId) {
    const video = await downloadFromGoogleDrive(driveFileId);
    videoBuffer = video.buffer;
    videoName = video.name;
    videoId = driveFileId;
    coverUrl = video.thumbnailLink;
    videoWidth = video.width;
    videoHeight = video.height;
    videoDurationSeconds = typeof video.durationMs === 'number' ? video.durationMs / 1000 : undefined;
  } else {
    throw new Error('IG_VIDEO_PATH または GOOGLE_DRIVE_FILE_ID のどちらかを指定してください。');
  }

  if (!videoBuffer.length) {
    throw new Error('動画データが空です。入力を確認してください。');
  }

  const caption = resolveCaption();

  return {
    accessToken,
    instagramUserId,
    videoBuffer,
    caption,
    isAiGenerated,
    videoName,
    videoId,
    coverUrl,
    videoWidth,
    videoHeight,
    videoDurationSeconds,
  };
}

async function main(): Promise<void> {
  if (!process.env.INSTAGRAM_REPLAY_DIR) {
    process.env.INSTAGRAM_REPLAY_DIR = 'disable';
  }

  const config = await buildConfig();
  console.log('[real-test] Starting Instagram post test...');
  console.log('[real-test] User ID:', config.instagramUserId);
  console.log('[real-test] Video bytes:', config.videoBuffer.length);
  if (config.videoName) {
    console.log('[real-test] Video name:', config.videoName);
  }
  if (typeof config.isAiGenerated === 'boolean') {
    console.log('[real-test] is_ai_generated:', config.isAiGenerated);
  }
  if (config.coverUrl) {
    console.log('[real-test] cover_url:', config.coverUrl);
  }
  if (config.videoWidth && config.videoHeight) {
    console.log('[real-test] video dimensions:', config.videoWidth, 'x', config.videoHeight);
  }
  if (typeof config.videoDurationSeconds === 'number') {
    console.log('[real-test] video duration (s):', config.videoDurationSeconds);
  }

  const result = await postVideoToInstagram({
    accessToken: config.accessToken,
    instagramAccountId: config.instagramUserId,
    videoBuffer: config.videoBuffer,
    caption: config.caption,
    isAiGenerated: config.isAiGenerated,
    videoName: config.videoName,
    videoId: config.videoId,
    coverUrl: config.coverUrl ?? process.env.IG_COVER_URL,
    thumbOffsetSeconds: process.env.IG_THUMB_OFFSET ? Number(process.env.IG_THUMB_OFFSET) : undefined,
    videoWidth: config.videoWidth,
    videoHeight: config.videoHeight,
    videoDurationSeconds: config.videoDurationSeconds,
  });

  console.log('[real-test] Instagram publish result:', result);
}

main().catch(error => {
  console.error('[real-test] Failed to post video to Instagram:', error);
  process.exitCode = 1;
});
