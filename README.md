# スケジュール管理Webアプリ

シンプルで使いやすいスケジュール管理アプリケーションです。Firebase Realtime Databaseを使用してクラウド保存とリアルタイム同期を実現しています。

## 🌟 特徴

- **シンプルな設計**: 素のHTML/CSS/JavaScriptで構築
- **クラウド保存**: Firebase Realtime Databaseを使用
- **リアルタイム同期**: 複数デバイス間での自動同期
- **レスポンシブデザイン**: モバイル・タブレット・デスクトップ対応
- **直感的なUI**: 日次・週次ビューでの予定管理

## 📋 機能

### 基本機能
- ✅ 予定の追加・編集・削除
- ✅ 日次ビュー（時間軸表示）
- ✅ 週次ビュー（7日間表示）
- ✅ 日付ナビゲーション
- ✅ 色分けによる予定の視覚的区別
- ✅ リアルタイムデータ同期

### 技術仕様
- **フロントエンド**: HTML5, CSS3, Vanilla JavaScript
- **データベース**: Firebase Realtime Database
- **認証**: Firebase Authentication（匿名認証）
- **SDK**: Firebase v11.6.0
- **レスポンシブ**: CSS Grid/Flexbox
- **ブラウザ対応**: Chrome, Firefox, Safari, Edge

## 🚀 セットアップ

### 1. Firebase プロジェクトの作成

このアプリは既に以下のFirebaseプロジェクトに接続されています：
- **プロジェクトID**: `study-mgr`
- **Database URL**: `https://study-mgr-default-rtdb.firebaseio.com`

### 2. Firebase Console での設定

#### 2-1. Authentication を有効化

