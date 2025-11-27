# Firebase Realtime Database セキュリティルール設定

## 問題
アプリが `/events` パスへのアクセスを拒否されています。これは Firebase Realtime Database のセキュリティルールがデフォルトで認証を要求しているためです。

## 解決方法

### 1. Firebase Console にアクセス
1. [Firebase Console](https://console.firebase.google.com/) にアクセス
2. プロジェクト `schedule-mgr-b16fb` を選択

### 2. Realtime Database のルールを更新
1. 左側メニューから **Realtime Database** を選択
2. **ルール** タブをクリック
3. 以下のルールをコピー＆ペースト：

```json
{
  "rules": {
    "events": {
      ".read": true,
      ".write": true
    }
  }
}
```

### 3. ルールを公開
1. **公開** ボタンをクリック
2. 確認ダイアログで **公開** をクリック

## セキュリティに関する注意

⚠️ **重要**: 上記のルールは `/events` パスへの読み書きを誰でも許可します。これは個人用アプリには適していますが、以下の点に注意してください：

- データベース URL を知っている人は誰でもデータを読み書きできます
- 本番環境で使用する場合は、認証を追加することを検討してください

### より安全な設定（オプション）

認証を使用する場合は、以下のようなルールを使用できます：

```json
{
  "rules": {
    "events": {
      ".read": "auth != null",
      ".write": "auth != null"
    }
  }
}
```

この場合、Firebase Authentication を設定し、ユーザーがログインする必要があります。

