# Monorepo Migration Plan

## Scope

Unify `/Users/kawasakiseiji/development/gallery` and `/Users/kawasakiseiji/development/auto-post` into one repository while minimizing operational risk for a single maintainer.

## Canonical Repository Decision

Prefer `auto-post` as the canonical target when:

- GitHub Actions schedules already run there
- required repository secrets are already configured there

Rationale:
- repository secret values cannot be exported from GitHub Actions, so moving away from a repo with existing secrets requires manual re-entry.

## Recommended Strategy

- Stage 1: Import first, no moves.
- Stage 2: Add unified commands/docs.
- Stage 3: Move directories into target layout.
- Stage 4: Clean up compatibility paths and old repo.

This avoids breaking deploy paths early.

## Stage 1: Import `gallery` Into `auto-post`

### Option A (recommended): preserve history via `git subtree`

Run from `/Users/kawasakiseiji/development/auto-post`:

```bash
git checkout -b codex/monorepo-bootstrap
git remote add gallery-local /Users/kawasakiseiji/development/gallery
git fetch gallery-local
git subtree add --prefix apps/gallery gallery-local main
```

Notes:
- Keeps `gallery` commit history (while preserving existing `auto-post` history).
- Creates a single import commit in current repo plus subtree history.

### Option B: quick copy (no history)

```bash
mkdir -p apps/gallery
rsync -a --exclude .git /Users/kawasakiseiji/development/gallery/ apps/gallery/
git add apps/gallery
git commit -m "Import gallery into apps/gallery (no history)"
```

## Stage 2: Unified Entrypoints

At repo root, add one small command surface:

- `make ingest-preview` -> `auto-post` preview groups
- `make ingest-import-dry` -> `auto-post` import dry-run
- `make publish-dry` -> `auto-post` post dry-run
- `make gallery-export` -> `auto-post` export gallery json
- `make admin-smoke` -> `apps/gallery` upload queue smoke test

This is optional but strongly recommended for AI-driven operations.

## Stage 3: Directory Relocation (Incremental)

Target:

```text
apps/gallery
shared
docs
```

Suggested move order:

1. Keep imported `apps/gallery` as-is first (no immediate internal moves)
2. Add/adjust wrapper scripts in canonical root to call `apps/gallery/*` assets
3. If needed later, split inside `apps/gallery` (`web`, `admin`, `worker`) in small steps
4. Keep compatibility copies/symlinks temporarily only if required by existing deploy scripts

## Stage 4: Final Cleanup

- Remove duplicated docs between old split repos.
- Archive or delete legacy standalone `gallery` repo after a stable period.
- Update CI/workflows to path-based triggers.

## Validation Checklist

### auto-post CLI 動作確認

```bash
# dry-run で投稿フローを検証
auto-post post --dry-run --date $(date +%Y-%m-%d)

# gallery export を検証（R2アップロードを行わず、サムネイル・軽量画像生成もスキップ）
auto-post export-gallery-json --no-upload --no-thumbs --no-light
```

### admin.html upload flow

ローカルで `apps/gallery/admin.html` を開き、画像アップロードが機能することを確認。

### Worker deploy

```bash
cd apps/gallery && npx wrangler deploy --dry-run
```

### workflow パス確認

```bash
grep -r "pip install -e" .github/workflows/
# 出力が "pip install -e ." であることを確認
```

### scheduled workflow の実行確認

GitHub Actions の Runs タブで、次のスケジュール実行が成功することを確認:
- Daily Auto Post (07:42 UTC)
- Daily Gallery Export (07:10 UTC)

## Rollback Plan

### マージ前（ブランチ作業中）

- ブランチを削除し、split-repo 運用を継続

```bash
git checkout main
git branch -D codex/monorepo-bootstrap
```

### マージ後に問題発覚

```bash
# マージコミットを特定
git log --oneline --merges -5

# revert でマージを取り消し
git revert -m 1 <merge-commit-sha>
git push origin main
```

### stable period の定義

以下の条件をすべて満たした時点で「安定」と判断:
- スケジュール実行 3 回連続成功（Daily Auto Post + Daily Gallery Export）
- 手動 workflow_dispatch 実行が成功
- admin.html からのアップロードが正常動作

### gallery repo のアーカイブ基準

stable period 達成後、1 週間の本番運用を経てアーカイブ。

```bash
# GitHub で repo を archive に設定
gh repo archive <owner>/gallery --yes
```

## Owner Checklist (what you need to do)

1. Decide import mode:
   - `subtree` (history needed)
   - `rsync` (speed only)
2. Confirm canonical repo:
   - recommended now: keep `/Users/kawasakiseiji/development/auto-post`
3. **gallery freeze 期間**:
   - 開始: `subtree add` または `rsync` 実行前
   - 終了: `main` ブランチへのマージ完了後
   - この間、gallery repo への変更は禁止
4. Run smoke checks after Stage 1 and Stage 3
5. Switch daily operation to monorepo only after one full successful day of runs
6. **stable period 後のアーカイブ**: 1 週間の本番運用後に gallery repo をアーカイブ
