# Monorepo Migration Record (Historical)

この文書は「計画書」ではなく、完了済み移行の記録です。

## Current Status

- 移行先（canonical）: `/Users/kawasakiseiji/development/auto-post`
- gallery 実体: `/Users/kawasakiseiji/development/auto-post/apps/gallery`
- この `gallery` repo: legacy（参照用）

## What Was Decided

- `auto-post` を canonical repo にする
- 理由:
  - GitHub Actions の定期実行が既に `auto-post` で運用されていた
  - 必要な repository secrets も `auto-post` に既に設定済みだった
  - GitHub Actions secrets の値は API/CLI で取り出せないため、repo を逆にすると再入力コストが高い

## Execution Summary

以下の流れで統合を実施:

1. `gallery` を `auto-post/apps/gallery` に取り込み
2. ルートコマンド/ドキュメントを `auto-post` 側で整理
3. 運用確認（CLI dry-run / Worker deploy / scheduled runs / 手動実行 / admin upload）

## Validation Notes

確認済み事項:

- `npx wrangler deploy`（gallery Worker）成功
- Daily Gallery Export（スケジュール実行）成功
- Daily Auto Post（スケジュール実行）成功
- `admin.html` からの画像アップロード/更新 成功
- 手動実行（workflow_dispatch）成功

## Operational Rule After Migration

- 日常運用・改修は `auto-post` の `main` を正本として実施
- この repo への新規機能追加は行わない
- この repo は履歴比較・緊急切り戻し検証用途に限定

## Where To Read Current Docs

- `/Users/kawasakiseiji/development/auto-post/README.md`
- `/Users/kawasakiseiji/development/auto-post/MONOREPO_INTEGRATION.md`
- `/Users/kawasakiseiji/development/auto-post/apps/gallery/README.md`