1. [Firebase Console](https://console.firebase.google.com/) にアクセス
2. プロジェクト `study-mgr` を選択
3. 左メニューから「Authentication」をクリック
4. 「始める」ボタンをクリック
5. 「サインイン方法」タブをクリック
6. 「匿名」をクリック
7. 「有効にする」をクリック
8. 「保存」をクリック

#### 2-2. Realtime Database を作成

1. 左メニューから「Realtime Database」をクリック
2. 「データベースを作成」をクリック
3. ロケーション: `us-central1` を選択
4. セキュリティルール: 「テストモードで開始」を選択
5. 「有効にする」をクリック

#### 2-3. セキュリティルールの設定

1. Realtime Database の「ルール」タブをクリック
2. 以下のルールに置き換え：

```json
{
  "rules": {
    "events": {
      "$userId": {
        ".read": "auth != null && auth.uid == $userId",
        ".write": "auth != null && auth.uid == $userId"
      }
    }
  }
}
```

3. 「公開」をクリック

### 3. アプリの起動

#### ローカルサーバーで起動（推奨）

```bash
# ディレクトリに移動
cd schedule_mgr

# Python 3の場合
python3 -m http.server 8000

# または Node.jsの場合
npx serve .
```

#### ブラウザでアクセス

```
http://localhost:8000
```

> **注意**: `file://` プロトコルではFirebaseが動作しない場合があります。必ずローカルサーバーを使用してください。

## 📖 使い方

### 予定の追加

1. 「+ 予定追加」ボタンをクリック
2. フォームに情報を入力
   - タイトル（必須、最大100文字）
   - 説明（任意、最大500文字）
   - 開始時刻（必須）
   - 終了時刻（必須）
   - 色（6色から選択）
3. 「保存」ボタンをクリック

### 予定の編集

1. 既存の予定をクリック
2. フォームで情報を編集
3. 「保存」ボタンをクリック

### 予定の削除

1. 予定をクリックして編集モードに
2. 「削除」ボタンをクリック
3. 確認ダイアログで「OK」を選択

### ビューの切り替え

- **日次ビュー**: 時間軸で予定を表示（0時〜23時）
- **週次ビュー**: 7日間の予定を一覧表示（日〜土）

### 日付ナビゲーション

- **←**: 前日/前週に移動
- **→**: 翌日/翌週に移動
- **今日**: 今日の日付に戻る

## 🗂️ ファイル構成

```
schedule_mgr/
├── index.html      # メインHTML（Firebase SDK読み込み、UI構造）
├── styles.css      # スタイルシート（レスポンシブデザイン）
├── app.js          # メインロジック（Firebase連携、UI制御）
├── README.md       # このファイル
└── 企画書.md       # 詳細企画書
```

## 📊 データモデル

### Event オブジェクト

```javascript
{
  id: string,           // ユニークID（Firebaseが自動生成）
  title: string,        // 予定のタイトル（最大100文字）
  description: string,  // 詳細説明（最大500文字）
  startTime: string,    // 開始時刻（ISO 8601形式）
  endTime: string,      // 終了時刻（ISO 8601形式）
  color: string,        // カラーコード（#RRGGBB）
  userId: string,       // ユーザーID
  createdAt: string,    // 作成日時
  updatedAt: string     // 更新日時（更新時のみ）
}
```

### Firebase Database 構造

```
events/
  └── {userId}/
      ├── {eventId1}/
      │   ├── title: "会議"
      │   ├── description: "プロジェクト進捗報告"
      │   ├── startTime: "2025-10-20T10:00"
      │   ├── endTime: "2025-10-20T11:00"
      │   ├── color: "#3b82f6"
      │   ├── userId: "abc123xyz"
      │   └── createdAt: "2025-10-20T09:00:00.000Z"
      └── {eventId2}/
          └── ...
```

## 🔧 トラブルシューティング

### Firebase接続エラー

**症状**: 「Firebase接続エラーが発生しました」というアラートが表示される

**解決方法**:
1. Firebase Console で Authentication が有効化されているか確認
2. 匿名認証が有効になっているか確認
3. インターネット接続を確認
4. ブラウザのコンソールでエラーメッセージを確認

### データが保存されない

**症状**: 予定を追加しても表示されない

**解決方法**:
1. Realtime Database が作成されているか確認
2. セキュリティルールが正しく設定されているか確認
3. ブラウザのコンソールでエラーメッセージを確認
4. ページをリロードして再試行

### 表示が崩れる

**症状**: レイアウトが正しく表示されない

**解決方法**:
1. ブラウザのキャッシュをクリア
2. 推奨ブラウザ（Chrome, Firefox, Safari, Edge）を使用
3. JavaScriptが有効になっているか確認

### 認証エラー

**症状**: 「認証が必要です」というメッセージが表示される

**解決方法**:
1. Firebase Console で Authentication が有効か確認
2. 匿名認証が有効になっているか確認
3. ページをリロード
4. ブラウザのコンソールで詳細なエラーを確認

## 🔒 セキュリティ

### Firebase セキュリティルール

- ユーザーは自分のデータのみ読み書き可能
- 認証が必須
- ユーザーIDによるデータ分離

### プライバシー

- 匿名認証を使用（メールアドレス不要）
- データは暗号化されてFirebaseに保存
- ユーザー間でデータは共有されません

## 🌐 デプロイ

### Firebase Hosting（推奨）

```bash
# Firebase CLIをインストール
npm install -g firebase-tools

# Firebaseにログイン
firebase login

# プロジェクトを初期化
firebase init hosting

# デプロイ
firebase deploy --only hosting
```

### その他のホスティング

- Netlify
- Vercel
- GitHub Pages
- 任意のWebサーバー

## 💰 コスト

### Firebase 無料枠（Spark プラン）

- Realtime Database: 1GB ストレージ、10GB/月 転送
- Authentication: 無制限
- Hosting: 10GB ストレージ、360MB/日 転送

**想定利用**: 通常の個人利用では無料枠で十分です。

## 🔮 今後の拡張予定

- [ ] 月次ビューの追加
- [ ] 予定の検索機能
- [ ] カテゴリー/タグ機能
- [ ] 繰り返しイベント
- [ ] リマインダー機能
- [ ] データのエクスポート/インポート
- [ ] メール/Google認証
- [ ] 共有カレンダー

## 📄 ライセンス

MIT License

## 👤 作成者

スケジュール管理アプリ開発チーム

## 📞 サポート

問題が発生した場合は、以下を確認してください：
1. Firebase Console の設定
2. ブラウザのコンソールのエラーメッセージ
3. このREADMEのトラブルシューティングセクション

---

**最終更新**: 2025年10月20日  
**バージョン**: 1.0

