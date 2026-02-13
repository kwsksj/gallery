# Monorepo Migration Record (Historical)

この文書は「計画書」ではなく、完了済み移行の記録です。

## Current Status

- 移行先（canonical）: `media-platform` (`<repo-root>`)
- gallery 実体:
  - `<repo-root>/apps/gallery-web`
  - `<repo-root>/apps/admin-web`
  - `<repo-root>/apps/worker-api`
- GitHub repository: `kwsksj/media-platform`（rename 済み）
- local workspace path: `/Users/kawasakiseiji/development/media-platform`
- この `gallery` repo: legacy（参照用）

## What Was Decided

- `media-platform`（旧 `auto-post`）を canonical repo にする
- 理由:
  - GitHub Actions の定期実行が既に canonical repo で運用されていた
  - 必要な repository secrets も canonical repo に既に設定済みだった
  - GitHub Actions secrets の値は API/CLI で取り出せないため、repo を逆にすると再入力コストが高い

## Execution Summary

以下の流れで統合を実施:

1. `gallery` を canonical repo に取り込み（当初: `apps/gallery`）
2. 責務分離として `apps/gallery-web` / `apps/admin-web` / `apps/worker-api` に再編
3. ルートコマンド/ドキュメントを canonical 側で整理
4. 運用確認（CLI dry-run / Worker deploy / scheduled runs / 手動実行 / admin upload）

## Validation Notes

確認済み事項:

- `npx wrangler deploy`（gallery Worker）成功
- Daily Gallery Export（スケジュール実行）成功
- Daily Auto Post（スケジュール実行）成功
- `admin.html` からの画像アップロード/更新 成功
- 手動実行（workflow_dispatch）成功
- repo rename 後の `admin.html` ギャラリー更新トリガー成功

## Operational Rule After Migration

- 日常運用・改修は `media-platform` の `main` を正本として実施
- この repo への新規機能追加は行わない
- この repo は履歴比較・緊急切り戻し検証用途に限定

## Where To Read Current Docs

- `<repo-root>/README.md`
- `<repo-root>/docs/monorepo-integration.md`
- `<repo-root>/apps/gallery-web/README.md`
- `<repo-root>/apps/admin-web/README.md`
- `<repo-root>/apps/worker-api/README.md`
