# Architecture Overview

## Goal

This document clarifies repository boundaries and the target monorepo structure.

Current pain point: related features are split across `gallery` and `auto-post`, which makes ownership and change impact harder to reason about.

## Current State (as of 2026-02-13)

- `gallery` repo
  - Public gallery UI (`gallery.html`)
  - Admin upload/curation UI (`admin.html`, `admin/`)
  - Worker API for admin and stars (`worker/`, `wrangler.toml`)
- `auto-post` repo
  - Notion-driven social posting (Instagram/X/Threads)
  - Google Takeout grouping/import
  - `gallery.json` and thumbs export pipeline

## Recommended Direction

Use a single repository with directory-level boundaries.

Given current operations (GitHub Actions + secrets already on `auto-post`), use `auto-post` as canonical and import `gallery` under `apps/gallery` first.

Example target layout:

```text
/apps/gallery
/shared
/docs
```

## Responsibility Boundaries

- `apps/gallery`
  - public gallery UI, admin UI, worker API (imported as a module first)
- canonical root (`auto-post`)
  - batch/automation tooling: ingest, publish, export
  - scheduled workflows and repository secrets
- `shared`
  - Shared assets/utilities across web apps

## Migration Principle

- Keep runtime behavior unchanged first.
- Import `gallery` into canonical repo before internal rearrangement.
- Move paths in small batches with compatibility shims as needed.
