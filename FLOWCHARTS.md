# データ初期化・更新フローチャート

## 1. アプリケーション初期化フロー

```mermaid
flowchart TD
    Start([DOMContentLoaded]) --> Firebase[Firebase接続チェック]
    Firebase --> Setup[UI設定<br/>リスナー/グリッド有効化]
    Setup --> LoadData[Firebaseデータ読み込み<br/>Events + Meals + Combi]
    LoadData --> UpdateView1[初回ビュー更新]
    UpdateView1 --> BgSync[バックグラウンド: Google同期]
    BgSync --> CheckChange{変更あり?}
    CheckChange -->|Yes| UpdateView2[ビュー更新]
    CheckChange -->|No| End([完了])
    UpdateView2 --> End
```

## 2. リアルタイム更新フロー（Firebaseリスナー）

```mermaid
flowchart TD
    Start([Firebaseデータ変更]) --> Type{変更種別}
    Type -->|追加| Add[events配列に追加<br/>部分更新]
    Type -->|更新| Update{日付変更?}
    Type -->|削除| Remove[events配列から削除<br/>要素削除]
    Update -->|Yes| FullUpdate[全ビュー更新]
    Update -->|No| PartialUpdate[部分更新]
    Add --> Notif[通知スケジュール更新]
    PartialUpdate --> Notif
    FullUpdate --> Notif
    Remove --> Notif
    Notif --> End([完了])
```

## 3. ビュー更新フロー（updateViews）

```mermaid
flowchart TD
    Start([updateViews呼び出し]) --> Loading{ローディング表示中?}
    Loading -->|No| Show[ローディング表示]
    Loading -->|Yes| Render
    Show --> Render[ビュー描画<br/>Day/Week/Month]
    Render --> Notif[通知スケジュール更新]
    Notif --> Hide{ローディング表示<br/>必要なし?}
    Hide -->|Yes| HideLoading[ローディング非表示]
    Hide -->|No| End
    HideLoading --> End([完了])
```

## 4. 部分更新フロー（updateViewsForEvent）

```mermaid
flowchart TD
    Start([updateViewsForEvent呼び出し]) --> Find[イベント検索]
    Find --> Exists{イベント存在?}
    Exists -->|No| Remove[要素削除]
    Exists -->|Yes| View{現在のビュー}
    View -->|Day/Week| Partial[該当日のみ再描画]
    View -->|Month| Recreate[該当セル再作成]
    Partial --> Notif[通知スケジュール更新]
    Recreate --> Notif
    Remove --> Notif
    Notif --> End([完了])
```

## 5. データ読み込みフロー（loadEvents）

```mermaid
flowchart TD
    Start([loadEvents呼び出し]) --> Get[Firebaseから取得<br/>Events + Shifts]
    Get --> Convert[シフトをイベントに変換]
    Convert --> Merge[イベント統合・重複削除]
    Merge --> Listeners[リアルタイムリスナー設定<br/>Added/Changed/Removed]
    Listeners --> End([完了])
```

## 6. Google同期フロー（バックグラウンド）

```mermaid
flowchart TD
    Start([バックグラウンド同期]) --> Fetch[Googleカレンダー取得]
    Fetch --> Merge[Googleイベント統合]
    Merge --> Sync[Firebase→Google同期]
    Sync --> Change{変更あり?}
    Change -->|Yes| Update[ビュー更新]
    Change -->|No| End([完了])
    Update --> End
```

## 7. Combi同期フロー

```mermaid
flowchart TD
    Start([performInitialCombiSync]) --> Timetable[時間割イベント同期]
    Timetable --> Tasks[タスクイベント同期]
    Tasks --> Initial{初回同期?}
    Initial -->|Yes| Skip[ビュー更新スキップ]
    Initial -->|No| Update[ビュー更新]
    Skip --> End([完了])
    Update --> End
```
