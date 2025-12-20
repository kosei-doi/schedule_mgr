# 新規イベント追加の詳細フロー

## 概要

このフローチャートは、`addEvent` 関数における新規イベント追加の詳細な処理過程を示しています。トランザクション的な同期処理により、Google Calendar との同期が成功した場合のみイベントが Firebase に保存されます。

```mermaid
flowchart TD
    A[addEvent関数呼び出し] --> B[オプション設定]
    B --> C["syncGoogle = true\nデフォルト"]

    C --> D["Firebase準備待機\nwaitForFirebase()"]
    D --> E{Firebase準備完了?}
    E -->|No| F["エラーメッセージ表示\n'Firebase初期化タイムアウト'"]
    F --> G[null返却]

    E -->|Yes| H["イベントデータ正規化\nnormalizeEventDateTimeString"]
    H --> I["newEventオブジェクト作成\nstartTime, endTime, allDay,\nsource, googleEventId,\nisGoogleImported, etc."]

    I --> J["Firebase有効性チェック\nisFirebaseEnabled && window.firebase?.db"]
    J -->|No| K["エラーメッセージ表示\n'Firebaseが無効'"]
    K --> L[null返却]

    J -->|Yes| M["Firebase参照取得\nref(window.firebase.db, 'events')"]
    M --> N["Firebase push実行\npush(eventsRef)"]
    N --> O[newEventRef作成]
    O --> P["newId = newEventRef.key 取得"]

    P --> Q{newId存在確認}
    Q -->|No| R["Error投げ\n'Firebase push failed'"]
    R --> S[全体catch処理]

    Q -->|Yes| T["Google同期必要?\nsyncGoogle && !isTimetable"]
    T -->|No| U["Firebase直接保存\nset(newEventRef, payload)"]
    U --> V[newId返却]

    T -->|Yes| W["Google同期実行\nmirrorMutationsToGoogle"]
    W --> X{同期成功?}
    X -->|Yes| Y["Firebase保存\nset(newEventRef, payload)"]
    Y --> V

    X -->|No| Z["同期エラーメッセージ表示\n'Google Calendar同期失敗' or\n'イベント同期失敗'"]
    Z --> AA["Error投げ\n'Google sync failed'"]
    AA --> S

    V --> AB[処理完了]

    S --> AC["エラーメッセージ表示\n'イベント保存失敗'"]
    AC --> AD[null返却]
    AD --> AB

    AB --> AE[関数終了]

    %% スタイル定義
    classDef successClass fill:#d4edda,stroke:#155724,color:#155724
    classDef errorClass fill:#f8d7da,stroke:#721c24,color:#721c24
    classDef processClass fill:#fff3cd,stroke:#856404,color:#856404
    classDef decisionClass fill:#cce5ff,stroke:#004085,color:#004085

    class A,B,C,H,I,M,N,O,P,U,Y,V,AB successClass
    class F,K,R,Z,AA,S,AC,AD errorClass
    class D,W processClass
    class E,J,Q,T,X decisionClass
```

## フローの詳細説明

### 1. 初期化フェーズ
- **オプション設定**: `syncGoogle = true` (デフォルトでGoogle同期有効)
- **Firebase準備待機**: Firebase SDKの初期化完了を待機
- **イベントデータ正規化**: `startTime` と `endTime` の日時文字列を正規化
- **newEventオブジェクト作成**: イベントの全プロパティを設定（タイムスタンプ、クライアントIDなど）

### 2. Firebase 準備フェーズ
- **Firebase有効性チェック**: Firebaseが有効でデータベース参照が取得可能か確認
- **参照取得**: `events` パスのFirebase参照を取得
- **Push実行**: 新しいイベント用の参照を生成（キーは自動生成）
- **ID取得**: 生成されたFirebaseキー（`newId`）を取得

### 3. 同期判定フェーズ
- **同期必要判定**: Google同期が必要かチェック
  - `syncGoogle` が `true` かつ `isTimetable` が `false` の場合のみ同期実行
- **同期不要の場合**: 直接Firebaseに保存して終了

### 4. Google同期フェーズ（トランザクション的）
- **Google同期実行**: `mirrorMutationsToGoogle` でGoogle Calendarにイベントを同期
- **同期成功時**: Firebaseにイベントデータを保存
- **同期失敗時**: Firebaseに保存せず、エラーメッセージを表示して処理中断

### 5. エラーハンドリング
- **全体catch**: 予期せぬエラーをキャッチし、一般的なエラーメッセージを表示
- **同期固有エラー**: Google同期失敗時に具体的なエラーメッセージを表示

## 重要な特徴

1. **トランザクション性**: Google同期が成功した場合のみイベントが確定（Firebase保存）
2. **エラー分離**: 同期失敗時はFirebaseに保存されず、状態の一貫性が保たれる
3. **柔軟な同期制御**: オプションでGoogle同期を無効化可能
4. **詳細なエラーハンドリング**: エラーの種類に応じた適切なメッセージ表示

このフローにより、新規追加イベントは既存イベントと同じ「Google Calendar同期済み」状態を保証します。
