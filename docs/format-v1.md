# bckle 出力形式 v1（公開仕様）

**形式バージョン: 1**

bckle が出力するエクスポートデータの形式仕様です。
この形式は公開仕様であり、後方互換を保ちながら発展させます。
形式に非互換な変更を行う場合はバージョン番号を上げます。

## ディレクトリ構成

```
export/
  manifest.json        # エクスポートのメタ情報
  users.json           # スペースのユーザー一覧
  projects/
    {projectKey}/
      project.json     # プロジェクト設定・種別・状態・カテゴリ・バージョン・カスタム属性定義
      issues.jsonl     # 1行1課題
      comments.jsonl   # 1行1コメント（変更履歴 changeLog を含む）
      wikis.jsonl      # 1行1Wikiページ（履歴込み）
      attachments/     # 添付ファイル（オプション）
        {issueKey}/{attachmentId}_{filename}
        {wikiId}/{attachmentId}_{filename}
```

## 設計方針

- **生データ保持**: 各レコードは Backlog API v2 のレスポンス JSON をそのまま保持します。
  Backlog記法からMarkdownへの変換などの加工は行いません（バックアップとしての価値を保つため）。
- **JSONL**: 課題・コメント・Wikiは1行1レコードのJSON Lines形式です。件数が多くても逐次処理できます。
- **文字コード**: すべて UTF-8。

## 各ファイルの内容

### manifest.json

```json
{
  "formatVersion": "1",
  "tool": { "name": "bckle", "version": "0.1.0" },
  "exportedAt": "2026-08-31T12:00:00.000Z",
  "space": { "domain": "example.backlog.jp", "spaceKey": "example", "name": "..." },
  "options": { "includeAttachments": true },
  "projects": ["PROJ1", "PROJ2"],
  "usersScope": "space"
}
```

- `formatVersion`: この仕様のバージョン。文字列。
- `space`: `GET /api/v2/space` のレスポンスに `domain` を追加したもの。
- `projects`: エクスポート対象のプロジェクトキー一覧。
- `usersScope`: users.json の取得範囲。`"space"`（スペース全体）または
  `"projectMembers"`（権限不足によるフォールバック。エクスポート対象プロジェクトのメンバーのみ）。

### users.json

`GET /api/v2/users` のレスポンス（配列）そのまま。
APIキーの権限が管理者でない場合、`mailAddress` が取得できないことがあります。
また、スペース全体のユーザー一覧の取得には管理者権限が必要なため、権限がない場合は
エクスポート対象プロジェクトのメンバー一覧（`GET /api/v2/projects/:key/users` の和集合）に
フォールバックします（manifest の `usersScope` が `"projectMembers"` になります）。

### projects/{projectKey}/project.json

以下のキーを持つオブジェクト。各値は対応するAPIのレスポンスそのまま。

| キー | API |
|---|---|
| `project` | `GET /api/v2/projects/:projectIdOrKey` |
| `issueTypes` | `GET /api/v2/projects/:projectIdOrKey/issueTypes` |
| `categories` | `GET /api/v2/projects/:projectIdOrKey/categories` |
| `versions` | `GET /api/v2/projects/:projectIdOrKey/versions` |
| `customFields` | `GET /api/v2/projects/:projectIdOrKey/customFields` |
| `statuses` | `GET /api/v2/projects/:projectIdOrKey/statuses` |

### projects/{projectKey}/issues.jsonl

1行につき1課題。`GET /api/v2/issues`（一覧）のレスポンス要素そのまま。
`sort=created&order=asc` で取得するため、作成日時昇順に並びます。
一覧レスポンスにはカスタム属性（`customFields`）と添付メタ情報（`attachments`）が含まれます。

### projects/{projectKey}/comments.jsonl

1行につき1コメント。`GET /api/v2/issues/:issueIdOrKey/comments` のレスポンス要素に、
どの課題のコメントかを示す `issueKey` と `issueId` を追加したもの。

```json
{ "issueKey": "PROJ1-123", "issueId": 1234567, "id": 111, "content": "...", "changeLog": [...], ... }
```

課題の変更履歴は Backlog API の仕様上コメントの `changeLog` に含まれます
（本文のないコメント＝変更のみの操作もコメントとして記録されます）。

### projects/{projectKey}/wikis.jsonl

1行につき1Wikiページ。`GET /api/v2/wikis/:wikiId`（本文付き）のレスポンスに
`history`（`GET /api/v2/wikis/:wikiId/history` のレスポンス＝全版の本文付き履歴）を追加したもの。

### projects/{projectKey}/attachments/

- 課題の添付: `attachments/{issueKey}/{attachmentId}_{filename}`
- Wikiの添付: `attachments/{wikiId}/{attachmentId}_{filename}`

ファイル名に含まれるパス区切り文字などは `_` に置換されます。
`--添付を含めない` 設定でエクスポートした場合、このディレクトリは作成されません。

## 進捗ファイル（progress.json）

エクスポート実行中は出力先直下に `progress.json` が置かれ、中断時のレジュームに使われます。
**エクスポート正常完了時には削除されるため、完成したエクスポートには含まれません。**
このファイルが残っている場合、そのエクスポートは未完了です。

## 互換性ポリシー

- 同一メジャーバージョン内では、フィールドの追加のみ行います（削除・意味変更はしない）。
- 読み取り側は未知のフィールドを無視してください。
