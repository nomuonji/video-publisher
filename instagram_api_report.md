# Instagram Graph API 調査レポート

## 0. 現在のテスト手順
- `npx tsx scripts/testInstagramService.ts` でモックを使ったエンドツーエンド検証（start → rupload → finish → publish の各段階を確認）。
- `npx tsx scripts/replayInstagramFromLog.ts logs/instagram/replay_2025-10-12T15-00-02-663Z.json` で実ログを元にテストデータを再生し、Google Drive から動画を取得して本番 API フローを再現。
- 実データで最終確認する場合は `npx tsx scripts/testInstagramRealPosting.ts` を利用し、環境変数（`IG_ACCESS_TOKEN`, `IG_USER_ID`, `GOOGLE_DRIVE_FILE_ID` など）を設定して実機テストを実施。
- エラーが出た際は `logs/instagram/replay_*.json/.sh` や API 応答の `debug_info` を参照し、パラメータやヘッダーの齟齬を特定して再テストを繰り返す。

## 1. 直近の改善ポイント
- `upload_phase=start` では `media_type=REELS` と `upload_type=resumable`、`file_size` のみを送信し、`caption` や `is_ai_generated` は finish 呼び出しへ移動。これで `(#100) The parameter video_url is required` を回避。
- rupload の `X-Instagram-Rupload-Params` を動画専用仕様に合わせて調整（`media_type: "2"`、`upload_media_spec` に実寸・アスペクト比・再生時間を埋め込む）。ステータス 206 はチャンク転送中の正常応答として許容。
- finish では `media_type=REELS`, `video_type=REELS`, `clips_subtype=REELS`, `thumb_offset`, `cover_url`, `upload_session_id`, `caption`, `is_ai_generated` などリール特有のパラメータを付与し、レスポンスの `id` を publish 用 `creation_id` として採用。
- finish 直後は処理中であることが多いため `GET /{upload_session_id}` を 5 秒間隔でポーリングし、`status_code` が `FINISHED` / `SUCCESS` になるまで待機してから `media_publish` へ進む。

## 2. 認証とアクセストークン
- 必要権限: `instagram_content_publish`, `pages_show_list`, `pages_read_engagement`, `business_management`。
- 各リクエストは `access_token` フィールドで送信。rupload 以外では `Authorization` ヘッダーを追加する必要はない。
- トークンの健全性は次のコマンドで確認可能。
  ```bash
  curl -X GET "https://graph.facebook.com/debug_token?input_token=<ACCESS_TOKEN>&access_token=<ACCESS_TOKEN>"
  ```

## 3. リール投稿フロー詳細

### 3.1 セッション開始
- `POST https://graph-video.facebook.com/v19.0/{ig-user-id}/media`
- 主要パラメータ: `media_type=REELS`, `upload_phase=start`, `upload_type=resumable`, `file_size=<バイト数>`。
- 応答から `upload_session_id`, `upload_url` を取得。どちらか欠ける場合は処理を中断。

### 3.2 rupload（動画アップロード）
- `upload_url` に対して 4MB 前後のチャンクで順次 POST。
- ヘッダー群:
  - `Authorization: OAuth <ACCESS_TOKEN>`
  - `Content-Type: application/octet-stream`
  - `Content-Length`, `Content-Range: bytes {start}-{end}/{total}`
  - `Offset`, `X-Entity-Offset`: 各チャンクの開始バイト
  - `X-Entity-Length`: 総バイト数
  - `X-Entity-Type: video/mp4`
  - `X-Entity-Name: <upload_session_id>`
  - `X-Instagram-Rupload-Params`: JSON 文字列（`upload_id`, `media_type`, `upload_file_size`, `xsharing_user_ids`, `upload_media_spec`, `retry_context` 等）
- 途中チャンクでは 206 応答が継続し、最終チャンクで 200 が返るのが正常。

### 3.3 アップロード完了（finish）
- `POST https://graph-video.facebook.com/v19.0/{ig-user-id}/media`
- 主なパラメータ: `media_type=REELS`, `upload_phase=finish`, `upload_session_id`, `video_type=REELS`, `clips_subtype=REELS`, `caption`, `thumb_offset`（秒）, `cover_url`, `is_ai_generated`, `share_to_feed`（任意）。
- レスポンスで `status_code` が `IN_PROGRESS` などの場合は `GET https://graph-video.facebook.com/v19.0/{upload_session_id}?fields=status,status_code,upload_status` を 5 秒間隔で呼び出し、`FINISHED` / `SUCCESS` まで待機。
- `creation_id` は finish の `id` / `video_id` もしくはステータス取得応答から取得し、未取得のまま publish しないようにする。

### 3.4 公開（publish）
- `POST https://graph.facebook.com/v19.0/{ig-user-id}/media_publish`
- パラメータ: `creation_id=<finishで取得したID>`, `access_token`。
- 応答 `id` / `fb_post_id` が投稿済みメディア ID。エラー時は `error.message` を記録。

## 4. 注意点と今後の調査項目
- `cover_url` には Instagram 側から直接取得できる公開 URL が必要。Google Drive のサムネイルを使う場合は共有設定を「リンクを知っている全員」にする。
- 動画処理が完了する前に publish すると `VIDEO_NOT_READY` などのエラーになるため、ポーリング完了を待つ。
- リトライ戦略は `retry_context` で制御できるが現在は 0 回設定。連続失敗が続く場合は `num_reupload` などの値を調整する。
- `upload_media_spec` の `original_width` / `original_height` / `duration_ms` は実データに合わせる。Google Drive の `videoMediaMetadata` や ffprobe の結果を活用。
- 追加調査予定:
  1. `cover_url` を準備できない場合に `thumb_offset` だけで許容されるか。
  2. `video_type` / `clips_subtype` に他の値を指定した際の互換性とリール以外の挙動。
  3. 100MB を超える大容量動画でのチャンクサイズ調整と自動リトライ戦略。

## 5. 最終報告
- `npx tsx scripts/replayInstagramFromLog.ts logs/instagram/replay_2025-10-12T15-00-02-663Z.json` を実行し、Graph API 上で `creation_id=17852576571558961` を `media_publish` まで通過。
- 最終的な publish 応答: `{ id: "18033280973710576" }` を取得し、実データのリール投稿フローが完結することを確認。
- 失敗していた要因は finish 呼び出しでの `video_url` 未指定と、最終チャンク周りのヘッダー不足。チャンクごとの `is_last/chunk_sequence_number/chunk_length` 付与と 500ms クールダウン＋リトライで安定化。
- 今後の再現手順: 上記リプレイスクリプト → ステータスポーリング (`status/status_code`) → `media_publish`。必要に応じて `scripts/testInstagramRealPosting.ts` で本番トークンをセットし統合テストを実施。
