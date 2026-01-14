# スケジュール管理アプリ

Firebase Realtime DatabaseとGoogle Calendarを連携したスケジュール管理アプリケーション。

## 📚 ドキュメント

### 主要ドキュメント

1. **[LOGIC_ORGANIZATION.md](./LOGIC_ORGANIZATION.md)** - 全ロジックの詳細整理
   - アーキテクチャ概要
   - データ構造
   - 各機能の詳細説明
   - 関数一覧と処理フロー

2. **[FLOWCHARTS.md](./FLOWCHARTS.md)** - フローチャート
   - 初期化フロー
   - リアルタイム更新フロー
   - ビュー更新フロー
   - 同期フロー

## 🏗️ アーキテクチャ

```
index.html (UI)
    ↓
app.js (ロジック)
    ↓
Firebase Realtime Database
    ↓
Google Calendar (同期)
```

## 🔑 主要機能

### 1. イベント管理
- イベントの追加/編集/削除
- 終日イベント対応
- 繰り返しイベント対応
- 通知設定

### 2. ビュー表示
- **日次ビュー**: 1日のスケジュールを時間軸で表示
- **週次ビュー**: 1週間のスケジュールを表示
- **月次ビュー**: 1ヶ月のスケジュールをカレンダー形式で表示

### 3. データ統合
- **Firebase Events**: メインのイベントデータ
- **Shifts**: シフト管理アプリ（pt）からのデータ
- **Meals**: 食事管理アプリ（diet_mgr）からのデータ
- **Combi**: 学習管理アプリからのデータ
  - 時間割イベント
  - タスクイベント

### 4. 同期機能
- **Google Calendar**: 双方向同期
  - Firebase → Google: 5分間隔で自動同期
  - Google → Firebase: 5分間隔で自動取得
- **Combi**: リアルタイム同期
  - 学期データ変更時に自動同期
  - タスクデータ変更時に自動同期

## 📁 ファイル構成

```
scdl_mgr/
├── index.html          # UI構造
├── app.js             # メインロジック（約6,000行）
├── styles.css         # スタイル定義
├── README.md          # このファイル
├── LOGIC_ORGANIZATION.md  # ロジック詳細ドキュメント
└── FLOWCHARTS.md      # フローチャート
```

## 🚀 クイックスタート

### 初期化フロー

1. **DOMContentLoaded**
   - Firebase接続チェック
   - UI設定（イベントリスナー、グリッド有効化）
   - 自動同期設定

2. **データ読み込み**（非同期）
   - `loadEvents()`: イベント読み込み
   - `loadMealData()`: 食事データ読み込み
   - `integrateMealEvents()`: 食事イベント統合
   - `performInitialCombiSync()`: Combi初回同期

3. **ビュー更新**
   - `updateViews()`: 初回ビュー描画

4. **バックグラウンド同期**
   - Google Calendar同期（5秒後）

## 🔄 データフロー

### リアルタイム更新

```
Firebase変更
  ↓
onChildAdded/Changed/Removed
  ↓
events配列更新
  ↓
updateViews() または updateViewsForEvent()
  ↓
ビュー再描画
```

### 同期フロー

```
Google Calendar
  ↓
fetchGoogleCalendarEvents()
  ↓
mergeGoogleEvents()
  ↓
Firebase更新
  ↓
リアルタイムリスナー発火
  ↓
ビュー更新
```

## 🛠️ 主要関数

### データ読み込み
- `loadEvents()`: イベント読み込み
- `loadMealData()`: 食事データ読み込み
- `loadCombiData()`: Combiデータ読み込み

### ビュー描画
- `updateViews()`: 全ビュー更新
- `updateViewsForEvent()`: 部分更新
- `renderDayView()`: 日次ビュー描画
- `renderWeekView()`: 週次ビュー描画
- `renderMonthView()`: 月次ビュー描画

### イベント管理
- `addEvent()`: イベント追加
- `updateEvent()`: イベント更新
- `deleteEvent()`: イベント削除

### 同期
- `syncEventsToGoogleCalendar()`: Firebase → Google
- `fetchGoogleCalendarEvents()`: Google → Firebase
- `syncTimetableEvents()`: Combi時間割同期
- `syncTaskEvents()`: Combiタスク同期

## 📊 データ構造

### イベントオブジェクト

```javascript
{
  id: string,              // Firebase ID
  title: string,           // タイトル
  startTime: string,       // 開始時刻（ISO 8601）
  endTime: string,         // 終了時刻（ISO 8601）
  allDay: boolean,         // 終日フラグ
  description: string,     // 説明
  color: string,           // カラーコード
  source: string,          // データソース
  isTimetable: boolean,    // 時間割フラグ
  // ... その他
}
```

詳細は [LOGIC_ORGANIZATION.md](./LOGIC_ORGANIZATION.md) を参照。

## 🔍 デバッグ

### ログプレフィックス

- `[INIT:*]`: 初期化処理
- `[LOAD:*]`: データ読み込み
- `[UPDATE:*]`: ビュー更新
- `[GOOGLE:*]`: Google同期
- `[COBI:*]`: Combi同期
- `[EVENT:*]`: イベント操作

### 主要チェックポイント

1. Firebase接続: `waitForFirebase()`
2. データ読み込み: `loadEvents()` の完了
3. ビュー更新: `updateViews()` の実行
4. 同期状態: Google同期の実行状況

## 📝 注意事項

### 制約事項

1. **時間割イベント**: `isTimetable === true` のイベントは編集不可
2. **Google同期**: 時間割イベントはGoogle Calendarに同期しない
3. **重複防止**: 日付+タイトルで重複判定
4. **範囲制限**: 表示範囲外のイベントは読み込まない

### パフォーマンス

- 部分更新を活用（日付変更時のみ全更新）
- ビューキャッシュで要素再利用
- デバウンス処理で過剰な同期を防止

## 🔗 関連アプリ

- **diet_mgr**: 食事管理アプリ（食事イベント統合）
- **combi**: 学習管理アプリ（時間割・タスク統合）
- **pt**: シフト管理アプリ（シフトイベント統合）

## 📄 ライセンス

（プロジェクトのライセンス情報を記載）

---

**詳細な技術情報は [LOGIC_ORGANIZATION.md](./LOGIC_ORGANIZATION.md) を参照してください。**
