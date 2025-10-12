# Instagram Graph API 投稿メモ

## 1. 目的

このドキュメントは、Instagram Graph API を用いてリール動画を投稿する際の正しい手順と、最新の検証で判明した注意点をまとめたものです。これまでの失敗ログを踏まえ、CLI からの再現方法と今後の改善課題も記載しています。

## 2. 認証とアクセストークン

### 2.1 利用するトークン
- Facebook ページの長期アクセストークン（`instagram_content_publish` などの権限を含む）を使用する。
- トークンを API に渡す際は `Authorization` ヘッダーではなく、フォームパラメータ `access_token` として送る。

### 2.2 主要スコープ
- `instagram_content_publish`
- `pages_show_list`
- `pages_read_engagement`
- `business_management`

### 2.3 トークン検証
```bash
curl -X GET "https://graph.facebook.com/debug_token?input_token=<ACCESS_TOKEN>&access_token=<ACCESS_TOKEN>"
```

## 3. リール投稿の正しいフロー

1. **メディアセッション開始**
   - エンドポイント: `POST https://graph-video.facebook.com/v19.0/{ig-user-id}/media`
   - 主要パラメータ:
     - `access_token=<ACCESS_TOKEN>`
     - `media_type=REELS`
     - `upload_phase=start`
     - `upload_type=resumable`
     - `file_size=<バイト数>`
   - `video_url` を渡すのではなく、レスポンスで返る `upload_url` に対して後段でバイナリを直接アップロードする。

2. **バイナリアップロード**
   - `upload_url` へ POST。
   - 必須ヘッダー:
     - `Authorization: OAuth <ACCESS_TOKEN>`
     - `Content-Type: application/octet-stream`
     - `Offset: 0`
     - `Content-Length: <バイト数>`
     - `Content-Range: bytes 0-<size-1>/<size>`（検証では必要と推定。ただしエラーは解消されていない。詳細は §4）
   - ボディは動画ファイル本体のバイナリ。

3. **アップロード完了通知**
   - エンドポイント: `POST https://graph-video.facebook.com/v19.0/{ig-user-id}/media`
   - パラメータ:
     - `access_token`
     - `upload_phase=finish`
     - `upload_session_id=<UPLOAD_SESSION_ID>`
     - `caption`
     - `is_ai_generated`（必要に応じて）

4. **ステータス監視**
   - エンドポイント: `GET https://graph-video.facebook.com/v19.0/{upload_session_id}`
   - クエリ: `access_token`, `fields=status,status_code,upload_status`
   - ステータスが `FINISHED` になるまで数秒間隔でポーリングする。

5. **メディア公開**
   - エンドポイント: `POST https://graph.facebook.com/v19.0/{ig-user-id}/media_publish`
   - パラメータ:
     - `access_token=<ACCESS_TOKEN>`
     - `creation_id=<UPLOAD_SESSION_ID>`

## 4. 2025-10-12〜13 の検証ログから分かったこと

- **メディアセッション作成**: `graph.facebook.com` を使うと `(#100) The parameter video_url is required` が返る。`graph-video.facebook.com` と `upload_type=resumable` の組み合わせで正しく `upload_url` が返却された。
- **rupload へのアップロード**: `Content-Length` と `Offset` に加えて `Content-Range` を送っても `Invalid Header format without either Content-Length or Transfer-Encoding` が発生。Meta が公開している rupload プロトコル（`X-Instagram-Rupload-Params` や `X-Entity-*` ヘッダー、チャンク制御）の実装が必要と推察。`node-fetch` の単純な `fetch` では要件を満たせていない。
- **再現スクリプト**: 投稿時に生成される `logs/instagram/replay_*.sh` は Google Drive から動画を取得し、上記 4 ステップを `curl` で再現できる。失敗ケースの再検証・比較に役立つ。

## 5. 既知の課題と次のアクション

- rupload の必須ヘッダー（`X-Instagram-Rupload-Params`, `X-Entity-Length`, `X-Entity-Name` 等）を精査し、アップロード処理を仕様どおりに組み直す。
- `node-fetch` で困難な場合は `axios` など別の HTTP クライアントを検討し、ヘッダー制御やストリーミング送信を柔軟に行えるようにする。
- 実データ検証は `npx tsx scripts/replayInstagramFromLog.ts <replay.json>` で再現できる。エラーが出た場合はレスポンスの `debug_info` と rupload ドキュメントを照らし合わせてヘッダーを調整する。

