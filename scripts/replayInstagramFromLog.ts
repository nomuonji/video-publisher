import fs from 'fs';
import path from 'path';
import process from 'process';
import fetch from 'node-fetch';
import { google } from 'googleapis';
import { postVideoToInstagram } from '../services/instagramService.js';

interface ReplayArtifact {
  metadata: {
    instagramAccountId: string;
    accessToken: string;
    caption: string;
    videoBytes: number;
    videoName?: string;
    videoId?: string;
    isAiGenerated?: boolean;
  };
}

async function downloadFromGoogleDrive(fileId: string): Promise<Buffer> {
  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const serviceAccountPath = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_PATH;

  try {
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
      const drive = google.drive({ version: 'v3', auth: await auth.getClient() });
      const response = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' });
      const chunks: Buffer[] = [];
      await new Promise<void>((resolve, reject) => {
        response.data.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
        response.data.on('end', resolve);
        response.data.on('error', reject);
      });
      return Buffer.concat(chunks);
    }
  } catch (error) {
    console.warn('[replay] Failed to download via Google API, falling back to public download:', error);
  }

  const url = `https://drive.google.com/uc?export=download&id=${fileId}`;
  const fallbackResponse = await fetch(url);
  if (!fallbackResponse.ok) {
    throw new Error(`Failed to download video from Google Drive: ${fallbackResponse.status} ${fallbackResponse.statusText}`);
  }
  const arrayBuffer = await fallbackResponse.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

function findLatestReplay(): string | undefined {
  const baseDir = path.join(process.cwd(), 'logs', 'instagram');
  if (!fs.existsSync(baseDir)) {
    return undefined;
  }
  const candidates = fs.readdirSync(baseDir)
    .filter(name => name.startsWith('replay_') && name.endsWith('.json'))
    .map(name => path.join(baseDir, name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return candidates[0];
}

async function main(): Promise<void> {
  if (!process.env.INSTAGRAM_REPLAY_DIR) {
    process.env.INSTAGRAM_REPLAY_DIR = 'disable';
  }
  const replayPath = process.argv[2] ? path.resolve(process.argv[2]) : findLatestReplay();
  if (!replayPath || !fs.existsSync(replayPath)) {
    throw new Error('Replay JSON file not found. Pass the path as an argument or ensure logs/instagram contains a replay.');
  }

  const artifact: ReplayArtifact = JSON.parse(fs.readFileSync(replayPath, 'utf-8'));
  const { metadata } = artifact;
  const {
    instagramAccountId,
    accessToken,
    caption,
    videoBytes,
    videoName,
    videoId,
    isAiGenerated,
  } = metadata;

  if (!videoId) {
    throw new Error('Replay metadata is missing videoId. Cannot download video from Google Drive.');
  }

  console.log('[replay] Using replay file:', replayPath);
  console.log('[replay] Instagram account:', instagramAccountId);
  console.log('[replay] Video ID:', videoId);
  console.log('[replay] Video size (bytes):', videoBytes);

  const videoBuffer = await downloadFromGoogleDrive(videoId);
  console.log('[replay] Downloaded video buffer size:', videoBuffer.length);

  const result = await postVideoToInstagram({
    accessToken,
    instagramAccountId,
    videoBuffer,
    caption,
    isAiGenerated,
    videoName,
    videoId,
  });

  console.log('[replay] Instagram publish result:', result);
}

main().catch(error => {
  console.error('[replay] Failed to execute replay:', error);
  process.exitCode = 1;
});
