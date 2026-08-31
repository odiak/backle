# backle

> 🇬🇧 English version: [see below](#backle-english)

**backle**（バックル）は、Backlogのプロジェクトデータ（課題・コメント・Wiki・添付ファイル）を、
**あなた自身のPC上で**丸ごとエクスポートするGUI付きのオープンソースツール（Backlog exporter）です。

- バックアップや他サービスへの移行のために、Backlogのデータを手元に保存できます。
  出力は特定のサービスに依存しない汎用の形式です
- **あなたのPCの外にデータは送信されません。** ツールはローカルサーバーとしてあなたのPC上で動作し、
  Backlog APIへのアクセスもあなたのPCから直接行われます
- APIキーはメモリ内にのみ保持され、ディスクには保存されません
- 出力形式は公開仕様です（[docs/format-v1.md](docs/format-v1.md)）

## 使い方

Node.js 20以上が必要です。

```sh
npx backle
```

を実行すると、ローカルサーバー（ http://localhost:7810 ）が起動し、ブラウザが開きます。
あとは画面の指示に従ってください。

1. **接続** — Backlogのスペースドメイン（`example.backlog.jp` / `example.backlog.com`）と
   APIキーを入力します。APIキーはBacklogの「個人設定 → API」で発行できます。
   全プロジェクト・全ユーザー情報の取得には管理者権限のあるユーザーのキーを推奨します。
2. **プロジェクト選択** — エクスポートするプロジェクトを選び、添付ファイルの有無と
   出力先フォルダを指定します。
3. **実行** — 進捗が表示されます。Backlog APIのレート制限に達した場合は自動で待機します。
   途中で中断しても、同じ出力先を指定して再実行すれば続きから再開できます（レジューム対応）。
4. **完了** — 出力先フォルダにデータ一式が保存されています。

## 出力されるデータ

```
出力先/
  manifest.json        # エクスポートのメタ情報
  users.json           # ユーザー一覧
  projects/{プロジェクトキー}/
    project.json       # プロジェクト設定
    issues.jsonl       # 課題（1行1件）
    comments.jsonl     # コメント・変更履歴（1行1件）
    wikis.jsonl        # Wiki（履歴込み・1行1件）
    attachments/       # 添付ファイル
```

詳細は [docs/format-v1.md](docs/format-v1.md) を参照してください。
データはBacklog APIのレスポンスを加工せずそのまま保存するため、
バックアップとしてもツール間の移行データとしても利用できます。

## レート制限について

Backlog APIにはユーザー・API種別ごとの毎分のレート制限があります。
本ツールは起動時に制限値を動的に取得し、残リクエスト数を監視しながら実行します。
制限に達した場合はリセット時刻まで自動で待機するため、放置しておけば完了します。
（データ量の多いスペースでは数時間かかることがあります。中断・再開が可能です。）

## 開発

```sh
pnpm install
pnpm build        # サーバー + GUI をビルド
pnpm dev          # ローカルサーバー起動（要: 事前に pnpm build:gui）
pnpm dev:gui      # GUI開発サーバー（Vite。APIは :7810 にプロキシ）
pnpm test         # ユニットテスト
pnpm typecheck    # 型チェック
```

## 免責

本ツールは無保証で提供されます（MITライセンス）。
エクスポート結果の完全性は保証されません。重要なデータの移行時は、
エクスポート結果を必ずご自身で確認してください。
本ツールは株式会社ヌーラボおよびBacklogとは無関係の非公式ツールです。

## ライセンス

MIT License — Copyright (c) 2026 Kaido Iwamoto

---

# backle (English)

**backle** is an open-source GUI tool (a Backlog exporter) that exports your
[Backlog](https://backlog.com/) project data — issues, comments, wikis, and attachments —
entirely **on your own PC**.

- Save your Backlog data locally for backup or for migrating to other services.
  The output is a generic, service-independent format
- **Your data never leaves your PC.** The tool runs as a local server on your machine,
  and all Backlog API requests are made directly from your PC
- Your API key is kept in memory only and is never written to disk
- The output format is an open specification ([docs/format-v1.md](docs/format-v1.md))

## Usage

Requires Node.js 20 or later.

```sh
npx backle
```

This starts a local server ( http://localhost:7810 ) and opens your browser.
Then just follow the on-screen steps:

1. **Connect** — Enter your Backlog space domain (`example.backlog.jp` / `example.backlog.com`)
   and API key. You can issue an API key from Backlog's "Personal Settings → API".
   A key from a user with administrator privileges is recommended for exporting
   all projects and all user information.
2. **Select projects** — Choose the projects to export, whether to include attachments,
   and the output folder.
3. **Run** — Progress is displayed. When the Backlog API rate limit is reached, the tool
   waits automatically. If interrupted, re-run with the same output folder to resume
   where it left off.
4. **Done** — The exported data is saved in the output folder.

## Exported data

```
output/
  manifest.json        # export metadata
  users.json           # user list
  projects/{projectKey}/
    project.json       # project settings
    issues.jsonl       # issues (one per line)
    comments.jsonl     # comments and change logs (one per line)
    wikis.jsonl        # wikis with history (one per line)
    attachments/       # attachment files
```

See [docs/format-v1.md](docs/format-v1.md) for details.
Data is saved as-is from the Backlog API responses without transformation,
so it works both as a backup and as migration data between tools.

## Rate limits

The Backlog API has per-user, per-category rate limits per minute.
This tool fetches the limits dynamically at startup and monitors the remaining
request count while running. When the limit is reached, it automatically waits
until the reset time, so you can leave it running until it completes.
(Large spaces may take several hours. Interruption and resumption are supported.)

## Development

```sh
pnpm install
pnpm build        # build server + GUI
pnpm dev          # start local server (run pnpm build:gui first)
pnpm dev:gui      # GUI dev server (Vite; API proxied to :7810)
pnpm test         # unit tests
pnpm typecheck    # type check
```

## Disclaimer

This tool is provided as-is, without warranty of any kind (MIT License).
Completeness of the exported data is not guaranteed. When migrating important data,
always verify the export results yourself.
This is an unofficial tool, unaffiliated with Nulab Inc. or Backlog.

## License

MIT License — Copyright (c) 2026 Kaido Iwamoto
