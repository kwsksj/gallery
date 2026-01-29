# ギャラリー埋め込み 実装計画（v2）

## 決定事項（今回の回答反映）
- タグは Notion の Relation（タグDB）を使用
- 作者も Notion の Relation（作者DB）を使用
- 「スキップ」作品は**ギャラリーから除外しない**
- サムネイル生成は初期から実施（Pillow で 4:5 センタークロップ）
- ★ API エンドポイントは **Cloudflare Workers（workers.dev）を採用**
  - 例: `https://<worker-name>.<account>.workers.dev`
  - CORS を `*` 許可にし、iframe からのアクセスを前提とする
  - 将来的に同一ドメイン化したくなったら、カスタムドメイン + `/api/*` ルートに移行

---

## フェーズ別タスクリスト

### Phase 0: 事前確認（実装前に固める）
- Notion DB のプロパティ名・型を再確認
  - 作品名 / 画像 / 完成日 / 作者 / 教室 / タグ(Relation) / キャプション
- タグDB / 作者DB のタイトルプロパティ名
  - タグDBは「タグ名」を採用済み（コード側は title 型プロパティを自動検出する方針）
- R2 公開URL（`R2_PUBLIC_URL`）
- ★ Worker 名称（workers.dev のサブドメイン名）

---

### Phase 1: auto-post に gallery.json 生成機能を追加
**目的:** Notion → gallery.json を生成し R2 にアップロード

#### 1-1. Notion から必要情報を抽出
- 追加予定ファイル: `auto-post/src/auto_post/gallery_exporter.py`
- `NotionDB` を利用して全作品を取得
  - スキップ作品も含める（除外しない）
- `images` が空の作品は除外（仕様）
- `completed_date` が空の作品は警告して除外
- タグ/作者は Relation から取得
  - 作品DBのスキーマから relation 先DB id を取得
  - タグDB / 作者DB を一度だけ読み込み、`id → name` を辞書化して参照
  - N+1 を避ける（作品数が多くなっても遅くならない）

#### 1-2. データ整形
- `gallery.json` に合わせて出力
  - `id`: Notion page id
  - `title`: 作品名
  - `completed_date`: YYYY-MM-DD
  - `caption`, `author`, `studio`, `tags`, `images`, `thumb`
- ソート
  - 完成日降順
  - 同一日は ID 昇順（安定）

#### 1-3. サムネイル生成（初期導入）
- `Pillow` でサムネを生成
- 4:5 センタークロップ + 幅 480–600px
- 保存先: `thumbs/<work_id>.jpg`
- `thumb` が生成できなければ `images[0]` を使う

#### 1-4. R2 へのアップロード
- `gallery.json` を `gallery.json` として保存
- `Cache-Control: max-age=300` を付与
- `gallery.html` を 1時間キャッシュ
  - `Cache-Control: max-age=3600`

#### 1-5. CLI コマンド追加
- `auto-post/src/auto_post/cli.py`
- 新コマンド: `auto-post export-gallery-json`
- 出力内容
  - 生成件数 / 除外件数 / エラー件数

---

### Phase 2: gallery.html（単一HTML/JS/CSS）
**目的:** iframe に埋め込むギャラリー UI を構築

#### 2-1. JSON 取得
- `fetch('/gallery.json')` → メモリ保持
- 失敗時のエラー表示

#### 2-2. 一覧 UI
- 4:5 サムネイルカード
- 2–5 列のレスポンシブ
- `loading="lazy"`

#### 2-3. フィルタ UI
- 種別セレクト（作者 / タグ / 教室）
- 値セレクトはデータから動的生成
- クリア可能
- URLクエリ同期 (`?filter=tag&value=...`)

#### 2-4. モーダル
- カードクリックで詳細表示
- 画像は縦並び
- 作者/教室/タグはクリックでフィルタ遷移
- ESC / 背景 / × で閉じる

#### 2-5. ★ 機能（フロント側）
- `GET /stars?ids=...` で一括取得
- `POST /star` で加算
- オプティミスティック更新
- API失敗時はカウント非表示（ボタンは残す）

---

### Phase 3: Cloudflare Worker（★ API）
**目的:** ★カウントをKVに保存

- KV key: `star:<work_id>`
- GET `/stars?ids=...`
  - `{ stars: { id: count } }`
- POST `/star`
  - `{ id, delta }` → `{ id, stars }`
- CORS: `*` + `GET/POST/OPTIONS` + `Content-Type`

---

### Phase 4: デプロイ・運用
- `gallery.html`, `gallery.json`, `thumbs/` を R2 に配置
- Googleサイトに iframe 埋め込み
- 定期実行（1日1回）+ 手動実行コマンド

---

## 受け入れ条件チェックリスト
- 完成日降順、同日ID昇順
- フィルタは同時に1条件のみ
- サムネは 4:5 で揃って見える
- モーダルで詳細を表示できる
- ★は連打可能、リロード後も保持
- iframe 埋め込みで崩れない
- エラー時フォールバックが表示される

---

## 次の作業候補（実装順）
1. auto-post に `export-gallery-json` 追加
2. サムネ生成ユーティリティ追加
3. gallery.html 実装
4. ★ Worker 作成
