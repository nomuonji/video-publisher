# Instagram Reels API でつまずいたポイントと解決メモ

Meta Graph API を使って Instagram リールを投稿する際に遭遇した問題と、その解決策をまとめた備忘録です。チャンクアップロードを伴うリール投稿はエラー原因が分かりづらいので、今後の開発に役立ててください。

---

## 1. リール投稿の全体フロー

1. `POST /{ig-user-id}/media` (`upload_phase=start`, `upload_type=resumable`, `media_type=REELS`)
2. `https://rupload.facebook.com/...` へ動画をチャンク分割してアップロード  
   - `Authorization: OAuth <page_access_token>`
   - `X-Instagram-Rupload-Params` に JSON 文字列をセット
3. `POST /{ig-user-id}/media` (`upload_phase=finish`)  
   - `video_url` と `video_id` を **必ず** 指定
4. `GET /{upload_session_id}` (`fields=status,status_code`) でエンコード完了をポーリング
5. `POST /{ig-user-id}/media_publish` (`creation_id=<upload_session_id>` or `finish` 応答の `id`)

---

## 2. 実際に遭遇した主なエラーと対処法

### (#100) The parameter video_url is required
- 原因: finish の `upload_phase=finish` 呼び出しで `video_url` を送っていない。
- 対策: start 応答の `upload_url` を `video_url` として finish に渡す。`video_id` もセットすると安定。

### 400 PartialRequestError / ProcessingFailedError
- 原因: チャンクアップロード中の一時的エラー。処理の途中で 400 になっても必ずしも致命的ではない。
- 対策:  
  - 412 になるまでリトライする実装を導入。  
  - リトライごとにバックオフを伸ばし（6秒 → 12秒 → 18秒 …）、4 回程度まで再送する。  
  - 途中チャンクで 206 が返り続けるのは正常。

### 412 OffsetInvalidError
- 原因: サーバが期待する `Offset` / `X-Entity-Offset` とクライアント送信のオフセットがズレている。
- 対策:  
  - エラーボディに含まれる `offset` または `Maximum accepted offset` を読み取り、クライアント側 `offset` と `chunkIndex` を再同期させる。  
  - その位置からアップロードを再開する。

### finish 直後の publish 失敗
- 原因: エンコードが完了する前に `media_publish` を叩いている。
- 対策: `GET /{upload_session_id}` (`fields=status,status_code`) を 5 秒間隔でポーリングし、`FINISHED` になってから publish。

---

## 3. rupload で気を付けるヘッダー

```json
X-Instagram-Rupload-Params:
{
  "upload_id": "1785...",
  "media_type": "2",
  "name": "rendered_clip.mp4",
  "chunk_retry_interval": 6000,
  "xsharing_user_ids": "[\"1784...\"]",
  "upload_file_size": "33699674",
  "upload_media_spec": "{\"media_type\":2,\"original_width\":1080,\"original_height\":1920,\"aspect_ratio\":1.778}",
  "retry_context": "{\"num_step_auto_retry\":0,\"num_reupload\":0,\"num_step_manual_retry\":0}",
  "is_last": "0",
  "chunk_sequence_number": "3",
  "chunk_length": "4194304"
}
```

その他必要なヘッダー:

| ヘッダー              | 例                                                                      |
| --------------------- | ----------------------------------------------------------------------- |
| `Authorization`       | `OAuth <page_access_token>`                                             |
| `Content-Type`        | `application/octet-stream`                                              |
| `Content-Length`      | チャンクサイズ                                                          |
| `Content-Range`       | `bytes {start}-{end}/{total}`                                           |
| `X-Entity-Type`       | `video/mp4`                                                             |
| `X-Entity-Length`     | 動画の総バイト数                                                        |
| `X-Entity-Offset`     | 現在チャンクの開始オフセット                                            |
| `Offset`              | 同上（大文字 O。Graph 側がこちらを参照することがある）                  |

---

## 4. 開発時に確認したほうがよいチェックリスト

- [ ] `start` 応答に `upload_url` が含まれているか確認
- [ ] `X-Instagram-Rupload-Params` に **文字列 JSON** が入っているか（オブジェクトではなく文字列）
- [ ] `upload_media_spec` に実寸の width/height/duration を入れる（Google Drive API 等から取得）
- [ ] finish 時に `video_url` / `video_id` がセットされているか
- [ ] `status` ポーリングで `FINISHED` になったか
- [ ] `media_publish` は `creation_id=<upload_session_id>` で呼んでいるか
- [ ] アクセストークンの権限: `instagram_content_publish`, `pages_show_list`, `pages_read_engagement`, `business_management`

---

## 5. 本番運用向けの実装メモ

- 4MB チャンクが最も安定。各チャンク送信後に 500ms 休止して負荷を避ける。
- API から返る `OffsetInvalidError` などを解析し、サーバ側の offset に合わせて再送することが重要。
- ログは `logger.log` で開始～finish/publish のパラメータを記録し、障害時にはレスポンスの `debug_info` を追跡できるようにしておく。
- フロント・バック問わず `postVideoToInstagram` 関数を用いれば同一の堅牢なフローを共有できる。

---

## 6. 参考リンク

- [Meta Developers – Resumable Uploads](https://developers.facebook.com/docs/instagram-platform/content-publishing/resumable-uploads/)
- [Media Publish API – IG User Media](https://developers.facebook.com/docs/instagram-api/reference/ig-user/media#creating)
- 公式 cURL サンプルで `X-Instagram-Rupload-Params` がどのように指定されているかを確認しておくと理解が早い。

---

この内容を踏まえておけば、Instagram リール投稿の自動化で同じ落とし穴にハマる可能性はかなり低くなります。投稿フローに失敗した場合は、finish 応答と rupload の最後のチャンクエラーを重点的にチェックしてください。Happy hacking! 🎉

