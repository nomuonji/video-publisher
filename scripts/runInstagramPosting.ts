import fs from 'fs';
import path from 'path';
import process from 'process';
import { postVideoToInstagram } from '../services/instagramService.js';

function getFlagValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function readCaptionSource(): string {
  const captionArg = getFlagValue('--caption');
  if (captionArg) return captionArg;

  const captionFile = getFlagValue('--caption-file');
  if (captionFile) {
    const resolved = path.resolve(process.cwd(), captionFile);
    return fs.readFileSync(resolved, 'utf-8');
  }

  return '';
}

async function main(): Promise<void> {
  const accessToken = process.env.IG_ACCESS_TOKEN ?? getFlagValue('--access-token');
  const instagramAccountId = process.env.IG_USER_ID ?? getFlagValue('--user-id');
  const videoPath = process.env.IG_VIDEO_PATH ?? getFlagValue('--video');
  const aiFlag = process.env.IG_IS_AI ?? getFlagValue('--ai');

  if (!accessToken) {
    throw new Error('アクセス トークンが指定されていません。環境変数 IG_ACCESS_TOKEN または --access-token で指定してください。');
  }
  if (!instagramAccountId) {
    throw new Error('Instagram ユーザー ID が指定されていません。環境変数 IG_USER_ID または --user-id で指定してください。');
  }
  if (!videoPath) {
    throw new Error('動画ファイルパスが指定されていません。環境変数 IG_VIDEO_PATH または --video で指定してください。');
  }

  const resolvedVideoPath = path.resolve(process.cwd(), videoPath);
  if (!fs.existsSync(resolvedVideoPath)) {
    throw new Error(`動画ファイルが存在しません: ${resolvedVideoPath}`);
  }

  const caption = readCaptionSource();
  const videoBuffer = fs.readFileSync(resolvedVideoPath);
  const isAiGenerated = typeof aiFlag === 'string' ? ['1', 'true', 'yes'].includes(aiFlag.toLowerCase()) : undefined;

  console.log('=== Instagram 投稿 CLI テスト開始 ===');
  console.log(`ユーザー ID: ${instagramAccountId}`);
  console.log(`動画ファイル: ${resolvedVideoPath} (${videoBuffer.length} bytes)`);
  console.log(`キャプション: ${caption ? caption.slice(0, 60) + (caption.length > 60 ? '…' : '') : '(空)'}`);
  if (typeof isAiGenerated === 'boolean') {
    console.log(`AI生成フラグ: ${isAiGenerated}`);
  }

  const publishResult = await postVideoToInstagram({
    accessToken,
    instagramAccountId,
    videoBuffer,
    caption,
    isAiGenerated,
  });

  console.log('=== Instagram 投稿 CLI テスト完了 ===');
  console.log('レスポンス:', publishResult);
}

main().catch(error => {
  console.error('Instagram 投稿処理でエラーが発生しました:', error);
  process.exitCode = 1;
});
