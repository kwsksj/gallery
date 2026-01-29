# gallery

Notion + Cloudflare R2 をソースにしたギャラリーを、Googleサイトへ iframe で埋め込むための一式です。

## 主要ファイル

- `gallery.html`: ギャラリーUI（単一HTML）
- `gallery.json`: 作品データ（auto-post で生成、`.gitignore` 済み）
- `gallery.sample.json`: 共有用のサンプル
- `worker/src/index.js`: ★ API（Cloudflare Workers）
- `wrangler.toml`: Worker 設定テンプレート

## ★ API（Cloudflare Workers + KV）

1. Cloudflare で KV namespace を作成
2. `wrangler.toml` の `id` / `preview_id` を差し替え
3. `wrangler deploy` で公開
4. `gallery.html` の `data-star-api` か `window.STAR_API_BASE` に Worker のベースURLを設定

### エンドポイント

- `GET /stars?ids=<id1>,<id2>,...`
- `POST /star`（`{ id, delta }`）

## R2 配置

- `gallery.html` / `gallery.json` / `thumbs/` を R2 にアップロード
- `gallery.html`: `Cache-Control: max-age=3600`
- `gallery.json`: `Cache-Control: max-age=300`
- `thumbs/`: `Cache-Control: max-age=31536000`

## 運用

- `auto-post export-gallery-json` で `gallery.json` と `thumbs/` を生成し R2 へ配置
- 定期実行（1日1回）+ 手動実行の運用を想定
