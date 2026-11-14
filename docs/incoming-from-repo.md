# リポジトリから動画を投稿する（Queue From Repo）

他のリポジトリ（例: nomuonji/animation-factory の 3D コント）で作った動画を、
このリポジトリに push するだけで YouTube（コンセプトのチャンネル）と TikTok（Buffer 経由）に投稿する手順。
3D コント全体の手順は animation-factory の `docs/three-shorts-playbook.md` にある。

## 置き方

`incoming/<anything>` という名前のブランチを main から切り、次の2ファイルを commit して push する。

```
incoming/<コンセプト>/<YYYY-MM-DD>-<id>.mp4
incoming/<コンセプト>/<YYYY-MM-DD>-<id>.json
```

```json
{
  "title": "カエルの部屋探し",
  "description": "本文。\n\nVOICEVOX:No.7\nVOICEVOX:ずんだもん\n…（素材のクレジット）",
  "hashtags": "#ショート #不動産 #コント",
  "postNow": "YouTube,TikTok",
  "tiktokAccount": "oyu295"
}
```

- `hashtags` は **1本の文字列**（配列にしない）。description の後ろに付けて投稿される。
- `postNow`: `"YouTube"`／`"TikTok"`／`"YouTube,TikTok"`。省略すると YouTube だけ。
- `tiktokAccount`: Buffer のチャンネル名（おもしろは `oyu295`）。
- VOICEVOX を使った動画は description に `VOICEVOX:<話者>` のクレジットが必須。
- animation-factory なら `node tools/three/publish-pack.mjs <id> --publisher <このリポジトリ>` がこの2ファイルを書く。

## 何が起きるか

1. **Queue From Repo** ワークフロー（`.github/workflows/queue-from-repo.yml`）が走り、`scripts/queue-from-repo.ts` が投稿する。
2. 終わるとブランチは自動で消える（動画は main に入らない）。
3. ジョブのログに結果が出る:
   - `Posted <file> → https://youtube.com/shorts/<id>`
   - `TikTok <file> → Buffer shareNow → oyu295 (post <post id> …)`、または `TikTok skipped for … (<理由>)`

## TikTok が届いたか確かめる

数分後に **Buffer Tool**（`.github/workflows/buffer-tool.yml`）を手動実行する:

- `action=query`
- `query=query { post(input: { id: "<post id>" }) { status externalLink error { message rawError } } }`

`status: "sent"` と `externalLink`（TikTok の URL）が出れば完了。

## 失敗したとき

- **YouTube に投稿済みなら、同じ動画で YouTube を含む `postNow` を再 push しない**（二重投稿になる）。TikTok の失敗はジョブを失敗にしないので、ジョブの再実行もしない。
- Buffer の投稿が `error`: Buffer Tool を `action=sharenow`, `ids=<post id>` で送り直す（`action=failed` で失敗中の投稿一覧、`action=retry` で本文とメディアを付け直して再送）。
- Buffer に投稿自体が無い: `postNow: "TikTok"` だけの sidecar を別ブランチ（`incoming/<id>-tiktok`）で push する。
- 認証切れ（`Invalid Credentials` など）: リポジトリの持ち主がトークンを更新する必要がある。報告して止める。

## 再生データを取る（YouTube Metrics）

投稿した動画の数字は **YouTube Metrics**（`.github/workflows/metrics.yml`、`scripts/youtube-metrics.ts`）を手動実行して読む。
コンセプトの refresh token（Drive の config.json）で YouTube Analytics API を読むだけで、何も書き込まない。
token に `yt-analytics.readonly` が要る（無ければアプリの「YouTube認証」で再認証）。

- `mode=check`、`concept=おもしろ`: Analytics API が答えるかの疎通確認。
- `mode=video`、`concept=おもしろ`、`videos="<YouTubeID>:<公開日 YYYY-MM-DD>:<尺秒> …"`: 公開日〜+2日の窓で、再生数・平均視聴時間/率・登録者増・Shortsフィード経由・維持率（3/5/10/20秒/最後）。
  公開から3日たっていない動画は取らない。ログに表と `METRICS_JSON {...}` の行が出る。
