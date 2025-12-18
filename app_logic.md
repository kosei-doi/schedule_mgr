# スケジュール管理アプリ詳細ロジック

## 概要

このスケジュール管理アプリは、Firebase Realtime DatabaseとGoogle Calendarを連携させたWebアプリケーションです。主な機能として、スケジュールのCRUD操作、複数ビュー表示、重複削除処理、リアルタイム同期などが実装されています。

## アーキテクチャ概要

```mermaid
graph TB
    A[Webブラウザ] --> B[HTML/CSS/JavaScript]
    B --> C[Firebase SDK]
    B --> D[Google Calendar API]
    C --> E[(Firebase Realtime DB)]
    D --> F[Google Calendar]

    B --> G[ローカルストレージ]
    B --> H[Service Worker]

    subgraph "外部サービス"
        E
        F
    end

    subgraph "クライアントサイド"
        B
        G
        H
    end
```

## 初期化シーケンス

```mermaid
sequenceDiagram
    participant U as ユーザー
    participant B as ブラウザ
    participant F as Firebase
    participant G as Google Calendar
    participant V as ビュー

    U->>B: アプリ起動
    B->>B: DOMContentLoaded発火
    B->>B: showLoading() - ローディング開始

    B->>F: Firebase初期化待機 (最大10秒)
    alt Firebase準備完了
        F->>B: 初期化成功
        B->>F: loadEvents() - 全イベント取得
        F->>B: イベントデータ返却
        B->>B: deduplicateFirebaseEvents() - 重複削除
        B->>B: updateViews() - ビュー更新

        B->>G: fetchGoogleCalendarEvents() - Googleイベント取得
        G->>B: Googleイベント返却
        B->>G: syncEventsToGoogleCalendar() - 同期実行
        G->>B: 同期完了

        B->>B: setupEventListeners() - イベントリスナー設定
        B->>B: startAutomaticGoogleSync() - 自動同期開始
        B->>B: hideLoading() - ローディング終了
    else Firebase初期化失敗
        F->>B: 初期化失敗
        B->>B: hideLoading() + エラーメッセージ表示
    end
```

## CRUD操作フロー

### Create操作（イベント作成）

```mermaid
flowchart TD
    A[ユーザークリック/フォーム送信] --> B{終日イベント?}
    B -->|はい| C[openAllDayCreateModal]
    B -->|いいえ| D[通常モーダル表示]

    C --> E[日付入力フィールド表示]
    D --> F[時間入力フィールド表示]

    E --> G[フォーム入力]
    F --> G

    G --> H{バリデーション}
    H -->|成功| I[addEvent() - Firebase保存]
    H -->|失敗| J[エラーメッセージ表示]

    I --> K{Google同期設定?}
    K -->|はい| L[mirrorMutationsToGoogle - Google保存]
    K -->|いいえ| M[ローカル保存完了]

    L --> N[リアルタイムリスナー発火]
    M --> N

    N --> O[UI更新 + 成功メッセージ]
```

### Update操作（イベント編集）

```mermaid
flowchart TD
    A[イベントクリック] --> B[showEventModal - 編集モード]
    B --> C[既存データ読み込み]
    C --> D{終日イベント?}

    D -->|はい| E[日付フィールド表示 + 時間フィールド非表示]
    D -->|いいえ| F[時間フィールド表示 + 日付フィールド非表示]

    E --> G[データ編集]
    F --> G

    G --> H{変更検知}
    H -->|変更なし| I[モーダル閉じる]
    H -->|変更あり| J[バリデーション]

    J -->|成功| K[updateEvent() - Firebase更新]
    J -->|失敗| L[エラーメッセージ表示]

    K --> M{Google同期設定?}
    M -->|はい| N[mirrorMutationsToGoogle - Google更新]
    M -->|いいえ| O[ローカル更新完了]

    N --> P[リアルタイムリスナー発火]
    O --> P

    P --> Q[UI更新 + 成功メッセージ]
```

## データ同期ロジック

### Firebase-Google Calendar同期フロー

```mermaid
flowchart TD
    A[Firebaseイベント] --> B[buildSyncEventPayload変換]
    B --> C{終日イベント?}

    C -->|はい| D[startDate/endDate形式]
    C -->|いいえ| E[startDateTime/endDateTime形式]

    D --> F[Google Calendar API送信]
    E --> F

    F --> G{APIレスポンス}
    G -->|成功| H[同期完了]
    G -->|失敗| I[エラーログ + ロールバック]

    H --> J[UI更新通知]
    I --> K[Firebaseデータ保持]
```

### 重複削除処理

