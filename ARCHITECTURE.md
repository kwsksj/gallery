# Architecture Overview

## Current Architecture (as of 2026-02-13)

モノレポ統合後の正本は `media-platform`（旧 `auto-post`）です。

- canonical repository: `media-platform` (`<repo-root>`)
- gallery module: `<repo-root>/apps/gallery`

この `gallery` リポジトリは、履歴参照・比較用の legacy repo として扱います。

## Responsibility Boundaries

- `media-platform` root
  - Notion 駆動の投稿自動化
  - Google Takeout 取り込み
  - `gallery.json` / `thumbs` のエクスポート
  - GitHub Actions スケジュールと Secrets 運用
- `media-platform/apps/gallery`
  - `gallery.html`（公開UI）
  - `admin.html` / `admin/`（管理UI）
  - `worker/` + `wrangler.toml`（API と管理系エンドポイント）

## Operation Rule

- 日常の改修先は `media-platform` のみ
- この repo への新規改修は原則停止
- 例外は緊急時の切り戻し検証や履歴調査のみ
