import fs from 'fs';
import path from 'path';
import process from 'process';
import { postVideoToInstagram } from '../services/instagramService.js';

function getFlagValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function readCaption(): string {
  const direct = getFlagValue('--caption') ?? process.env.IG_CAPTION;
  if (direct) return direct;

  const captionFile = getFlagValue('--caption-file') ?? process.env.IG_CAPTION_FILE;
  if (captionFile) {
    const resolved = path.resolve(process.cwd(), captionFile);
    return fs.readFileSync(resolved, 'utf-8');
  }

  return '';
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'y'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n'].includes(normalized)) return false;
  return undefined;
}

async function main(): Promise<void> {
  const accessToken = process.env.IG_ACCESS_TOKEN ?? getFlagValue('--access-token');
  const instagramAccountId = process.env.IG_USER_ID ?? getFlagValue('--user-id');
  const videoPath = process.env.IG_VIDEO_PATH ?? getFlagValue('--video');
  const aiFlag = process.env.IG_IS_AI ?? getFlagValue('--ai');
  const coverUrl = process.env.IG_COVER_URL ?? getFlagValue('--cover-url');
  const thumbOffset = process.env.IG_THUMB_OFFSET ?? getFlagValue('--thumb-offset');
  const width = process.env.IG_VIDEO_WIDTH ?? getFlagValue('--width');
  const height = process.env.IG_VIDEO_HEIGHT ?? getFlagValue('--height');
  const durationSeconds = process.env.IG_VIDEO_DURATION ?? getFlagValue('--duration');
  const shareToFeedFlag = process.env.IG_SHARE_TO_FEED ?? getFlagValue('--share-to-feed');

  if (!accessToken) {
    throw new Error('Access token is required. Provide IG_ACCESS_TOKEN or --access-token.');
  }
  if (!instagramAccountId) {
    throw new Error('Instagram user ID is required. Provide IG_USER_ID or --user-id.');
  }
  if (!videoPath) {
    throw new Error('Video path is required. Provide IG_VIDEO_PATH or --video.');
  }

  const resolvedVideoPath = path.resolve(process.cwd(), videoPath);
  if (!fs.existsSync(resolvedVideoPath)) {
    throw new Error(`Video file not found: ${resolvedVideoPath}`);
  }

  const caption = readCaption();
  const videoBuffer = fs.readFileSync(resolvedVideoPath);
  const isAiGenerated = parseBoolean(aiFlag);
  const thumbOffsetSeconds = thumbOffset ? Number(thumbOffset) : undefined;

  console.log('=== Instagram CLI Upload ===');
  console.log(`User ID           : ${instagramAccountId}`);
  console.log(`Video file        : ${resolvedVideoPath} (${videoBuffer.length} bytes)`);
  console.log(`Caption preview   : ${caption ? caption.slice(0, 60) + (caption.length > 60 ? '…' : '') : '(empty)'}`);
  if (typeof isAiGenerated === 'boolean') {
    console.log(`AI generated flag : ${isAiGenerated}`);
  }
  if (coverUrl) {
    console.log(`Cover URL         : ${coverUrl}`);
  }
  if (typeof thumbOffsetSeconds === 'number') {
    console.log(`Thumb offset (s)  : ${thumbOffsetSeconds}`);
  }
  if (width || height) {
    console.log(`Video dimensions  : ${width ?? '?'} x ${height ?? '?'}`);
  }
  if (durationSeconds) {
    console.log(`Duration (s)      : ${durationSeconds}`);
  }
  if (typeof parseBoolean(shareToFeedFlag) === 'boolean') {
    console.log(`Share to feed     : ${parseBoolean(shareToFeedFlag)}`);
  }

  const publishResult = await postVideoToInstagram({
    accessToken,
    instagramAccountId,
    videoBuffer,
    caption,
    isAiGenerated,
    videoName: path.basename(resolvedVideoPath),
    coverUrl,
    thumbOffsetSeconds,
    shareToFeed: parseBoolean(shareToFeedFlag),
    videoWidth: width ? Number(width) : undefined,
    videoHeight: height ? Number(height) : undefined,
    videoDurationSeconds: durationSeconds ? Number(durationSeconds) : undefined,
  });

  console.log('=== Publish Result ===');
  console.log(publishResult);
}

main().catch(error => {
  console.error('Instagram upload failed:', error);
  process.exitCode = 1;
});