```mermaid
flowchart TD
    A[イベント配列] --> B[日付+タイトルでグループ化]
    B --> C{グループ数 > 1?}

    C -->|はい| D[Google優先イベント選択]
    C -->|いいえ| E[次のグループへ]

    D --> F{Googleイベント存在?}
    F -->|はい| G[Googleイベント残す + ローカル削除]
    F -->|いいえ| H[最新のローカルイベント残す + 他削除]

    G --> I[Firebase削除実行]
    H --> I

    I --> J[削除カウント更新]
    J --> K{全グループ処理完了?}
    K -->|いいえ| L[次のグループ]
    K -->|はい| M[処理完了 + UI更新]
```

## UI状態遷移

```mermaid
stateDiagram-v2
    [*] --> 初期化中: アプリ起動
    初期化中 --> 準備完了: Firebase初期化成功
    初期化中 --> エラー: Firebase初期化失敗

    準備完了 --> 日次ビュー: デフォルトビュー
    準備完了 --> 週次ビュー: ビューボタンクリック
    準備完了 --> 月次ビュー: ビューボタンクリック

    日次ビュー --> イベント作成: クリック/タップ
    週次ビュー --> イベント作成
    月次ビュー --> イベント作成

    イベント作成 --> モーダル表示: フォーム表示
    モーダル表示 --> バリデーション: 保存ボタンクリック
    バリデーション --> 保存成功: バリデーション通過
    バリデーション --> エラー表示: バリデーション失敗

    保存成功 --> 同期中: Google同期設定時
    保存成功 --> 表示更新: 同期なし

    同期中 --> 表示更新: 同期完了
    表示更新 --> 日次ビュー: ビュー維持
    表示更新 --> 週次ビュー
    表示更新 --> 月次ビュー

    エラー --> [*]: ページリロード
```

## データ構造

### イベントオブジェクト構造

```mermaid
classDiagram
    class Event {
        +String id
        +String title
        +String description
        +String startTime
        +String endTime
        +Boolean allDay
        +String color
        +String recurrence
        +String recurrenceEnd
        +Number reminderMinutes
        +String source
        +Boolean isTimetable
        +String createdAt
        +String updatedAt
    }

    class FirebaseEvent {
        +String id
        +String title
        +String description
        +String startTime
        +String endTime
        +Boolean allDay
        +String color
        +String recurrence
        +String recurrenceEnd
        +Number reminderMinutes
        +String source
        +Boolean isGoogleImported
        +String googleEventId
        +String externalUpdatedAt
        +Boolean isTimetable
        +String createdAt
        +String updatedAt
        +String lastWriteClientId
    }

    Event <|-- FirebaseEvent
```

## 主要関数一覧

### 初期化関連
- `DOMContentLoaded` イベントハンドラ
- `waitForFirebase()` - Firebase初期化待機
- `loadEvents()` - Firebaseからイベント読み込み
- `setupEventListeners()` - UIイベント設定

### CRUD操作
- `addEvent()` - イベント作成
- `updateEvent()` - イベント更新
- `deleteEvent()` - イベント削除

### データ同期
- `mirrorMutationsToGoogle()` - Google Calendar同期
- `fetchGoogleCalendarEvents()` - Googleからイベント取得
- `syncEventsToGoogleCalendar()` - Firebase→Google同期
- `deduplicateFirebaseEvents()` - 重複削除

### UI関連
- `updateViews()` - 全ビュー更新
- `renderDayView()` - 日次ビュー描画
- `renderWeekView()` - 週次ビュー描画
- `renderMonthView()` - 月次ビュー描画
- `populateEventElement()` - イベント要素生成

### ユーティリティ
- `calculateMaxCharsForWidth()` - 表示幅に基づく文字数計算
- `formatDateTimeLocal()` - 日時フォーマット
- `isAllDayEvent()` - 終日イベント判定
- `validateEvent()` - イベントバリデーション

## エラーハンドリング

### Firebaseエラー
- 初期化失敗 → ページリロード促し
- 保存失敗 → エラーメッセージ表示
- 削除失敗 → エラーメッセージ表示

### Google Calendarエラー
- API呼び出し失敗 → silentモードでログ出力
- 同期失敗 → Firebaseデータは保持

### UIエラー
- 無効な入力 → バリデーションメッセージ
- ネットワークエラー → 適切なエラーメッセージ

## パフォーマンス最適化

### ビュー更新最適化
- `updateViewsForEvent()` - 個別イベントのみ更新
- リアルタイムリスナー - 変更されたデータのみ反映

### データ処理最適化
- 日付範囲フィルタリング - 表示範囲外データ除外
- 重複チェック - メモ化による高速化

### メモリ管理
- イベントリスナーの適切な解除
- Firebaseリスナーのクリーンアップ
- 不要データの定期削除

このロジックにより、高性能で信頼性の高いスケジュール管理アプリケーションが実現されています。
