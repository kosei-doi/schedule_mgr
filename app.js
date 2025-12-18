let unsubscribeEvents = null;
let unsubscribeChildAdded = null;
let unsubscribeChildChanged = null;
let unsubscribeChildRemoved = null;

// イベントリスナーのクリーンアップ用
const eventListeners = {
  // { element, event, handler, options }
  listeners: [],
  add: function(element, event, handler, options) {
    if (!element) return null;
    element.addEventListener(event, handler, options);
    const listener = { element, event, handler, options };
    this.listeners.push(listener);
    return listener;
  },
  remove: function(listener) {
    if (!listener) return;
    try {
      listener.element.removeEventListener(listener.event, listener.handler, listener.options);
      const index = this.listeners.indexOf(listener);
      if (index > -1) {
        this.listeners.splice(index, 1);
      }
    } catch (error) {
    }
  },
  removeAll: function() {
    this.listeners.forEach(listener => {
      try {
        listener.element.removeEventListener(listener.event, listener.handler, listener.options);
      } catch (error) {
      }
    });
    this.listeners = [];
  }
};

// グローバル変数
let events = [];
let currentDate = new Date();
let currentView = 'day'; // 'day', 'week', or 'month'
let editingEventId = null;
let isFirebaseEnabled = false;
let quillEditor = null; // Quill editor instance
const clientId = (() => Date.now().toString(36) + Math.random().toString(36).slice(2))();
let messageTimeoutId = null;
let googleSyncIntervalId = null;
let googleSyncTimeoutId = null;
let googleSyncInFlight = false;
const GOOGLE_SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const INITIAL_GOOGLE_SYNC_DELAY_MS = 5 * 1000; // 5 seconds
const VISIBLE_START_HOUR = 4;
const VISIBLE_END_HOUR = 23;
const HOUR_HEIGHT_PX = 25; // フォールバック値（実際の値は動的に取得）
const MIN_EVENT_HEIGHT_PX = 15;
const VISIBLE_HOURS = VISIBLE_END_HOUR - VISIBLE_START_HOUR + 1;

// 時間スロットの実際の高さを取得（1時間分）
function getHourHeight() {
  // 日次ビューまたは週次ビューの時間スロットを探す
  const timeSlot = document.querySelector('.time-slot');
  if (timeSlot) {
    const rect = timeSlot.getBoundingClientRect();
    if (rect.height > 0) {
      return rect.height;
    }
  }
  // フォールバック: 週次ビューのday-events-containerの高さを20で割る（優先）
  const weekContainer = document.querySelector('.day-events-container');
  if (weekContainer) {
    const rect = weekContainer.getBoundingClientRect();
    if (rect.height > 0) {
      return rect.height / 20;
    }
  }
  // フォールバック: イベントコンテナの高さを20で割る（日次ビュー）
  const dayContainer = document.querySelector('.event-container');
  if (dayContainer) {
    const rect = dayContainer.getBoundingClientRect();
    if (rect.height > 0) {
      return rect.height / 20;
    }
  }
  return HOUR_HEIGHT_PX;
}

// 16進数カラーをRGBに変換
function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
}

const viewCaches = {
  day: {
    allDay: new Map(),
    timed: new Map(),
  },
  week: {
    allDay: Array.from({ length: 7 }, () => new Map()),
    timed: Array.from({ length: 7 }, () => new Map()),
  },
};

// Google Apps Script Web アプリ（POSTエンドポイント）
// デプロイ済み Google Apps Script Web アプリの URL
const GOOGLE_APPS_SCRIPT_ENDPOINT =
  window?.GAS_ENDPOINT_OVERRIDE ||
  'https://script.google.com/macros/s/AKfycbyBvGKQYGvGG7qKlwqXcWbF90kkiXOHAGieu4RJCH2-DNb1hr0bIpvhpkCjot9Ub59bxA/exec';

function showMessage(message, type = 'info', duration = 4000) {
  // 通知表示を無効化（ヘッダー下の通知は表示しない）
  // エラーのみコンソールに出力
    if (type === 'error') {
    }
  // 通知エリアは表示しない
    return;
}

// 確認モーダルを表示
function showConfirmModal(message, title = '確認') {
  return new Promise((resolve) => {
    const modal = safeGetElementById('confirmModal');
    const titleEl = safeGetElementById('confirmTitle');
    const messageEl = safeGetElementById('confirmMessage');
    const okBtn = safeGetElementById('confirmOkBtn');
    const cancelBtn = safeGetElementById('confirmCancelBtn');
    
    if (!modal || !titleEl || !messageEl || !okBtn || !cancelBtn) {
      // フォールバック: ブラウザのconfirmを使用
      resolve(confirm(message));
      return;
    }
    
    titleEl.textContent = title;
    messageEl.textContent = message;
    modal.classList.add('show');
    modal.setAttribute('aria-hidden', 'false');
    // モバイル版でスクロールバーが出ないようにbodyのoverflowを制御（CSSクラスのみで制御）
    document.body.classList.add('modal-open');
    
    let escHandler = null;
    
    const cleanup = () => {
      modal.classList.remove('show');
      modal.setAttribute('aria-hidden', 'true');
      // bodyのoverflowを元に戻す
      document.body.classList.remove('modal-open');
      okBtn.removeEventListener('click', handleOk);
      cancelBtn.removeEventListener('click', handleCancel);
      modal.removeEventListener('click', handleBackdrop);
      if (escHandler) {
        document.removeEventListener('keydown', escHandler);
        escHandler = null;
      }
    };
    
    const handleOk = () => {
      cleanup();
      resolve(true);
    };
    
    const handleCancel = () => {
      cleanup();
      resolve(false);
    };
    
    const handleBackdrop = (e) => {
      if (e.target.id === 'confirmModal') {
        handleCancel();
      }
    };
    
    // ESCキーでキャンセル
    escHandler = (e) => {
      if (e.key === 'Escape') {
        handleCancel();
      }
    };
    
    okBtn.addEventListener('click', handleOk);
    cancelBtn.addEventListener('click', handleCancel);
    modal.addEventListener('click', handleBackdrop);
    document.addEventListener('keydown', escHandler);
  });
}

// ローディングオーバーレイを表示/非表示
function showLoading(message = '処理中...') {
  const overlay = safeGetElementById('loadingOverlay');
  const textEl = overlay?.querySelector('.loading-text');
  if (overlay) {
    if (textEl) textEl.textContent = message;
    overlay.classList.remove('hidden');
  }
}

function hideLoading() {
  const overlay = safeGetElementById('loadingOverlay');
  if (overlay) {
    overlay.classList.add('hidden');
  }
}

// 安全にgetElementByIdを取得（nullチェック付き）
function safeGetElementById(id) {
  const element = document.getElementById(id);
  if (!element) {
  }
  return element;
}

// Firebase接続チェック
function checkFirebase() {
  try {
    if (typeof window.firebase !== 'undefined' && window.firebase.db) {
      isFirebaseEnabled = true;
      return true;
    }
  } catch (error) {
  }
  isFirebaseEnabled = false;
  return false;
}

// 特定のイベントが影響するビューだけを更新（日を跨ぐイベントも考慮）
function updateViewsForEvent(event) {
  if (!event || !event.id) return;
  
  const allowedRanges = getAllowedDateRanges();
  if (!isEventInAllowedRange(event, allowedRanges)) {
    // 範囲外のイベントは削除のみ処理
    if (currentView === 'day') {
      renderDayView();
    } else if (currentView === 'week') {
      renderWeekView();
    } else if (currentView === 'month') {
      renderMonthView();
    }
    scheduleAllNotifications();
    return;
  }
  
  // イベントの開始日と終了日を計算
  let eventStartDate = null;
  let eventEndDate = null;
  
  if (event.startTime) {
    if (isAllDayEvent(event)) {
      // 終日イベントの場合
      eventStartDate = new Date(event.startTime.split('T')[0]);
      eventEndDate = event.endTime ? new Date(event.endTime.split('T')[0]) : eventStartDate;
    } else {
      // 時間指定イベントの場合
      eventStartDate = new Date(event.startTime);
      eventEndDate = event.endTime ? new Date(event.endTime) : eventStartDate;
    }
  }
  
  if (!eventStartDate || Number.isNaN(eventStartDate.getTime())) {
    updateViews();
    return;
  }
  
  if (!eventEndDate || Number.isNaN(eventEndDate.getTime())) {
    eventEndDate = eventStartDate;
  }
  
  // 日次ビュー: イベントが含まれる日をチェック
  if (currentView === 'day') {
    const currentDay = new Date(currentDate);
    currentDay.setHours(0, 0, 0, 0);
    const currentDayEnd = new Date(currentDay);
    currentDayEnd.setHours(23, 59, 59, 999);
    
    // イベントの期間と現在の日が重なるかチェック
    if (eventStartDate <= currentDayEnd && eventEndDate >= currentDay) {
      renderDayView();
    }
  }
  // 週次ビュー: イベントが含まれる週をチェック
  else if (currentView === 'week') {
    const weekStart = getWeekStart(currentDate);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);
    
    // イベントの期間と現在の週が重なるかチェック
    if (eventStartDate <= weekEnd && eventEndDate >= weekStart) {
      renderWeekView();
    }
  }
  // 月次ビュー: イベントが含まれる月をチェック
  else if (currentView === 'month') {
    const currentMonth = currentDate.getMonth();
    const currentYear = currentDate.getFullYear();
    
    // イベントの開始月と終了月を取得
    const eventStartMonth = eventStartDate.getMonth();
    const eventStartYear = eventStartDate.getFullYear();
    const eventEndMonth = eventEndDate.getMonth();
    const eventEndYear = eventEndDate.getFullYear();
    
    // イベントが現在の月と重なるかチェック
    const eventStartsInMonth = eventStartYear === currentYear && eventStartMonth === currentMonth;
    const eventEndsInMonth = eventEndYear === currentYear && eventEndMonth === currentMonth;
    const eventSpansMonth = (
      (eventStartYear < currentYear || (eventStartYear === currentYear && eventStartMonth < currentMonth)) &&
      (eventEndYear > currentYear || (eventEndYear === currentYear && eventEndMonth > currentMonth))
    );
    
    if (eventStartsInMonth || eventEndsInMonth || eventSpansMonth) {
      renderMonthView();
    }
  }
  
  scheduleAllNotifications();
}

// イベントを正規化
function normalizeEventFromSnapshot(snapshot, key) {
  const payload = snapshot.val() || {};
  const normalizedStart = normalizeEventDateTimeString(payload.startTime) || payload.startTime || '';
  const normalizedEnd = normalizeEventDateTimeString(payload.endTime) || payload.endTime || '';
  return {
    ...payload,
    id: key,
    startTime: normalizedStart,
    endTime: normalizedEnd,
    allDay: payload.allDay === true,
    isTimetable: payload.isTimetable === true,
    source: payload.source || 'local',
    googleEventId: payload.googleEventId || null,
    isGoogleImported: payload.isGoogleImported === true,
    externalUpdatedAt: payload.externalUpdatedAt || null,
  };
}

// イベントを読み込む関数（差分更新版）
async function loadEvents() {
  if (!isFirebaseEnabled || !window.firebase?.db) {
    const message = 'Firebaseが無効のため、予定を読み込めません。設定を確認してください。';
    showMessage(message, 'error', 6000);
    return;
  }
  
  const allowedRanges = getAllowedDateRanges();
  logAllowedRanges('Firebase');
  
  // 既存のリスナーを解除
  if (typeof unsubscribeEvents === 'function') {
    unsubscribeEvents();
    unsubscribeEvents = null;
  }
  if (typeof unsubscribeChildAdded === 'function') {
    unsubscribeChildAdded();
    unsubscribeChildAdded = null;
  }
  if (typeof unsubscribeChildChanged === 'function') {
    unsubscribeChildChanged();
    unsubscribeChildChanged = null;
  }
  if (typeof unsubscribeChildRemoved === 'function') {
    unsubscribeChildRemoved();
    unsubscribeChildRemoved = null;
  }
  
  const eventsRef = window.firebase.ref(window.firebase.db, "events");
  
  // 初回: 全件取得
  try {
    const snapshot = await window.firebase.get(eventsRef);
    const data = snapshot.val();
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const newEvents = Object.keys(data).map(key => {
        const payload = data[key] || {};
        return normalizeEventFromSnapshot({ val: () => payload }, key);
      });
      const filteredEvents = newEvents.filter(ev => isEventInAllowedRange(ev, allowedRanges));
      events = filteredEvents;
      events.sort((a, b) => {
        const aTime = a.startTime ? new Date(a.startTime).getTime() : Infinity;
        const bTime = b.startTime ? new Date(b.startTime).getTime() : Infinity;
        if (Number.isNaN(aTime)) return 1;
        if (Number.isNaN(bTime)) return -1;
        return aTime - bTime;
      });
      
      // Firebase内の重複チェックを実行
      try {
        const { deleted } = await deduplicateFirebaseEvents();
        if (deleted > 0) {
        }
      } catch (error) {
      }
      
      updateViews();
      scheduleAllNotifications();
    } else {
      events = [];
      updateViews();
    }
  } catch (error) {
    showMessage('予定の読み込みに失敗しました。ネットワークを確認してください。', 'error', 6000);
    return;
  }
  
  // 以降: child イベントで差分更新
  unsubscribeChildAdded = window.firebase.onChildAdded(eventsRef, (snapshot) => {
    try {
    const key = snapshot.key;
    if (!key) return;
    
    const newEvent = normalizeEventFromSnapshot(snapshot, key);
    if (!isEventInAllowedRange(newEvent, allowedRanges)) return;
    
    // 既存のイベントをチェック
    const existingIndex = events.findIndex(e => e.id === key);
    if (existingIndex === -1) {
      events.push(newEvent);
      events.sort((a, b) => {
        const aTime = a.startTime ? new Date(a.startTime).getTime() : Infinity;
        const bTime = b.startTime ? new Date(b.startTime).getTime() : Infinity;
        if (Number.isNaN(aTime)) return 1;
        if (Number.isNaN(bTime)) return -1;
        return aTime - bTime;
      });
      updateViewsForEvent(newEvent);
      }
    } catch (error) {
      // エラーが発生してもアプリを停止させない
    }
  }, (error) => {
    showMessage('予定の追加に失敗しました。', 'error', 4000);
  });
  
  unsubscribeChildChanged = window.firebase.onChildChanged(eventsRef, (snapshot) => {
    try {
    const key = snapshot.key;
    if (!key) return;
    
    const updatedEvent = normalizeEventFromSnapshot(snapshot, key);
    const existingIndex = events.findIndex(e => e.id === key);
    
    if (existingIndex !== -1) {
      const oldEvent = events[existingIndex];
      // updatedAt が変わっていない場合はスキップ（無限ループ防止）
      if (oldEvent.updatedAt === updatedEvent.updatedAt && oldEvent.lastWriteClientId === updatedEvent.lastWriteClientId) {
        return;
      }
      
      events[existingIndex] = updatedEvent;
      events.sort((a, b) => {
        const aTime = a.startTime ? new Date(a.startTime).getTime() : Infinity;
        const bTime = b.startTime ? new Date(b.startTime).getTime() : Infinity;
        if (Number.isNaN(aTime)) return 1;
        if (Number.isNaN(bTime)) return -1;
        return aTime - bTime;
      });
      
      const wasInRange = isEventInAllowedRange(oldEvent, allowedRanges);
      const isInRange = isEventInAllowedRange(updatedEvent, allowedRanges);
      
      // 範囲外→範囲内、範囲内→範囲外、範囲内で日付変更の場合は更新
      if (wasInRange || isInRange) {
        updateViewsForEvent(updatedEvent);
        if (wasInRange && !isInRange) {
          // 範囲外に移動した場合、旧日付も更新
          updateViewsForEvent(oldEvent);
        }
      }
      }
    } catch (error) {
      // エラーが発生してもアプリを停止させない
    }
  }, (error) => {
    showMessage('予定の更新に失敗しました。', 'error', 4000);
  });
  
  unsubscribeChildRemoved = window.firebase.onChildRemoved(eventsRef, (snapshot) => {
    try {
    const key = snapshot.key;
    if (!key) return;
    
    const existingIndex = events.findIndex(e => e.id === key);
    if (existingIndex !== -1) {
      const removedEvent = events[existingIndex];
      events.splice(existingIndex, 1);
      updateViewsForEvent(removedEvent);
      }
    } catch (error) {
      // エラーが発生してもアプリを停止させない
    }
  }, (error) => {
    showMessage('予定の削除に失敗しました。', 'error', 4000);
  });
  
  // 統合解除関数
  unsubscribeEvents = () => {
    if (typeof unsubscribeChildAdded === 'function') {
      unsubscribeChildAdded();
      unsubscribeChildAdded = null;
    }
    if (typeof unsubscribeChildChanged === 'function') {
      unsubscribeChildChanged();
      unsubscribeChildChanged = null;
    }
    if (typeof unsubscribeChildRemoved === 'function') {
      unsubscribeChildRemoved();
      unsubscribeChildRemoved = null;
    }
  };
}

function buildSyncEventPayload(event) {
  const startIso = event.startTime ? new Date(event.startTime).toISOString() : null;
  const endIso = event.endTime ? new Date(event.endTime).toISOString() : null;
  return {
    id: event.id || null,
    title: event.title || '',
    description: event.description || '',
    location: event.location || '',
    startDateTime: startIso,
    endDateTime: endIso,
    allDay: Boolean(event.allDay),
    isTimetable: event.isTimetable === true,
    reminderMinutes:
      typeof event.reminderMinutes === 'number' && Number.isFinite(event.reminderMinutes)
        ? event.reminderMinutes
        : null,
    color: event.color || null,
  };
}

async function mirrorMutationsToGoogle({ upserts = [], deletes = [], silent = false } = {}) {
  if (!GOOGLE_APPS_SCRIPT_ENDPOINT) {
    const message = 'Google Apps Script の Web アプリ URL が設定されていません。';
    showMessage(message, 'error', 6000);
    throw new Error(message);
  }

  const filteredUpserts = Array.isArray(upserts)
    ? upserts.filter(ev => ev && ev.id && ev.isTimetable !== true)
    : [];
  // 削除はIDまたはイベントオブジェクトを受け取る
  const filteredDeletes = Array.isArray(deletes)
    ? deletes
        .filter(item => {
          if (typeof item === 'string') return item.trim().length > 0;
          if (item && typeof item === 'object' && item.id) return true;
          return false;
        })
        .map(item => {
          // 文字列の場合はそのまま、オブジェクトの場合はIDとイベント情報を含める
          if (typeof item === 'string') {
            return item;
          }
          // イベントオブジェクトの場合は、IDと日付・タイトル情報を含める
          return {
            id: item.id,
            title: item.title || '',
            startTime: item.startTime || null,
            endTime: item.endTime || null,
            allDay: item.allDay === true,
          };
        })
    : [];

  if (filteredUpserts.length === 0 && filteredDeletes.length === 0) {
    return { created: 0, updated: 0, deleted: 0, skipped: 0 };
  }

  const payload = {
    action: 'mutations',
    source: 'schedule_mgr',
    exportedAt: new Date().toISOString(),
    upserts: filteredUpserts.map(buildSyncEventPayload),
    deletes: filteredDeletes,
  };

  let response;
  try {
    response = await fetch(GOOGLE_APPS_SCRIPT_ENDPOINT, {
      method: 'POST',
      body: JSON.stringify(payload),
      mode: 'cors',
    });
  } catch (error) {
    showMessage('Googleカレンダー更新に失敗しました。ネットワークを確認してください。', 'error', 6000);
    throw error;
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    const message = `Googleカレンダー更新に失敗しました (${response.status}) ${errorText || ''}`.trim();
    showMessage(message, 'error', 6000);
    throw new Error(message);
  }

  let result;
  try {
    result = await response.json();
  } catch (error) {
    const message = 'Googleカレンダー応答の解析に失敗しました。';
    showMessage(message, 'error', 6000);
    throw error;
  }

  if (result?.success === false) {
    const message = result?.message || 'Googleカレンダー更新に失敗しました。';
    showMessage(message, 'error', 6000);
    throw new Error(message);
  }

  if (!silent) {
    showMessage('Googleカレンダーを更新しました。', 'success', 4000);
  }

  return {
    created: Number(result?.created) || 0,
    updated: Number(result?.updated) || 0,
    deleted: Number(result?.deleted) || 0,
    skipped: Number(result?.skipped) || 0,
  };
}

async function syncEventsToGoogleCalendar({ silent = false } = {}) {
  if (!GOOGLE_APPS_SCRIPT_ENDPOINT) {
    const message = 'Google Apps Script の Web アプリ URL が設定されていません。';
    if (!silent) showMessage(message, 'error', 6000);
    throw new Error(message);
  }

  const rangeSet = getAllowedDateRanges();
  logAllowedRanges('Google Sync');

  if (!isFirebaseEnabled) {
    const message = 'Firebaseとの同期完了後に再度お試しください。';
    if (!silent) showMessage(message, 'error', 6000);
    throw new Error(message);
  }
  
  if (!silent) {
    showLoading('Googleカレンダーと同期中...');
  }

  if (!Array.isArray(events) || events.length === 0) {
    if (!silent) {
      hideLoading();
      showMessage('同期対象の予定がありません。', 'info', 4000);
    }
    return { created: 0, updated: 0, skipped: 0 };
  }

  if (!Array.isArray(events)) {
    if (!silent) {
      hideLoading();
      showMessage('イベントデータが読み込まれていません。', 'error', 6000);
    }
    return { created: 0, updated: 0, skipped: 0 };
  }

  const syncableEvents = events.filter(
    ev =>
      (ev.source || 'local') !== 'google' &&
      ev.isTimetable !== true &&
      ev.startTime &&
      ev.endTime &&
      isEventInAllowedRange(ev, rangeSet)
  );
  if (syncableEvents.length === 0) {
    if (!silent) {
      hideLoading();
      showMessage('Google同期対象のローカル予定がありません。', 'info', 4000);
    }
    return { created: 0, updated: 0, skipped: 0 };
  }

  const payload = {
    source: 'schedule_mgr',
    exportedAt: new Date().toISOString(),
    eventCount: syncableEvents.length,
    events: syncableEvents.map(buildSyncEventPayload),
  };

  let response;
  try {
    response = await fetch(GOOGLE_APPS_SCRIPT_ENDPOINT, {
      method: 'POST',
      body: JSON.stringify(payload),
      mode: 'cors',
    });
  } catch (error) {
    if (!silent) {
      hideLoading();
      showMessage('Googleカレンダー同期に失敗しました。ネットワークを確認してください。', 'error', 6000);
    }
    throw error;
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    const message = `Google Apps Script 呼び出しに失敗しました (${response.status}) ${errorText || ''}`.trim();
    if (!silent) {
      hideLoading();
      showMessage(message, 'error', 6000);
    }
    throw new Error(message);
  }

  let result = null;
  try {
    result = await response.json();
  } catch (error) {
    // レスポンスがJSONでない場合はそのまま成功扱い
    if (!silent) {
      hideLoading();
      showMessage('Googleカレンダーと同期しました。', 'success', 5000);
    }
    return { created: 0, updated: 0, skipped: 0 };
  }

  const created = Number(result?.created) || 0;
  const updated = Number(result?.updated) || 0;
  const skipped = Number(result?.skipped) || 0;
  const message =
    typeof result?.message === 'string' && result.message.trim().length > 0
      ? result.message.trim()
      : 'Googleカレンダーと同期しました。';

  if (!silent) {
    hideLoading();
    showMessage(`${message} (作成:${created} / 更新:${updated} / スキップ:${skipped})`, 'success', 6000);
  } else {
    // Always hide loading, even in silent mode
    hideLoading();
  }
  
  return { created, updated, skipped };
}

async function fetchGoogleCalendarEvents({ silent = false } = {}) {
  if (!GOOGLE_APPS_SCRIPT_ENDPOINT) {
    const message = 'Google Apps Script の Web アプリ URL が設定されていません。';
    if (!silent) showMessage(message, 'error', 6000);
    throw new Error(message);
  }

  const rangeSet = getAllowedDateRanges();
  logAllowedRanges('Google Fetch');
  
  if (!silent) {
    showLoading('Googleカレンダーから取得中...');
  }

  let response;
  try {
    const url = `${GOOGLE_APPS_SCRIPT_ENDPOINT}?action=events`;
    response = await fetch(url, { method: 'GET', mode: 'cors' });
  } catch (error) {
    if (!silent) {
      hideLoading();
      showMessage('Googleカレンダーの取得に失敗しました。ネットワークを確認してください。', 'error', 6000);
    }
    throw error;
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    const message = `Googleカレンダーからの取得に失敗しました (${response.status}) ${errorText || ''}`.trim();
    if (!silent) {
      hideLoading();
      showMessage(message, 'error', 6000);
    }
    throw new Error(message);
  }

  let result;
  try {
    result = await response.json();
  } catch (error) {
    const message = 'Googleカレンダーの応答が不正です。';
    if (!silent) {
      hideLoading();
      showMessage(message, 'error', 6000);
    }
    throw error;
  }

  const googleEvents = Array.isArray(result?.events) ? result.events : [];
  const { created, updated, deleted } = await mergeGoogleEvents(googleEvents, rangeSet);
  if (!silent) {
    hideLoading();
    showMessage(
      `Googleカレンダーから取得: ${googleEvents.length}件 (新規:${created} / 更新:${updated} / 重複削除:${deleted})`,
      'success',
      6000
    );
  } else {
    // Always hide loading, even in silent mode
    hideLoading();
  }
  return { created, updated, deleted: deleted || 0, total: googleEvents.length };
}

async function clearGoogleCalendarEvents({ silent = false } = {}) {
  if (!GOOGLE_APPS_SCRIPT_ENDPOINT) {
    const message = 'Google Apps Script の Web アプリ URL が設定されていません。';
    if (!silent) showMessage(message, 'error', 6000);
    throw new Error(message);
  }

  const url = `${GOOGLE_APPS_SCRIPT_ENDPOINT}?action=clear&_=${Date.now()}`;
  let response;
  try {
    response = await fetch(url, { method: 'GET', mode: 'cors' });
  } catch (error) {
    if (!silent) showMessage('Googleカレンダーの削除に失敗しました。ネットワークを確認してください。', 'error', 6000);
    throw error;
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    const message = `Googleカレンダーの予定削除に失敗しました (${response.status}) ${errorText || ''}`.trim();
    if (!silent) showMessage(message, 'error', 6000);
    throw new Error(message);
  }

  const result = await response.json().catch(() => null);
  if (!result) {
    if (!silent) showMessage('Googleカレンダーの予定を削除しました。', 'success', 6000);
    return { deleted: 0 };
  }

  if (!silent) {
    showMessage(
      `Googleカレンダーから schedule_mgr の予定を削除しました: ${result.deleted || 0}件`,
      'success',
      6000
    );
  } else {
  }
  return { deleted: Number(result.deleted) || 0 };
}

// タイトル比較用に正規化
function normalizeTitleForComparison(title) {
  if (!title && title !== 0) return '';
  return String(title)
    .trim()
    .replace(/\s+/g, '') // 全ての空白を除去
    .toLowerCase();
}

function buildDateTitleKey(startTime, title) {
  if (!startTime) return null;
  const dateKey = formatDateOnly(startTime);
  if (!dateKey) return null;
  const titleKey = normalizeTitleForComparison(title || '');
  return `${dateKey}__${titleKey}`;
}

// Firebase内の全イベントに対して重複チェックを実行（Google由来を優先）
async function deduplicateFirebaseEvents() {
  if (!Array.isArray(events) || events.length === 0) {
    return { deleted: 0 };
  }

  const rangeSet = getAllowedDateRanges();
  let deleted = 0;

  // すべてのイベントを日付＋タイトルでグルーピング
  const eventsByDateTitle = new Map();
  for (const ev of events) {
    if (!ev?.startTime) continue;
    if (ev.isTimetable === true) continue;
    if (!isEventInAllowedRange(ev, rangeSet)) continue;

    const key = buildDateTitleKey(ev.startTime, ev.title || '');
    if (!key) continue;
    if (!eventsByDateTitle.has(key)) {
      eventsByDateTitle.set(key, []);
    }
    eventsByDateTitle.get(key).push(ev);
  }

  // 各グループで重複チェック
  for (const [key, duplicates] of eventsByDateTitle.entries()) {
    if (duplicates.length <= 1) continue; // 重複なし

    // Google由来のイベントを優先
    const googleEvents = duplicates.filter(
      ev => ev.source === 'google' || ev.isGoogleImported === true
    );
    const localEvents = duplicates.filter(
      ev => ev.source !== 'google' && ev.isGoogleImported !== true
    );

    // Google由来が1つ以上ある場合、ローカルを削除
    if (googleEvents.length > 0) {

      // Google由来が複数ある場合、1つだけ残す（最新のもの）
      if (googleEvents.length > 1) {
        googleEvents.sort((a, b) => {
          const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
          const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
          return bTime - aTime; // 新しい順
        });
        // 最新以外のGoogle由来イベントを削除
        for (let i = 1; i < googleEvents.length; i++) {
          try {
            const deletedOk = await deleteEvent(googleEvents[i].id, { syncGoogle: false });
            if (deletedOk) {
              deleted += 1;
            }
          } catch (error) {
          }
        }
      }

      // すべてのローカルイベントを削除
      for (const localEvent of localEvents) {
        try {
          const deletedOk = await deleteEvent(localEvent.id, { syncGoogle: false });
          if (deletedOk) {
            deleted += 1;
          }
        } catch (error) {
        }
      }
    } else {
      // Google由来がない場合、ローカル同士の重複を1つだけ残す（最新のもの）
      if (localEvents.length > 1) {
        localEvents.sort((a, b) => {
          const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
          const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
          return bTime - aTime; // 新しい順
        });
        const dateLabel = formatDateOnly(localEvents[0].startTime) || '';
        // 最新以外を削除
        for (let i = 1; i < localEvents.length; i++) {
          try {
            const deletedOk = await deleteEvent(localEvents[i].id, { syncGoogle: false });
            if (deletedOk) {
              deleted += 1;
            }
          } catch (error) {
          }
        }
      }
    }
  }

  if (deleted > 0) {
  }
  return { deleted };
}

async function mergeGoogleEvents(googleEvents = [], ranges) {
  let created = 0;
  let updated = 0;
  let deleted = 0;

  // Ensure events is an array
  if (!Array.isArray(events)) {
    return { created: 0, updated: 0, deleted: 0 };
  }

  const eventsById = new Map(events.map(ev => [ev.id, ev]));
  const eventsByGoogleId = new Map(
    events
      .filter(ev => ev.googleEventId)
      .map(ev => [ev.googleEventId, ev])
  );

  const rangeSet = ranges || getAllowedDateRanges();

  // すべてのイベントを日付＋タイトルでグルーピング
  const eventsByDateTitle = new Map();
  const registerEventByKey = (ev) => {
    if (!ev?.startTime) return;
    if (ev.isTimetable === true) return;
    if (!isEventInAllowedRange(ev, rangeSet)) return;
    const key = buildDateTitleKey(ev.startTime, ev.title || '');
    if (!key) return;
    if (!eventsByDateTitle.has(key)) {
      eventsByDateTitle.set(key, []);
    }
    eventsByDateTitle.get(key).push({
      id: ev.id,
      title: ev.title || '',
      startTime: ev.startTime,
      source: ev.source || '',
      isGoogleImported: ev.isGoogleImported === true,
      googleEventId: ev.googleEventId || null,
    });
  };
  events.forEach(registerEventByKey);

  const updateKeyEntry = (key, eventLike) => {
    if (!key) return;
    if (!eventLike) {
      eventsByDateTitle.delete(key);
      return;
    }
    eventsByDateTitle.set(key, [eventLike]);
  };

  for (const googleEvent of googleEvents) {
    const normalized = normalizeGoogleEvent(googleEvent, rangeSet);
    if (normalized.filteredOut) continue;
    if (!normalized.startTime || !normalized.endTime) continue;

    const key = buildDateTitleKey(normalized.startTime, normalized.title || '');
    const dateLabel = formatDateOnly(normalized.startTime) || normalized.startTime || '';
    const linkedId =
      googleEvent.scheduleMgrId && eventsById.has(googleEvent.scheduleMgrId)
        ? googleEvent.scheduleMgrId
        : null;

    if (key) {
      const duplicates = eventsByDateTitle.get(key) || [];
      const keeperIds = new Set();
      if (linkedId) {
        keeperIds.add(linkedId);
      }
      if (normalized.googleEventId) {
        const match = duplicates.find(ev => ev.googleEventId === normalized.googleEventId);
        if (match) {
          keeperIds.add(match.id);
        }
      }
      if (keeperIds.size === 0) {
        const googleCandidate = duplicates.find(ev => ev.source === 'google' || ev.isGoogleImported === true);
        if (googleCandidate) {
          keeperIds.add(googleCandidate.id);
        }
      }
      const shouldDeleteAll = keeperIds.size === 0;

      if (duplicates.length > 0) {
        const survivors = [];
        for (const duplicate of duplicates) {
          const keepThis = !shouldDeleteAll && keeperIds.has(duplicate.id);
          if (keepThis) {
            survivors.push(duplicate);
            continue;
          }
          try {
            const deletedOk = await deleteEvent(duplicate.id, { syncGoogle: false });
            if (deletedOk) {
              deleted += 1;
              eventsById.delete(duplicate.id);
            } else {
              survivors.push(duplicate);
            }
          } catch (error) {
            survivors.push(duplicate);
          }
        }
        if (survivors.length > 0) {
          eventsByDateTitle.set(key, survivors);
        } else {
          eventsByDateTitle.delete(key);
        }
      }
    }

    if (googleEvent.scheduleMgrId && eventsById.has(googleEvent.scheduleMgrId)) {
      const existing = eventsById.get(googleEvent.scheduleMgrId);
      if (existing.isTimetable === true) {
        continue;
      }
      if (!isEventInAllowedRange(existing, rangeSet)) {
        continue;
      }
      if (needsExternalUpdate(existing, normalized)) {
        await updateEvent(
          googleEvent.scheduleMgrId,
          {
            ...normalized,
            source: 'google',
            isGoogleImported: true,
          },
          { syncGoogle: false }
        );
        updated += 1;
      }
      if (key) {
        updateKeyEntry(key, {
          id: googleEvent.scheduleMgrId,
          title: normalized.title || '',
          startTime: normalized.startTime,
          source: 'google',
          isGoogleImported: true,
          googleEventId: normalized.googleEventId || null,
        });
      }
      continue;
    }

    if (normalized.googleEventId && eventsByGoogleId.has(normalized.googleEventId)) {
      const existing = eventsByGoogleId.get(normalized.googleEventId);
       if (existing.isTimetable === true) {
        continue;
      }
      if (!isEventInAllowedRange(existing, rangeSet)) {
        continue;
      }
      if (needsExternalUpdate(existing, normalized)) {
        await updateEvent(existing.id, {
          ...normalized,
          source: existing.source || 'google',
          isGoogleImported: true,
        }, { syncGoogle: false });
        updated += 1;
      }
      continue;
    }

    const newEventId = await addEvent({
      ...normalized,
      isTimetable: false,
      source: 'google',
      isGoogleImported: true,
    }, { syncGoogle: false });
    if (newEventId) {
      created += 1;
      if (key) {
        updateKeyEntry(key, {
          id: newEventId,
          title: normalized.title || '',
          startTime: normalized.startTime,
          source: 'google',
          isGoogleImported: true,
          googleEventId: normalized.googleEventId || null,
        });
      }
    }
  }

  // Firebase内の全イベントに対して重複チェックを実行
  try {
    const { deleted: firebaseDeleted } = await deduplicateFirebaseEvents();
    if (firebaseDeleted > 0) {
      deleted += firebaseDeleted;
    }
  } catch (error) {
  }

  return { created, updated, deleted };
}

function normalizeGoogleEvent(googleEvent = {}, ranges) {
  const startTime = normalizeEventDateTimeString(googleEvent.startDateTime);
  const endTime = normalizeEventDateTimeString(googleEvent.endDateTime);
  const candidate = {
    title: googleEvent.title || '',
    description: googleEvent.description || '',
    location: googleEvent.location || '',
    startTime: startTime || '',
    endTime: endTime || '',
    allDay: googleEvent.allDay === true,
    reminderMinutes:
      typeof googleEvent.reminderMinutes === 'number' && Number.isFinite(googleEvent.reminderMinutes)
        ? googleEvent.reminderMinutes
        : null,
    googleEventId: googleEvent.googleEventId || null,
    externalUpdatedAt: googleEvent.lastUpdated || null,
  };
  if (!isEventInAllowedRange(candidate, ranges)) {
    return { ...candidate, filteredOut: true };
  }
  return candidate;
}

function needsExternalUpdate(existing = {}, incoming = {}) {
  const keys = ['title', 'description', 'location', 'startTime', 'endTime', 'allDay', 'reminderMinutes', 'googleEventId', 'externalUpdatedAt'];
  return keys.some(key => normalizeForCompare(existing[key], key) !== normalizeForCompare(incoming[key], key));
}

function normalizeForCompare(value, key) {
  if (key === 'allDay') return value === true;
  if (key === 'reminderMinutes') {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }
  if (value === undefined || value === '') return null;
  return value;
}

// イベントを追加（combiと同じロジック）
async function addEvent(event, options = {}) {
  const { syncGoogle = true } = options;
  const normalizedStart = normalizeEventDateTimeString(event.startTime);
  const normalizedEnd = normalizeEventDateTimeString(event.endTime);
  const newEvent = {
    ...event,
    startTime: normalizedStart || event.startTime || '',
    endTime: normalizedEnd || event.endTime || '',
    allDay: event.allDay === true,
    source: event.source || 'local',
    googleEventId: event.googleEventId || null,
    isGoogleImported: event.isGoogleImported === true,
    externalUpdatedAt: event.externalUpdatedAt || null,
    isTimetable: event.isTimetable === true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastWriteClientId: clientId
  };

  if (!isFirebaseEnabled || !window.firebase?.db) {
    const message = 'Firebaseが無効のため、イベントを保存できません。設定を確認してください。';
    showMessage(message, 'error', 6000);
    return null;
  }

  try {
    const eventsRef = window.firebase.ref(window.firebase.db, "events");
    const newEventRef = window.firebase.push(eventsRef);
    const { id: _omitId, ...payload } = newEvent;
    await window.firebase.set(newEventRef, payload);
    const newId = newEventRef.key;

    if (syncGoogle && newId && newEvent.isTimetable !== true) {
      try {
        await mirrorMutationsToGoogle({
          upserts: [{ ...newEvent, id: newId }],
          silent: true,
        });
      } catch (error) {
        await window.firebase.remove(newEventRef).catch(() => {});
        throw error;
      }
    }

    return newId;
  } catch (error) {
    showMessage('イベントを保存できませんでした。ネットワークやFirebase設定を確認してください。', 'error', 6000);
    return null;
  }
}

// イベントを更新（combiと同じロジック）
async function updateEvent(id, event, options = {}) {
  const { syncGoogle = true } = options;
  const existingEvent = (Array.isArray(events) ? events.find(e => e.id === id) : null) || {};
  const startSource = event.startTime ?? existingEvent.startTime ?? '';
  const endSource = event.endTime ?? existingEvent.endTime ?? '';
  const normalizedStart = normalizeEventDateTimeString(startSource);
  const normalizedEnd = normalizeEventDateTimeString(endSource);
  const updatedEvent = {
    ...existingEvent,
    ...event,
    startTime: normalizedStart || startSource,
    endTime: normalizedEnd || endSource,
    allDay: event.allDay === true,
    isTimetable: event.isTimetable === true ? true : existingEvent.isTimetable === true,
    source: event.source || existingEvent.source || 'local',
    googleEventId: event.googleEventId || existingEvent.googleEventId || null,
    isGoogleImported:
      event.isGoogleImported === true
        ? true
        : existingEvent.isGoogleImported === true,
    externalUpdatedAt: event.externalUpdatedAt || existingEvent.externalUpdatedAt || null,
    updatedAt: new Date().toISOString(),
    lastWriteClientId: clientId
  };

  if (!isFirebaseEnabled || !window.firebase?.db) {
    const message = 'Firebaseが無効のため、イベントを更新できません。設定を確認してください。';
    showMessage(message, 'error', 6000);
    return false;
  }

  const eventRef = window.firebase.ref(window.firebase.db, `events/${id}`);
  try {
    await window.firebase.update(eventRef, updatedEvent);
  } catch (error) {
    showMessage('イベントの更新に失敗しました。ネットワーク状況を確認してください。', 'error', 6000);
    return false;
  }

  if (syncGoogle && updatedEvent.isTimetable !== true) {
    try {
      await mirrorMutationsToGoogle({
        upserts: [{ ...updatedEvent, id }],
        silent: true,
      });
    } catch (error) {
      // Google同期が失敗してもFirebaseの更新は成功しているので、エラーをスローしない
      // ユーザーには通知しない（silent: trueの意図）
    }
  }

  return true;
}

// イベントを削除（combiと同じロジック）
async function deleteEvent(id, options = {}) {
  const { syncGoogle = true } = options;
  if (!isFirebaseEnabled || !window.firebase?.db) {
    const message = 'Firebaseが無効のため、イベントを削除できません。設定を確認してください。';
    showMessage(message, 'error', 6000);
    return false;
  }

  const existingEvent = Array.isArray(events) ? events.find(e => e.id === id) : null;
  const eventRef = window.firebase.ref(window.firebase.db, `events/${id}`);

  try {
    await window.firebase.remove(eventRef);
  } catch (error) {
    showMessage('イベントの削除に失敗しました。再度お試しください。', 'error', 6000);
    return false;
  }

  if (syncGoogle && existingEvent?.isTimetable !== true) {
    try {
      // 削除時にイベント情報（日付とタイトル）も送信して、IDが一致しない場合でもマッチングできるようにする
      await mirrorMutationsToGoogle({
        deletes: existingEvent ? [existingEvent] : [id],
        silent: true,
      });
    } catch (error) {
      // Google同期が失敗してもFirebaseの削除は成功しているので、エラーをスローしない
      // ユーザーには通知しない（silent: trueの意図）
    }
  }

  return true;
}

async function clearAllEvents({ skipConfirm = false, silent = false } = {}) {
  if (!skipConfirm) {
    const confirmed = await showConfirmModal('全ての予定と時間割データを削除します。よろしいですか？', '削除の確認');
    if (!confirmed) return false;
  }

  const deletableEvents = Array.isArray(events)
    ? events.filter(ev => ev?.id && ev.isTimetable !== true)
    : [];

  try {
    if (!silent) {
      showLoading('削除中...');
    }
    
    if (isFirebaseEnabled && window.firebase?.db) {
      const eventsRef = window.firebase.ref(window.firebase.db, 'events');
      await window.firebase.remove(eventsRef);
    }
    
    events = [];
    updateViews();
    clearScheduledNotifications();

    if (deletableEvents.length > 0) {
      try {
        // 削除時にイベント情報（日付とタイトル）も送信して、IDが一致しない場合でもマッチングできるようにする
        await mirrorMutationsToGoogle({ deletes: deletableEvents, silent: true });
      } catch (error) {
      }
    }

    if (!silent) {
      hideLoading();
      showMessage('全ての予定を削除しました。', 'success');
    }
    return true;
  } catch (error) {
    if (!silent) {
      hideLoading();
      showMessage('予定の削除に失敗しました。再度お試しください。', 'error', 6000);
    }
    return false;
  }
}

if (typeof window !== 'undefined') {
  window.clearAllEvents = clearAllEvents;
  window.syncEventsToGoogleCalendar = syncEventsToGoogleCalendar;
  window.fetchGoogleCalendarEvents = fetchGoogleCalendarEvents;
  window.clearGoogleCalendarEvents = clearGoogleCalendarEvents;
}

function startAutomaticGoogleSync() {
  if (!GOOGLE_APPS_SCRIPT_ENDPOINT) {
    return;
  }
  if (googleSyncIntervalId) {
    // 既に実行中の場合は停止して再開
    stopAutomaticGoogleSync();
  }

  const syncTask = async (triggerSource = 'interval') => {
    if (!isFirebaseEnabled) return;
    if (googleSyncInFlight) return;
    googleSyncInFlight = true;
    try {
      await fetchGoogleCalendarEvents({ silent: true });
      await syncEventsToGoogleCalendar({ silent: true });
    } catch (error) {
    } finally {
      googleSyncInFlight = false;
    }
  };

  googleSyncTimeoutId = setTimeout(async () => {
    googleSyncTimeoutId = null;
    await syncTask('initial-delay');
  }, INITIAL_GOOGLE_SYNC_DELAY_MS);
  googleSyncIntervalId = setInterval(() => syncTask('interval'), GOOGLE_SYNC_INTERVAL_MS);
}

function stopAutomaticGoogleSync() {
  if (googleSyncTimeoutId) {
    clearTimeout(googleSyncTimeoutId);
    googleSyncTimeoutId = null;
  }
  if (googleSyncIntervalId) {
    clearInterval(googleSyncIntervalId);
    googleSyncIntervalId = null;
  }
}

// 特定日のイベントを取得（日を跨ぐイベントも含む）
function getEventsByDate(date) {
  const dateStr = formatDate(date, 'YYYY-MM-DD');
  const targetDate = new Date(date);
  targetDate.setHours(0, 0, 0, 0);
  const targetDateEnd = new Date(targetDate);
  targetDateEnd.setHours(23, 59, 59, 999);
  
  const list = [];
  if (!Array.isArray(events)) return list;
  
  events.forEach(ev => {
    if (!ev.recurrence || ev.recurrence === 'none') {
      if (!ev.startTime) return;
      
      // 終日イベントの場合
      if (isAllDayEvent(ev)) {
        const eventStartDate = ev.startTime.split('T')[0];
        const eventEndDate = ev.endTime ? ev.endTime.split('T')[0] : eventStartDate;
        
        // 指定日がイベントの開始日から終了日（含む）の間にあるかチェック
        if (dateStr >= eventStartDate && dateStr <= eventEndDate) {
          list.push(ev);
        }
      return;
    }
      
      // 時間指定イベントの場合
      const eventStart = new Date(ev.startTime);
      const eventEnd = ev.endTime ? new Date(ev.endTime) : new Date(eventStart);
      
      if (Number.isNaN(eventStart.getTime()) || Number.isNaN(eventEnd.getTime())) return;
      
      // 指定日の0時から23:59:59までの期間とイベントの期間が重なるかチェック
      // イベントが指定日の前日から始まって指定日に終わる、または
      // イベントが指定日に始まって指定日の翌日に終わる、または
      // イベントが指定日を含む期間に完全に含まれる
      if (eventStart <= targetDateEnd && eventEnd >= targetDate) {
        list.push(ev);
      }
      return;
    }
    
    // 繰り返し展開（簡易）
    if (!ev.startTime || !ev.endTime) return;
    const start = new Date(ev.startTime);
    const end = new Date(ev.endTime);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return;
    
    // recurrenceEnd is a date-only string (YYYY-MM-DD), append time if needed
    const recurEnd = ev.recurrenceEnd 
      ? new Date(ev.recurrenceEnd.includes('T') ? ev.recurrenceEnd : ev.recurrenceEnd + 'T23:59:59')
      : null;
    const target = new Date(date);
    target.setHours(start.getHours(), start.getMinutes(), 0, 0);
    if (recurEnd && !Number.isNaN(recurEnd.getTime()) && target > recurEnd) return;
    
    const matches = (
      ev.recurrence === 'daily' ||
      (ev.recurrence === 'weekly' && target.getDay() === start.getDay()) ||
      (ev.recurrence === 'monthly' && target.getDate() === start.getDate())
    );
    
    if (matches && target >= start) {
      const inst = { ...ev };
      const duration = end.getTime() - start.getTime();
      if (duration > 0) {
        inst.startTime = formatDateTimeLocal(target);
        inst.endTime = formatDateTimeLocal(new Date(target.getTime() + duration));
        
        // 繰り返しイベントも日を跨ぐ可能性があるので、同様にチェック
        const instStart = new Date(inst.startTime);
        const instEnd = new Date(inst.endTime);
        if (instStart <= targetDateEnd && instEnd >= targetDate) {
        list.push(inst);
        }
      }
    }
  });
  return list;
}

// 特定週のイベントを取得（週を跨ぐイベントも含む）
function getEventsByWeek(startDate) {
  const weekStart = new Date(startDate);
  weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(startDate);
  weekEnd.setDate(weekEnd.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);
  
  if (!Array.isArray(events)) return [];
  
  return events.filter(event => {
    if (!event || !event.startTime) return false;
    
    // 終日イベントの場合
    if (isAllDayEvent(event)) {
      const eventStartDate = event.startTime.split('T')[0];
      const eventEndDate = event.endTime ? event.endTime.split('T')[0] : eventStartDate;
      const weekStartStr = formatDate(weekStart, 'YYYY-MM-DD');
      const weekEndStr = formatDate(weekEnd, 'YYYY-MM-DD');
      
      // イベントの期間と週の期間が重なるかチェック
      return eventStartDate <= weekEndStr && eventEndDate >= weekStartStr;
    }
    
    // 時間指定イベントの場合
    const eventStart = new Date(event.startTime);
    const eventEnd = event.endTime ? new Date(event.endTime) : new Date(eventStart);
    
    if (Number.isNaN(eventStart.getTime()) || Number.isNaN(eventEnd.getTime())) return false;
    
    // イベントの期間と週の期間が重なるかチェック
    return eventStart <= weekEnd && eventEnd >= weekStart;
  });
}

// 日次ビューの描画
function renderDayView() {
  const container = safeGetElementById('dayEventContainer');
  const allDayContainer = safeGetElementById('dayAllDayContainer');
  if (!container) {
    return;
  }
  if (allDayContainer) {
    allDayContainer.innerHTML = '';
  }
  container.innerHTML = '';

  const dayEvents = getEventsByDate(currentDate);
  const { allDayEvents, timedEvents } = splitEventsByAllDay(dayEvents);

  if (allDayContainer) {
    const sortedAllDay = [...allDayEvents].sort((a, b) => {
      const aTime = new Date(a.startTime || 0).getTime();
      const bTime = new Date(b.startTime || 0).getTime();
      const safeATime = Number.isNaN(aTime) ? 0 : aTime;
      const safeBTime = Number.isNaN(bTime) ? 0 : bTime;
      return safeATime - safeBTime;
    });
    syncEventElements(allDayContainer, sortedAllDay, viewCaches.day.allDay, { variant: 'all-day' });
  }
  
  const sortedTimed = [...timedEvents].sort((a, b) => {
    const aTime = new Date(a.startTime || 0).getTime();
    const bTime = new Date(b.startTime || 0).getTime();
    const safeATime = Number.isNaN(aTime) ? 0 : aTime;
    const safeBTime = Number.isNaN(bTime) ? 0 : bTime;
    return safeATime - safeBTime;
  });
  const groups = calculateEventGroups(sortedTimed);
  const groupMap = new Map();
  sortedTimed.forEach((event, index) => {
    groupMap.set(event.id, groups[index]);
  });

  syncEventElements(container, sortedTimed, viewCaches.day.timed, {
    positionEvent: (element, event) => {
      positionEventInDayView(element, event, currentDate);
      applyOverlapStyles(element, groupMap.get(event.id));
    },
  });

  attachResizeHandlers();
}

// 週次ビューの描画
function renderWeekView() {
  const weekStart = getWeekStart(currentDate);
  
  // 各日の日付を更新
  for (let i = 0; i < 7; i++) {
    const dayDate = new Date(weekStart);
    dayDate.setDate(dayDate.getDate() + i);
    
    // 週次ビュー内の該当カラムとヘッダーを正しく取得
    const dayElement = document.querySelector(`#weekView .week-day[data-day="${i}"]`);
    const dateHeaderElement = document.querySelector(`#weekView .week-header .day-header-cell[data-day="${i}"] .day-date`);
    const eventsContainer = dayElement ? dayElement.querySelector('.day-events-container') : null;
    const allDayColumn = document.querySelector(`#weekView .week-all-day-columns .all-day-column[data-day="${i}"]`);
    const headerCell = document.querySelector(`#weekView .week-header .day-header-cell[data-day="${i}"]`);
    
    // 日付表示（曜日なし）
    const dayNumber = dayDate.getDate();
    if (dateHeaderElement) {
      dateHeaderElement.textContent = dayNumber;
    }
    if (headerCell) {
      headerCell.setAttribute('role', 'button');
      headerCell.tabIndex = 0;
      headerCell.setAttribute('aria-label', formatDate(dayDate, 'YYYY年M月D日（ddd）'));
    }
    
    // イベント表示
    if (!eventsContainer) {
      continue;
    }
    
    // コンテナをクリア
    eventsContainer.innerHTML = '';
    if (allDayColumn) {
      allDayColumn.innerHTML = '';
    }
    
    const dayEvents = getEventsByDate(dayDate);
    const { allDayEvents, timedEvents } = splitEventsByAllDay(dayEvents);
    
    if (allDayColumn) {
      const sortedAllDay = [...allDayEvents].sort((a, b) => {
        const aTime = new Date(a.startTime || 0).getTime();
        const bTime = new Date(b.startTime || 0).getTime();
        const safeATime = Number.isNaN(aTime) ? 0 : aTime;
        const safeBTime = Number.isNaN(bTime) ? 0 : bTime;
        return safeATime - safeBTime;
      });
      syncEventElements(allDayColumn, sortedAllDay, viewCaches.week.allDay[i], { variant: 'all-day' });
    }

    const sortedTimed = [...timedEvents].sort((a, b) => {
      const aTime = new Date(a.startTime || 0).getTime();
      const bTime = new Date(b.startTime || 0).getTime();
      const safeATime = Number.isNaN(aTime) ? 0 : aTime;
      const safeBTime = Number.isNaN(bTime) ? 0 : bTime;
      return safeATime - safeBTime;
    });
    const groups = calculateEventGroups(sortedTimed);
    const groupMap = new Map();
    sortedTimed.forEach((event, index) => {
      groupMap.set(event.id, groups[index]);
    });
    
    syncEventElements(eventsContainer, sortedTimed, viewCaches.week.timed[i], {
      positionEvent: (element, event) => {
        positionEventInDayView(element, event, dayDate);
        applyOverlapStyles(element, groupMap.get(event.id));
      },
    });
  }
  
  // リサイズハンドラーをアタッチ
  attachResizeHandlers();
}

// イベント重なり検出とグループ化（同時間帯を横並び等分表示用）
function calculateEventGroups(dayEvents) {
  const groups = [];
  const n = dayEvents.length;
  for (let i = 0; i < n; i++) {
    const ev = dayEvents[i];
    if (!ev.startTime || !ev.endTime) {
      groups.push({ totalInGroup: 1, indexInGroup: 0 });
      continue;
    }
    const start = new Date(ev.startTime);
    const end = new Date(ev.endTime);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      groups.push({ totalInGroup: 1, indexInGroup: 0 });
      continue;
    }
    const overlappingIndexes = [];
    for (let j = 0; j < n; j++) {
      const other = dayEvents[j];
      if (!other.startTime || !other.endTime) continue;
      const os = new Date(other.startTime);
      const oe = new Date(other.endTime);
      if (Number.isNaN(os.getTime()) || Number.isNaN(oe.getTime())) continue;
      if (start < oe && end > os) {
        overlappingIndexes.push(j);
      }
    }
    const indexInGroup = overlappingIndexes.indexOf(i);
    groups.push({ totalInGroup: overlappingIndexes.length, indexInGroup });
  }
  return groups;
}

function getEventRenderSignature(event, { variant } = {}) {
  return [
    event.id || '',
    event.title || '',
    event.description || '',
    event.startTime || '',
    event.endTime || '',
    event.color || '',
    event.allDay === true ? '1' : '0',
    event.isTimetable === true ? '1' : '0',
    event.reminderMinutes ?? '',
    variant || '',
  ].join('|');
}

function populateEventElement(element, event, options = {}) {
  const { variant } = options;
  const isAllDay = variant === 'all-day' || isAllDayEvent(event);
  element.className = 'event-item';
  if (isAllDay) element.classList.add('all-day');
  if (event.isTimetable === true) element.classList.add('timetable-event');
  element.style.backgroundColor = event.color || '#3b82f6';
  element.dataset.eventId = event.id;
  if (event.isTimetable === true) {
    element.dataset.isTimetable = 'true';
  } else {
    delete element.dataset.isTimetable;
  }
  if (isAllDay) {
    element.dataset.allDay = 'true';
  } else {
    delete element.dataset.allDay;
  }
  element.tabIndex = 0;
  element.setAttribute('role', 'button');
  const fullTitle = event.title || '(無題)';
  const displayTitle = truncateText(fullTitle, 30);

  if (isAllDay) {
    element.setAttribute('aria-label', `${fullTitle} (終日)`);
    element.innerHTML = `
      <div class="event-title">${escapeHtml(displayTitle)}</div>
    `;
  } else {
    const startLabel = event.startTime ? formatTime(event.startTime) : '--:--';
    const endLabel = event.endTime ? formatTime(event.endTime) : '--:--';
    element.setAttribute('aria-label', `${fullTitle}, ${startLabel}から${endLabel}`);
    element.innerHTML = `
      <div class="resize-handle top"></div>
      <div class="event-title">${escapeHtml(displayTitle)}</div>
      <div class="event-time">${startLabel} - ${endLabel}</div>
      <div class="resize-handle bottom"></div>
    `;
  }

  delete element.dataset.resizeBound;
  element.dataset.renderSignature = getEventRenderSignature(event, { variant });
}

function bindEventElementInteractions(element) {
  if (element.dataset.interactionBound === 'true') return;
  element.dataset.interactionBound = 'true';
  element.addEventListener('click', (e) => {
    e.stopPropagation();
    const id = element.dataset.eventId;
    if (id) showEventModal(id);
  });
  element.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const id = element.dataset.eventId;
      if (id) showEventModal(id);
    }
  });
}

function createEventElement(event, options = {}) {
  const div = document.createElement('div');
  populateEventElement(div, event, options);
  bindEventElementInteractions(div);
  return div;
}

function applyOverlapStyles(element, groupInfo) {
  if (!element) return;
  if (!groupInfo || groupInfo.totalInGroup <= 1) {
    element.style.left = '';
    element.style.right = '';
    return;
  }
  const widthPercent = 100 / groupInfo.totalInGroup;
  const leftPercent = widthPercent * groupInfo.indexInGroup;
  element.style.left = `${leftPercent}%`;
  element.style.right = `${100 - (leftPercent + widthPercent)}%`;
}

function syncEventElements(container, events, cacheMap, { variant, positionEvent, positionContext } = {}) {
  if (!container || !Array.isArray(events)) return;
  const processedIds = new Set();

  events.forEach((event, index) => {
    if (!event?.id) return;
    const signature = getEventRenderSignature(event, { variant });
    const cached = cacheMap.get(event.id);
    let element = cached?.element;
    if (!element) {
      element = createEventElement(event, { variant });
      cacheMap.set(event.id, { element, signature });
    } else if (cached.signature !== signature) {
      populateEventElement(element, event, { variant });
      cacheMap.set(event.id, { element, signature });
    } else {
      element.dataset.eventId = event.id;
    }

    if (typeof positionEvent === 'function') {
      positionEvent(element, event, positionContext);
    }

    const referenceNode = container.children[index];
    if (referenceNode !== element) {
      container.insertBefore(element, referenceNode || null);
    }
    processedIds.add(event.id);
  });

  Array.from(cacheMap.entries()).forEach(([id, info]) => {
    if (!processedIds.has(id)) {
      const element = info?.element;
      if (element && element.parentElement === container) {
        container.removeChild(element);
      }
      cacheMap.delete(id);
    }
  });
}

// 日次ビューでのイベント配置
// 日次ビューでのイベント位置計算（日を跨ぐイベントも考慮）
function positionEventInDayView(element, event, targetDate = null) {
  if (isAllDayEvent(event)) {
    element.style.position = 'relative';
    element.style.top = '';
    element.style.height = '';
    element.style.left = '';
    element.style.right = '';
    return;
  }

  if (!event.startTime || !event.endTime) {
    // Invalid event times, don't position
    return;
  }

  const startTime = new Date(event.startTime);
  const endTime = new Date(event.endTime);
  
  if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime())) {
    // Invalid dates, don't position
    return;
  }
  
  // 対象日の0時と23:59:59を取得（週次ビューでは各日、日次ビューではcurrentDate）
  const displayDate = targetDate || currentDate;
  const currentDay = new Date(displayDate);
  currentDay.setHours(0, 0, 0, 0);
  const currentDayEnd = new Date(currentDay);
  currentDayEnd.setHours(23, 59, 59, 999);
  
  // イベントの表示範囲を現在の日に制限
  // 日を跨ぐイベントの場合、現在の日の範囲内の部分だけを表示
  const displayStart = startTime < currentDay ? currentDay : startTime;
  const displayEnd = endTime > currentDayEnd ? currentDayEnd : endTime;
  
  // 表示範囲が現在の日と重ならない場合は何も表示しない
  if (displayStart >= currentDayEnd || displayEnd <= currentDay) {
    element.style.display = 'none';
    return;
  }
  
  element.style.display = '';
  
  // 時間スロットの実際の高さを取得（特別な位置決めのためにも必要）
  const hourHeight = getHourHeight();
  
  // タイトルだけを表示するための最低高さ（1時間分の高さの約30%）
  const MIN_HEIGHT_TITLE_ONLY = hourHeight * 0.3;
  // タイトルと時間の両方を表示するための最低高さ（1.5時間分）
  const MIN_HEIGHT_FOR_TIME = hourHeight * 1.5;
  
  // イベントの実際の時刻を現在日の0時からの分単位で計算
  const eventStartMinutes = Math.floor((startTime.getTime() - currentDay.getTime()) / 60000);
  const eventEndMinutes = Math.floor((endTime.getTime() - currentDay.getTime()) / 60000);
  
  // 2時（120分）と4時（240分）の閾値
  const DAY_END_HOUR = 2; // 2am is considered end of day
  const DAY_END_MINUTES = DAY_END_HOUR * 60; // 120 minutes
  
  // 特別な処理: 0-4amのイベントの位置決め
  let useSpecialPositioning = false;
  let specialTop = null;
  let specialHeight = null;
  
  // Case 1: イベントが2時より前に終了する場合、11pm-0amの位置（最下部）に表示
  // 終了時刻をmidnight (00:00) に設定して表示
  if (eventEndMinutes < DAY_END_MINUTES && eventEndMinutes > 0) {
    useSpecialPositioning = true;
    // 最下部の位置: 11pm (23:00) = VISIBLE_END_HOUR (23) - VISIBLE_START_HOUR (4) = 19時間分
    const bottomPositionHours = VISIBLE_END_HOUR - VISIBLE_START_HOUR; // 19 hours
    // イベントの実際の継続時間を計算
    const actualDurationMinutes = Math.max(15, eventEndMinutes - Math.max(0, eventStartMinutes));
    // 高さは実際の継続時間を使用
    specialHeight = Math.max(MIN_HEIGHT_TITLE_ONLY, (actualDurationMinutes / 60) * hourHeight);
    // 最下部に配置（高さ分だけ上に位置を調整して、bottom edgeが11pm位置になる）
    specialTop = (bottomPositionHours * hourHeight) - specialHeight;
  }
  // Case 2: イベントが2時以降に開始し、4時より前に終了する場合、4-5amの位置（最上部）に表示
  // 4:00 AMから5:00 AM（1時間）として表示
  else if (eventStartMinutes >= DAY_END_MINUTES && eventEndMinutes < VISIBLE_START_HOUR * 60 && eventStartMinutes < 1440) {
    useSpecialPositioning = true;
    // 最上部の位置: 4am = 0（表示可能範囲の開始）
    specialTop = 0;
    // 固定で1時間分（4am-5am）の高さ
    specialHeight = hourHeight;
  }
  
  // 特別な位置決めを使用する場合
  if (useSpecialPositioning && specialTop !== null && specialHeight !== null) {
    element.style.top = `${specialTop}px`;
    element.style.height = `${specialHeight}px`;
    
    // 高さが最低高さ以下の場合は時間要素を非表示
    const timeElement = element.querySelector('.event-time');
    if (timeElement) {
      if (specialHeight < MIN_HEIGHT_FOR_TIME) {
        timeElement.style.display = 'none';
      } else {
        timeElement.style.display = '';
      }
    }
    return;
  }
  
  // 通常の位置決め処理
  // 表示開始時刻と終了時刻を分単位で計算
  const displayStartMinutesTotal = displayStart.getHours() * 60 + displayStart.getMinutes();
  const displayEndMinutesTotal = displayEnd.getHours() * 60 + displayEnd.getMinutes();
  const visibleStartMinutes = VISIBLE_START_HOUR * 60;
  const visibleEndMinutes = (VISIBLE_END_HOUR + 1) * 60;

  // 表示可能な範囲内での開始位置と終了位置を計算
  const startMinutesFromVisible = Math.max(0, displayStartMinutesTotal - visibleStartMinutes);
  const endMinutesFromVisible = Math.max(
    startMinutesFromVisible + 15, 
    Math.min(visibleEndMinutes - visibleStartMinutes, displayEndMinutesTotal - visibleStartMinutes)
  );

  const top = (startMinutesFromVisible / 60) * hourHeight;
  const calculatedHeight = (endMinutesFromVisible - startMinutesFromVisible) / 60 * hourHeight;
  const height = Math.max(MIN_HEIGHT_TITLE_ONLY, calculatedHeight);

  element.style.top = `${top}px`;
  element.style.height = `${height}px`;
  
  // 高さが最低高さ以下の場合は時間要素を非表示
  const timeElement = element.querySelector('.event-time');
  if (timeElement) {
    if (calculatedHeight < MIN_HEIGHT_FOR_TIME) {
      timeElement.style.display = 'none';
    } else {
      timeElement.style.display = '';
    }
  }
}

// モーダル表示
function showEventModal(eventId = null) {
  const modal = safeGetElementById('eventModal');
  const modalTitle = safeGetElementById('modalTitle');
  const form = safeGetElementById('eventForm');
  const deleteBtn = safeGetElementById('deleteBtn');
  const startInput = safeGetElementById('eventStartTime');
  const endInput = safeGetElementById('eventEndTime');
  const allDayCheckbox = safeGetElementById('eventAllDay');
  const allDayRow = safeGetElementById('allDayDateRow');
  const allDayStartInput = safeGetElementById('eventAllDayStart');
  const allDayEndInput = safeGetElementById('eventAllDayEnd');
  
  // 必須要素のチェック
  if (!modal || !modalTitle || !form || !startInput || !endInput) {
    return;
  }
  
  const allDayControls = { startInput, endInput, allDayRow };
  
  editingEventId = eventId;
  
  const resetTimeInputs = () => {
    if (startInput) {
      startInput.disabled = false;
      startInput.classList.remove('readonly-input');
    }
    if (endInput) {
      endInput.disabled = false;
      endInput.classList.remove('readonly-input');
    }
    if (allDayCheckbox) {
      allDayCheckbox.checked = false;
      allDayCheckbox.disabled = false;
    }
    if (allDayStartInput) allDayStartInput.value = '';
    if (allDayEndInput) allDayEndInput.value = '';
    applyAllDayMode(false, allDayControls);
  };

  resetTimeInputs();
  
  if (eventId && typeof eventId === 'string' && !eventId.startsWith('temp-')) {
    // 編集モード（一時的でないイベント）
    if (!Array.isArray(events)) return;
    const event = events.find(e => e.id === eventId);
    if (!event) return;
    
    if (modalTitle) modalTitle.textContent = '予定を編集';
    if (deleteBtn) deleteBtn.style.display = 'block';
    
    // フォームに値を設定
    const titleInput = safeGetElementById('eventTitle');
    if (titleInput) titleInput.value = event.title || '';
    // Quill editorに内容を設定
    if (quillEditor) {
      const description = event.description || '';
      // HTMLとして設定（既にHTMLの場合はそのまま、プレーンテキストの場合はHTMLとして設定）
      quillEditor.root.innerHTML = description || '<p><br></p>';
    } else {
      const descInput = safeGetElementById('eventDescription');
      if (descInput) descInput.value = event.description || '';
    }
    if (startInput) startInput.value = toDateTimeLocalValue(event.startTime);
    if (endInput) endInput.value = toDateTimeLocalValue(event.endTime);
    
    if (allDayCheckbox) {
      const isAllDay = isAllDayEvent(event);
      allDayCheckbox.checked = isAllDay;
      if (isAllDay) {
        if (allDayStartInput) allDayStartInput.value = formatDateOnly(event.startTime);
        if (allDayEndInput) allDayEndInput.value = formatDateOnly(event.endTime || event.startTime);
      }
      applyAllDayMode(isAllDay, allDayControls);
    }
    
    // 色を設定
    const colorRadio = document.querySelector(`input[name="color"][value="${event.color}"]`);
    if (colorRadio) colorRadio.checked = true;
    
    // 繰り返し設定
    const recurrenceSelect = safeGetElementById('eventRecurrence');
    const recurrenceEndInput = safeGetElementById('eventRecurrenceEnd');
    const recurrenceEndGroup = safeGetElementById('recurrenceEndGroup');
    if (recurrenceSelect) {
      recurrenceSelect.value = event.recurrence || 'none';
      if (recurrenceEndGroup) {
        if (event.recurrence && event.recurrence !== 'none') {
          recurrenceEndGroup.classList.remove('hidden');
          if (recurrenceEndInput && event.recurrenceEnd) {
            recurrenceEndInput.value = event.recurrenceEnd;
          }
        } else {
          recurrenceEndGroup.classList.add('hidden');
        }
      }
    }
    
    // 通知設定
    const reminderSelect = safeGetElementById('eventReminder');
    if (reminderSelect) {
      reminderSelect.value = event.reminderMinutes !== null && event.reminderMinutes !== undefined ? String(event.reminderMinutes) : '';
    }

    if (event.isTimetable === true) {
      if (startInput) {
        startInput.disabled = true;
        startInput.classList.add('readonly-input');
      }
      if (endInput) {
        endInput.disabled = true;
        endInput.classList.add('readonly-input');
      }
      if (allDayCheckbox) {
        allDayCheckbox.disabled = true;
        allDayCheckbox.checked = false;
      }
      applyAllDayMode(false, allDayControls);
    }
  } else {
    // 新規作成モード（一時的イベントまたは新規）
    if (modalTitle) modalTitle.textContent = '新しい予定';
    if (deleteBtn) deleteBtn.style.display = 'none';
    
    // すべてのフィールドをクリア（タイトル、説明、色など）
    const titleInput = safeGetElementById('eventTitle');
    if (titleInput) titleInput.value = '';
    // Quill editorをクリア
    if (quillEditor) {
      quillEditor.root.innerHTML = '<p><br></p>';
    } else {
      const descInput = safeGetElementById('eventDescription');
      if (descInput) descInput.value = '';
    }
    
    // 色をデフォルト（青）にリセット
    const defaultColorRadio = document.querySelector('input[name="color"][value="#3b82f6"]');
    if (defaultColorRadio) defaultColorRadio.checked = true;
    
    // 一時的イベントの場合は既存の値を保持
    if (eventId && typeof eventId === 'string' && eventId.startsWith('temp-')) {
      if (!Array.isArray(events)) return;
      const event = events.find(e => e.id === eventId);
      if (event) {
        if (quillEditor) {
          quillEditor.root.innerHTML = event.description || '<p><br></p>';
        } else {
          const descInput = safeGetElementById('eventDescription');
          if (descInput) descInput.value = event.description || '';
        }
        if (startInput) startInput.value = toDateTimeLocalValue(event.startTime);
        if (endInput) endInput.value = toDateTimeLocalValue(event.endTime);
        if (allDayCheckbox) {
          const isAllDay = isAllDayEvent(event);
          allDayCheckbox.checked = isAllDay;
          if (isAllDay) {
            if (allDayStartInput) allDayStartInput.value = formatDateOnly(event.startTime);
            if (allDayEndInput) allDayEndInput.value = formatDateOnly(event.endTime || event.startTime);
          }
          applyAllDayMode(isAllDay, allDayControls);
        }
        
        // 色を設定
        const colorRadio = document.querySelector(`input[name="color"][value="${event.color}"]`);
        if (colorRadio) colorRadio.checked = true;
      }
    } else {
      // デフォルト値を設定（現在の日付の次の時間）
      const now = new Date();
      const startTime = new Date(now.getTime() + 60 * 60 * 1000); // 1時間後
      startTime.setMinutes(0);
      const endTime = new Date(startTime.getTime() + 60 * 60 * 1000); // さらに1時間後
      
      if (startInput) startInput.value = formatDateTimeLocal(startTime);
      if (endInput) endInput.value = formatDateTimeLocal(endTime);
    }
    if (allDayCheckbox) {
      allDayCheckbox.checked = false;
      applyAllDayMode(false, allDayControls);
    }
    
    // 繰り返し終了日フィールドを非表示
    const recurrenceEndGroup = safeGetElementById('recurrenceEndGroup');
    if (recurrenceEndGroup) {
      recurrenceEndGroup.classList.add('hidden');
    }
    
    // 繰り返しと通知をリセット
    const recurrenceSelect = safeGetElementById('eventRecurrence');
    const reminderSelect = safeGetElementById('eventReminder');
    if (recurrenceSelect) recurrenceSelect.value = 'none';
    if (reminderSelect) reminderSelect.value = '';
  }
  
  if (modal) {
    modal.classList.add('show');
    modal.setAttribute('aria-hidden', 'false');
    // モバイル版でスクロールバーが出ないようにbodyのoverflowを制御（CSSクラスのみで制御）
    document.body.classList.add('modal-open');
  }
}

// モーダルを閉じる
function closeEventModal() {
  const modal = safeGetElementById('eventModal');
  if (modal) {
    modal.classList.remove('show');
    modal.setAttribute('aria-hidden', 'true');
    // bodyのoverflowを元に戻す（CSSクラスのみで制御）
    document.body.classList.remove('modal-open');
  }
  
  // 一時的イベントの場合は削除
  if (editingEventId && typeof editingEventId === 'string' && editingEventId.startsWith('temp-')) {
    if (Array.isArray(events)) {
      const tempEventIndex = events.findIndex(e => e.id === editingEventId);
      if (tempEventIndex !== -1) {
        events.splice(tempEventIndex, 1);
        updateViews();
      }
    }
  }
  
  editingEventId = null;
}

// 日付表示を更新
function updateDateDisplay() {
  const currentDateElement = safeGetElementById('currentDate');
  if (!currentDateElement) return;
  
  if (currentView === 'day') {
    currentDateElement.textContent = formatDate(currentDate, 'YYYY年M月D日（ddd）');
  } else if (currentView === 'week') {
    const weekStart = getWeekStart(currentDate);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    
    currentDateElement.textContent = `${formatDate(weekStart, 'M月D日')}〜${formatDate(weekEnd, 'M月D日')}`;
  } else if (currentView === 'month') {
    currentDateElement.textContent = formatDate(currentDate, 'YYYY年M月');
  }
}

// 月次ビューの描画
function renderMonthView() {
  const monthGrid = safeGetElementById('monthGrid');
  if (!monthGrid) {
    return;
  }
  monthGrid.innerHTML = '';
  
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  
  // 月の最初の日と最後の日
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  
  // 月の最初の週の開始日（日曜日）
  const startDate = new Date(firstDay);
  startDate.setDate(startDate.getDate() - firstDay.getDay());
  
  // 6週間分の日付を生成
  for (let week = 0; week < 6; week++) {
    for (let day = 0; day < 7; day++) {
      const date = new Date(startDate);
      date.setDate(startDate.getDate() + (week * 7) + day);
      
      const dayElement = createMonthDayElement(date, month);
      monthGrid.appendChild(dayElement);
    }
  }
}

// 月次ビューの日付要素を作成
function createMonthDayElement(date, currentMonth) {
  const div = document.createElement('div');
  div.className = 'month-day';
  // Validate date before calling toISOString()
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return div;
  }
  div.dataset.date = date.toISOString().split('T')[0];
  
  // 他の月の日付かどうか
  if (date.getMonth() !== currentMonth) {
    div.classList.add('other-month');
  }
  
  // 今日かどうか
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    div.classList.add('today');
  }
  
  // 日付番号
  const dayNumber = document.createElement('div');
  dayNumber.className = 'month-day-number';
  dayNumber.textContent = date.getDate();
  div.appendChild(dayNumber);
  
  // その日のイベント（時間割は月次ビューで非表示）
  const dayEvents = getEventsByDate(date);
  const visibleEvents = dayEvents.filter(event => event.isTimetable !== true);
  const hasTimetableEvents = dayEvents.some(event => event.isTimetable === true);

  if (hasTimetableEvents) {
    div.classList.add('has-timetable');
  }

  if (visibleEvents.length > 0) {
    div.classList.add('has-events');
    
    const eventsContainer = document.createElement('div');
    eventsContainer.className = 'month-day-events';
    
    // 最大3件まで表示（背景色 + 時刻 + タイトル）
    visibleEvents.slice(0, 3).forEach(event => {
      const eventElement = document.createElement('div');
      eventElement.className = 'month-event-item';
      
      // イベントの色を背景色として使用
      const eventColor = event.color || '#3b82f6';
      eventElement.style.backgroundColor = eventColor;
      
      // 背景色に応じて文字色を調整（明るい色の場合は暗い文字、暗い色の場合は明るい文字）
      const rgb = hexToRgb(eventColor);
      if (rgb) {
        const brightness = (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000;
        eventElement.style.color = brightness > 128 ? '#1f2937' : '#ffffff';
      } else {
        eventElement.style.color = '#1f2937';
      }

      const time = document.createElement('span');
      time.className = 'month-event-time';
      time.textContent = isAllDayEvent(event) ? '' : formatTime(event.startTime);
      if (!time.textContent) time.classList.add('hidden');

      const title = document.createElement('span');
      title.className = 'month-event-title';
      // 月次ビューでは短く表示（最大15文字）
      title.textContent = truncateText(event.title || '', 15);

      if (!time.classList.contains('hidden')) {
        eventElement.appendChild(time);
      }
      eventElement.appendChild(title);

      // Escape title for tooltip to prevent XSS
      const safeTitle = escapeHtml(event.title || '');
      eventElement.title = isAllDayEvent(event)
        ? safeTitle
        : `${safeTitle} (${formatTime(event.startTime)})`;
      eventElement.addEventListener('click', (e) => {
        e.stopPropagation();
        showEventModal(event.id);
      });
      eventsContainer.appendChild(eventElement);
    });
    
    // 3件を超える場合は「+N」を表示
    if (visibleEvents.length > 3) {
      const moreElement = document.createElement('div');
      moreElement.className = 'month-event-item';
      moreElement.textContent = `+${visibleEvents.length - 3}`;
      eventsContainer.appendChild(moreElement);
    }
    
    div.appendChild(eventsContainer);
  }
  
  // 日付クリックで日次ビューに切り替え
  div.addEventListener('click', () => {
    currentDate = new Date(date);
    currentView = 'day';
    switchView('day');
    updateViews();
  });
  
  div.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      currentDate = new Date(date);
      currentView = 'day';
      switchView('day');
      updateViews();
    }
  });
  
  div.tabIndex = 0;
  div.setAttribute('role', 'button');
  div.setAttribute('aria-label', `${date.getDate()}日`);
  
  return div;
}

// ビューを更新
function updateViews() {
  updateDateDisplay();
  
  if (currentView === 'day') {
    renderDayView();
  } else if (currentView === 'week') {
    renderWeekView();
  } else if (currentView === 'month') {
    renderMonthView();
  }
  // 表示更新のたびに近接通知を再スケジュール
  scheduleAllNotifications();
}

// ユーティリティ関数

// 日付フォーマット
function formatDate(date, format) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
  const dayName = dayNames[date.getDay()];
  
  return format
    .replace('YYYY', year)
    .replace('MM', month.toString().padStart(2, '0'))
    .replace('M', month)
    .replace('DD', day.toString().padStart(2, '0'))
    .replace('D', day)
    .replace('ddd', dayName);
}

// テキストを指定長で切り詰める
function truncateText(text, maxLength) {
  if (!text || typeof text !== 'string') return '';
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

// 時間フォーマット
function formatTime(dateTimeString) {
  const date = new Date(dateTimeString);
  if (Number.isNaN(date.getTime())) return '--:--';
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

// datetime-local用のフォーマット
function formatDateTimeLocal(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function toDateTimeLocalValue(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return formatDateTimeLocal(date);
}

function formatDateOnly(value) {
  if (!value) return '';
  if (typeof value === 'string') {
    // 日付のみ（YYYY-MM-DD）の場合はそのまま返す
    if (!value.includes('T')) {
      const match = value.match(/^(\d{4}-\d{2}-\d{2})$/);
      if (match) return match[1];
    }
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isAllDayEvent(event) {
  return event?.allDay === true;
}

function splitEventsByAllDay(eventList = []) {
  const allDayEvents = [];
  const timedEvents = [];
  eventList.forEach((event) => {
    const lacksTime =
      !event?.startTime ||
      !event?.endTime ||
      Number.isNaN(new Date(event.startTime).getTime()) ||
      Number.isNaN(new Date(event.endTime).getTime());
    if (isAllDayEvent(event) || lacksTime) {
      allDayEvents.push(event);
    } else {
      timedEvents.push(event);
    }
  });
  return { allDayEvents, timedEvents };
}

function applyAllDayMode(isAllDay, controls) {
  const { startInput, endInput, allDayRow } = controls;
  if (isAllDay) {
    allDayRow?.classList.remove('hidden');
    startInput?.classList.add('readonly-input');
    endInput?.classList.add('readonly-input');
    startInput?.setAttribute('disabled', 'disabled');
    endInput?.setAttribute('disabled', 'disabled');
  } else {
    allDayRow?.classList.add('hidden');
    startInput?.classList.remove('readonly-input');
    endInput?.classList.remove('readonly-input');
    startInput?.removeAttribute('disabled');
    endInput?.removeAttribute('disabled');
  }
}

function normalizeEventDateTimeString(value) {
  if (!value) return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
    return value;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return formatDateTimeLocal(date);
}

function getAllowedDateRanges() {
  const now = new Date();
  
  // 6ヶ月前の日付を安全に計算
  const rangeStart = new Date(now);
  const currentMonth = rangeStart.getMonth();
  const targetMonth = currentMonth - 6;
  
  // 月が負の値になる場合の処理
  if (targetMonth < 0) {
    rangeStart.setFullYear(rangeStart.getFullYear() - 1);
    rangeStart.setMonth(12 + targetMonth);
  } else {
    rangeStart.setMonth(targetMonth);
  }
  rangeStart.setDate(1); // 月の最初の日
  rangeStart.setHours(0, 0, 0, 0);

  // 1年後の日付を計算
  const rangeEnd = new Date(now);
  rangeEnd.setFullYear(rangeEnd.getFullYear() + 1);
  rangeEnd.setMonth(11); // 12月
  rangeEnd.setDate(31); // 月末
  rangeEnd.setHours(23, 59, 59, 999);

  return { rangeStart, rangeEnd };
}

function logAllowedRanges(label) {
  const { rangeStart, rangeEnd } = getAllowedDateRanges();
  // Logging removed for production
}

// イベントが許可された範囲内にあるかチェック（日を跨ぐイベントも考慮）
function isEventInAllowedRange(event, ranges) {
  if (!event || !event.startTime) return false;
  
  const { rangeStart, rangeEnd } = ranges || getAllowedDateRanges();
  
  // 終日イベントの場合
  if (isAllDayEvent(event)) {
    const eventStartDate = new Date(event.startTime.split('T')[0]);
    const eventEndDate = event.endTime ? new Date(event.endTime.split('T')[0]) : eventStartDate;
    
    if (Number.isNaN(eventStartDate.getTime()) || Number.isNaN(eventEndDate.getTime())) return false;
    
    // イベントの期間と許可範囲が重なるかチェック
    return eventStartDate <= rangeEnd && eventEndDate >= rangeStart;
  }
  
  // 時間指定イベントの場合
  const eventStart = new Date(event.startTime);
  const eventEnd = event.endTime ? new Date(event.endTime) : eventStart;
  
  if (Number.isNaN(eventStart.getTime()) || Number.isNaN(eventEnd.getTime())) return false;
  
  // イベントの期間と許可範囲が重なるかチェック
  return eventStart <= rangeEnd && eventEnd >= rangeStart;
}

// 通知スケジュール
let scheduledTimeouts = [];
async function ensureNotificationPermission() {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission !== 'denied') {
    try { const res = await Notification.requestPermission(); return res === 'granted'; } catch { return false; }
  }
  return false;
}

function clearScheduledNotifications() {
  if (!Array.isArray(scheduledTimeouts)) {
    scheduledTimeouts = [];
    return;
  }
  scheduledTimeouts.forEach(id => {
    if (id != null) clearTimeout(id);
  });
  scheduledTimeouts = [];
}

function scheduleAllNotifications() {
  clearScheduledNotifications();
  ensureNotificationPermission().then((ok) => {
    if (!ok) return;
    if (!Array.isArray(events)) return;
    const now = Date.now();
    const soon = now + 7 * 24 * 60 * 60 * 1000; // 7日以内のみ
    events.forEach(ev => {
      if (!ev.reminderMinutes && ev.reminderMinutes !== 0) return;
      if (isAllDayEvent(ev)) return;
      if (!ev.startTime) return;
      const start = new Date(ev.startTime).getTime();
      if (Number.isNaN(start)) return;
      const fireAt = start - (ev.reminderMinutes * 60000);
      if (fireAt < now || fireAt > soon) return;
      const timeoutDelay = fireAt - now;
      if (timeoutDelay <= 0) return; // Additional safety check
      const timeout = setTimeout(() => {
        try { new Notification(ev.title || '予定', { body: `${formatTime(ev.startTime)} 開始`, silent: false }); } catch {}
      }, timeoutDelay);
      scheduledTimeouts.push(timeout);
    });
  }).catch((error) => {
  });
}

// エクスポート/インポート（JSONのみ、ICSは後続）
function exportEventsAsJSON(range = 'all') {
  try {
    // range パラメータは現在未使用（将来の拡張用）
    const data = { version: '1.1', exportedAt: new Date().toISOString(), events };
    const jsonString = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'events.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showMessage('イベントをエクスポートしました', 'success', 3000);
  } catch (error) {
    showMessage('エクスポートに失敗しました。', 'error', 6000);
  }
}

async function importEventsFromJSONData(obj) {
  if (!obj || !Array.isArray(obj.events)) throw new Error('フォーマット不正');
  let importedCount = 0;
  for (const ev of obj.events) {
    const dup = Array.isArray(events)
      ? events.find(e => e.startTime === ev.startTime && (e.title || '') === (ev.title || ''))
      : null;
    if (dup) continue;
    const toAdd = {
      title: ev.title || '',
      description: ev.description || '',
      startTime: ev.startTime,
      endTime: ev.endTime,
      allDay: ev.allDay === true,
      color: ev.color || '#3b82f6',
      recurrence: ev.recurrence || 'none',
      recurrenceEnd: ev.recurrenceEnd || '',
      reminderMinutes: ev.reminderMinutes ?? null,
      isTimetable: ev.isTimetable === true,
    };
    const newId = await addEvent(toAdd);
    if (newId) {
      importedCount++;
    }
  }
  return importedCount;
}

async function handleJSONImport(jsonData) {
  if (!jsonData || typeof jsonData !== 'object') {
    throw new Error('JSONデータが不正です');
  }
  // Check if it's a timetable file
  const isTimetable = 
    jsonData.type === 'timetable' ||
    jsonData.timetableData ||
    Array.isArray(jsonData.schoolDays) ||
    (jsonData.schedule && jsonData.periodTimes && Array.isArray(jsonData.periodTimes));
  
  if (!Array.isArray(jsonData) && isTimetable) {
    const count = await importTimetableFromData(jsonData);
    showMessage(`時間割をインポートしました: ${count}件の予定を追加`, 'success');
    return;
  }
  if (Array.isArray(jsonData.events)) {
    const count = await importEventsFromJSONData(jsonData);
    showMessage(`イベントをインポートしました: ${count}件`, 'success');
    return;
  }
  throw new Error('対応していないJSON形式です');
}

// 時間割データを取り込む
async function importTimetableFromData(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('時間割データが不正です');
  }

  if (data.type && data.type !== 'timetable') {
    throw new Error('時間割ファイルではありません');
  }

  if (Array.isArray(data.schoolDays)) {
    const title = (typeof data.title === 'string' && data.title.trim().length > 0)
      ? data.title.trim()
      : 'school';
    const description = typeof data.description === 'string' ? data.description : '';
    const baseColor = typeof data.color === 'string' && data.color.trim() ? data.color.trim() : '#f9a8d4';
    const allDay = data.allDay === true;
    const timePattern = /^\d{2}:\d{2}$/;
    const timeToMinutes = (timeStr) => {
      if (typeof timeStr !== 'string' || !timePattern.test(timeStr)) return null;
      const parts = timeStr.split(':');
      if (parts.length !== 2) return null;
      const [h, m] = parts.map(Number);
      if (Number.isNaN(h) || Number.isNaN(m)) return null;
      return h * 60 + m;
    };
    const normalizeTime = (value, fallback) => (typeof value === 'string' && timePattern.test(value) ? value : fallback);
    
    const defaultStart = typeof data.dayStart === 'string' && /^\d{2}:\d{2}$/.test(data.dayStart)
      ? data.dayStart
      : '00:00';
    const defaultEndCandidate = typeof data.dayEnd === 'string' && /^\d{2}:\d{2}$/.test(data.dayEnd)
      ? data.dayEnd
      : '23:59';
    // Compare times properly by converting to minutes
    const startMinutes = timeToMinutes(defaultStart) ?? 0;
    const endMinutes = timeToMinutes(defaultEndCandidate) ?? 1439; // 23:59 in minutes
    const defaultEnd = endMinutes > startMinutes ? defaultEndCandidate : '23:59';

    const dayConfigMap = new Map();
    data.schoolDays.forEach((entry) => {
      let dateStr;
      let entryAllDay = allDay;
      let startStr = defaultStart;
      let endStr = defaultEnd;
      let entryColor = baseColor;

      if (typeof entry === 'string') {
        dateStr = entry;
      } else if (entry && typeof entry === 'object') {
        dateStr = entry.date;
        if (entry.allDay === true) entryAllDay = true;
        if (entry.allDay === false) entryAllDay = false;
        startStr = normalizeTime(entry.start, defaultStart);
        endStr = normalizeTime(entry.end, defaultEnd);
        if (typeof entry.color === 'string' && entry.color.trim()) {
          entryColor = entry.color.trim();
        }
      } else {
        return;
      }

      if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return;
      dayConfigMap.set(dateStr, {
        allDay: entryAllDay,
        start: startStr,
        end: endStr,
        color: entryColor,
      });
    });

    const uniqueDates = Array.from(dayConfigMap.keys())
      .sort((a, b) => new Date(a) - new Date(b));

    let importedCount = 0;

    for (const dateStr of uniqueDates) {
      const config = dayConfigMap.get(dateStr);
      const eventAllDay = config.allDay === true;
      let startTime;
      let endTime;
      if (eventAllDay) {
        startTime = `${dateStr}T00:00`;
        endTime = `${dateStr}T23:59`;
      } else {
        const startMinutes = timeToMinutes(config.start) ?? timeToMinutes(defaultStart) ?? 0;
        let endMinutes = timeToMinutes(config.end) ?? timeToMinutes(defaultEnd) ?? (startMinutes + 60);
        if (endMinutes <= startMinutes) {
          endMinutes = startMinutes + 60;
        }
        if (endMinutes >= 24 * 60) {
          endMinutes = 23 * 60 + 59;
        }
        const formatMinutes = (min) => {
          const h = String(Math.floor(min / 60)).padStart(2, '0');
          const m = String(min % 60).padStart(2, '0');
          return `${h}:${m}`;
        };
        startTime = `${dateStr}T${formatMinutes(startMinutes)}`;
        endTime = `${dateStr}T${formatMinutes(endMinutes)}`;
      }
      const duplicate = Array.isArray(events) ? events.find((e) =>
        e.startTime === startTime &&
        e.endTime === endTime &&
        (e.title || '') === title &&
        e.isTimetable === true
      ) : null;
      if (duplicate) return;

      const newEvent = {
        title,
        description,
        startTime,
        endTime,
        allDay: eventAllDay,
        color: config.color || baseColor,
        recurrence: 'none',
        recurrenceEnd: '',
        reminderMinutes: null,
        isTimetable: true,
      };

      const newId = await addEvent(newEvent);
      if (newId) {
        importedCount++;
      }
    }

    return importedCount;
  }

  const weekdays = Array.isArray(data.weekdays) && data.weekdays.length > 0
    ? data.weekdays
    : ['月', '火', '水', '木', '金'];
  const classDaysByWeekday = data.classDays || {};
  const timetableGrid = Array.isArray(data.timetableData) ? data.timetableData : [];
  const periodTimes = Array.isArray(data.periodTimes) ? data.periodTimes : [];
  const scheduleByWeekday = data.schedule && typeof data.schedule === 'object' ? data.schedule : null;
  const title = (typeof data.title === 'string' && data.title.trim().length > 0)
    ? data.title.trim()
    : 'school';
  const description = typeof data.description === 'string' ? data.description : '';
  const baseColor = typeof data.color === 'string' && data.color.trim() ? data.color.trim() : '#f9a8d4';

  let importedCount = 0;

  if (scheduleByWeekday && periodTimes.length > 0) {
    const periodMap = new Map(periodTimes.map((p, idx) => [idx + 1, p]));
    for (const weekdaySymbol of weekdays) {
      const classDates = Array.isArray(classDaysByWeekday[weekdaySymbol])
        ? classDaysByWeekday[weekdaySymbol]
        : [];
      const periodsForDay = Array.isArray(scheduleByWeekday[weekdaySymbol])
        ? scheduleByWeekday[weekdaySymbol].map(Number).filter((n) => Number.isFinite(n) && periodMap.has(n))
        : [];
      if (periodsForDay.length === 0) continue;

      const minPeriod = Math.min(...periodsForDay);
      const maxPeriod = Math.max(...periodsForDay);
      const startPeriodTime = periodMap.get(minPeriod);
      const endPeriodTime = periodMap.get(maxPeriod);
      if (!startPeriodTime || !startPeriodTime.start || !endPeriodTime || !endPeriodTime.end) continue;

      for (const classDate of classDates) {
        if (typeof classDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(classDate)) continue;
        const startTime = `${classDate}T${startPeriodTime.start}`;
        const endTime = `${classDate}T${endPeriodTime.end}`;

        const duplicate = Array.isArray(events) ? events.find((e) =>
          e.startTime === startTime &&
          e.endTime === endTime &&
          (e.title || '') === title &&
          e.isTimetable === true
        ) : null;
        if (duplicate) continue;

        const newEvent = {
          title,
          description,
          startTime,
          endTime,
          color: baseColor,
          allDay: false,
          recurrence: 'none',
          recurrenceEnd: '',
          reminderMinutes: null,
          isTimetable: true,
        };

        const newId = await addEvent(newEvent);
        if (newId) {
          importedCount++;
        }
      }
    }
    return importedCount;
  }

  for (const [weekdayIndex, weekdaySymbol] of weekdays.entries()) {
    const classDates = Array.isArray(classDaysByWeekday[weekdaySymbol])
      ? classDaysByWeekday[weekdaySymbol]
      : [];

    for (const classDate of classDates) {
      if (!classDate || typeof classDate !== 'string') continue;

      for (let periodIndex = 0; periodIndex < timetableGrid.length; periodIndex += 1) {
        const subjectsForPeriod = timetableGrid[periodIndex];
        const subjectEntry = subjectsForPeriod?.[weekdayIndex];
        const subjectName = typeof subjectEntry === 'object' ? subjectEntry.title : subjectEntry;
        if (!subjectName || subjectName.trim() === '') continue;

        const periodTime = periodTimes[periodIndex];
        if (!periodTime || !periodTime.start || !periodTime.end) continue;

        const startTime = `${classDate}T${periodTime.start}`;
        const endTime = `${classDate}T${periodTime.end}`;
        const descriptionLabel = `${periodIndex + 1}限`;

        const duplicate = Array.isArray(events) ? events.find(e =>
          e.startTime === startTime &&
          e.endTime === endTime &&
          (e.title || '') === subjectName &&
          (e.description || '').includes(descriptionLabel) &&
          e.isTimetable === true
        ) : null;
        if (duplicate) continue;

        const newEvent = {
          title: subjectName,
          description: descriptionLabel,
          startTime,
          endTime,
          color: baseColor,
          recurrence: 'none',
          recurrenceEnd: '',
          reminderMinutes: null,
          isTimetable: true
        };

        const newId = await addEvent(newEvent);
        if (newId) {
          importedCount++;
        }
      }
    }
  }

  return importedCount;
}

// 日付計算
function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

// 月の計算
function addMonths(date, months) {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

// ビュー切り替え
function switchView(view) {
  // すべてのビューを非アクティブに
  const dayView = safeGetElementById('dayView');
  const weekView = safeGetElementById('weekView');
  const monthView = safeGetElementById('monthView');
  const dayViewBtn = safeGetElementById('dayViewBtn');
  const weekViewBtn = safeGetElementById('weekViewBtn');
  const monthViewBtn = safeGetElementById('monthViewBtn');
  
  if (dayView) dayView.classList.remove('active');
  if (weekView) weekView.classList.remove('active');
  if (monthView) monthView.classList.remove('active');
  if (dayViewBtn) dayViewBtn.classList.remove('active');
  if (weekViewBtn) weekViewBtn.classList.remove('active');
  if (monthViewBtn) monthViewBtn.classList.remove('active');
  
  // ヘッダーのクラスをリセット
  const header = document.querySelector('.header');
  if (header) header.classList.remove('month-view-active');
  
  // 選択されたビューをアクティブに
  if (view === 'day') {
    if (dayView) dayView.classList.add('active');
    if (dayViewBtn) dayViewBtn.classList.add('active');
  } else if (view === 'week') {
    if (weekView) weekView.classList.add('active');
    if (weekViewBtn) weekViewBtn.classList.add('active');
  } else if (view === 'month') {
    if (monthView) monthView.classList.add('active');
    if (monthViewBtn) monthViewBtn.classList.add('active');
    // 月次ビュー時はヘッダーにクラスを追加（矢印を非表示にしない）
    // if (header) header.classList.add('month-view-active');
  }
}

// 週の開始日を取得（日曜日）
function getWeekStart(date) {
  const result = new Date(date);
  const day = result.getDay();
  result.setDate(result.getDate() - day);
  result.setHours(0, 0, 0, 0);
  return result;
}

// HTMLエスケープ
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = String(text);
  return div.innerHTML;
}

// 入力値をサニタイズ
function sanitizeInput(input) {
  if (typeof input !== 'string') return input;
  // HTMLタグを削除し、危険な文字をエスケープ
  return input
    .trim()
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

// テキスト入力のサニタイズ（HTMLタグは削除、特殊文字は保持）
function sanitizeTextInput(input) {
  if (typeof input !== 'string') return '';
  return input.trim();
}

// HTMLコンテンツのサニタイズ（Quillで使用される安全なHTMLタグのみ許可）
function sanitizeHTML(html) {
  if (typeof html !== 'string') return '';
  
  // 一時的なdiv要素を作成してHTMLをパース
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = html;
  
  // 許可するタグと属性
  const allowedTags = ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'ul', 'ol', 'li', 'a', 'h1', 'h2', 'h3', 'span'];
  const allowedAttributes = {
    'a': ['href', 'target'],
    'span': ['style'],
    'p': ['style']
  };
  
  // 再帰的に要素をサニタイズ
  function sanitizeNode(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.cloneNode(true);
    }
    
    if (node.nodeType === Node.ELEMENT_NODE) {
      const tagName = node.tagName.toLowerCase();
      
      if (!allowedTags.includes(tagName)) {
        // 許可されていないタグは内容のみを保持
        const fragment = document.createDocumentFragment();
        Array.from(node.childNodes).forEach(child => {
          const sanitized = sanitizeNode(child);
          if (sanitized) {
            fragment.appendChild(sanitized);
          }
        });
        return fragment;
      }
      
      // 許可されたタグの場合は要素を作成
      const newElement = document.createElement(tagName);
      
      // 許可された属性のみをコピー
      const allowedAttrs = allowedAttributes[tagName] || [];
      Array.from(node.attributes).forEach(attr => {
        if (allowedAttrs.includes(attr.name.toLowerCase())) {
          if (attr.name === 'href') {
            // href属性は安全なURLのみ許可
            try {
              const url = new URL(attr.value, window.location.href);
              if (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:') {
                newElement.setAttribute(attr.name, attr.value);
              }
            } catch (e) {
              // 無効なURLは無視
            }
          } else if (attr.name === 'style') {
            // style属性は基本的なスタイルのみ許可（色、背景色など）
            const safeStyles = attr.value.match(/(color|background-color):\s*[^;]+/gi);
            if (safeStyles) {
              newElement.setAttribute(attr.name, safeStyles.join('; '));
            }
          } else {
            newElement.setAttribute(attr.name, attr.value);
          }
        }
      });
      
      // 子要素を再帰的にサニタイズ
      Array.from(node.childNodes).forEach(child => {
        const sanitized = sanitizeNode(child);
        if (sanitized) {
          if (sanitized.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
            Array.from(sanitized.childNodes).forEach(fragChild => {
              newElement.appendChild(fragChild);
            });
          } else {
            newElement.appendChild(sanitized);
          }
        }
      });
      
      return newElement;
    }
    
    return null;
  }
  
  // すべての子ノードをサニタイズ
  const fragment = document.createDocumentFragment();
  Array.from(tempDiv.childNodes).forEach(child => {
    const sanitized = sanitizeNode(child);
    if (sanitized) {
      if (sanitized.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
        Array.from(sanitized.childNodes).forEach(fragChild => {
          fragment.appendChild(fragChild);
        });
      } else {
        fragment.appendChild(sanitized);
      }
    }
  });
  
  // サニタイズされたHTMLを文字列として返す
  const resultDiv = document.createElement('div');
  resultDiv.appendChild(fragment);
  return resultDiv.innerHTML;
}

// HTMLからテキストのみを抽出（文字数カウント用）
function getTextFromHTML(html) {
  if (typeof html !== 'string') return '';
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = html;
  return tempDiv.textContent || tempDiv.innerText || '';
}

// ID生成関数
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// イベントバリデーション
function validateEvent(event) {
  const errors = [];
  
  // タイトルは空でも許可
  if (event.title && event.title.length > 100) {
    errors.push('タイトルは100文字以内で入力してください');
  }
  
  if (!event.startTime) {
    errors.push(event.allDay ? '開始日を入力してください' : '開始時刻を入力してください');
  }
  
  if (!event.endTime) {
    errors.push(event.allDay ? '終了日を入力してください' : '終了時刻を入力してください');
  }
  
  if (event.startTime && event.endTime) {
    const start = new Date(event.startTime);
    const end = new Date(event.endTime);
    
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      errors.push('無効な日付形式です');
    } else if (end <= start) {
      errors.push(event.allDay ? '終了日は開始日以降にしてください' : '終了時刻は開始時刻より後にしてください');
    }
  }
  
  if (event.description && event.description.length > 500) {
    errors.push('説明は500文字以内で入力してください');
  }
  
  // 繰り返しのバリデーション
  if (event.recurrence && event.recurrence !== 'none') {
    if (event.recurrenceEnd) {
      if (!event.startTime) {
        errors.push('繰り返しを設定するには開始時刻が必要です');
      } else {
        const start = new Date(event.startTime);
        // recurrenceEnd is a date-only string (YYYY-MM-DD), so we need to parse it correctly
        const recurEndStr = (event.recurrenceEnd && typeof event.recurrenceEnd === 'string' && event.recurrenceEnd.includes('T'))
          ? event.recurrenceEnd 
          : (event.recurrenceEnd || '') + 'T23:59:59';
        const recurEnd = new Date(recurEndStr);
        if (Number.isNaN(start.getTime()) || Number.isNaN(recurEnd.getTime())) {
          errors.push('繰り返し終了日の形式が正しくありません');
        } else if (recurEnd < start) {
          errors.push('繰り返し終了日は開始日以降にしてください');
        }
      }
    }
  }
  
  return errors;
}


// 初期化（combiと同じロジック）
document.addEventListener('DOMContentLoaded', function() {
  
  // Quill editor を初期化（拡張されたビジュアルエディタ）
  const descContainer = document.getElementById('eventDescription');
  if (descContainer && typeof Quill !== 'undefined') {
    quillEditor = new Quill('#eventDescription', {
      theme: 'snow',
      placeholder: '説明を入力...（リッチテキスト、画像、リンクなどが使用できます）',
      modules: {
        toolbar: {
          container: [
            [{ 'header': [1, 2, 3, false] }],
            ['bold', 'italic', 'underline', 'strike'],
            [{ 'list': 'ordered'}, { 'list': 'bullet' }, 'blockquote', 'code-block'],
            [{ 'align': [] }],
            [{ 'color': [] }, { 'background': [] }],
            ['link', 'image'],
            ['clean']
          ],
          handlers: {
            'image': function() {
              const input = document.createElement('input');
              input.setAttribute('type', 'file');
              input.setAttribute('accept', 'image/*');
              input.click();
              
              input.onchange = () => {
                const file = input.files[0];
                if (file) {
                  // ファイルをData URLとして読み込む（実際のアプリではサーバーにアップロードすることを推奨）
                  const reader = new FileReader();
                  reader.onload = (e) => {
                    const range = this.quill.getSelection(true);
                    this.quill.insertEmbed(range.index, 'image', e.target.result, 'user');
                    this.quill.setSelection(range.index + 1);
                  };
                  reader.readAsDataURL(file);
                }
              };
            }
          }
        }
      }
    });
    
    // Quillの内容変更時にhidden inputを更新
    quillEditor.on('text-change', function() {
      const hiddenInput = document.getElementById('eventDescriptionInput');
      if (hiddenInput) {
        const html = quillEditor.root.innerHTML;
        // 空のコンテンツ（<p><br></p>のみ）の場合は空文字列に
        hiddenInput.value = html === '<p><br></p>' ? '' : html;
      }
    });
    
  } else if (descContainer) {
  }
  
  // Firebase接続チェック
  if (!checkFirebase()) {
    showMessage('Firebaseに接続できません。設定を確認してから再読み込みしてください。', 'error', 6000);
    return;
  }
  
  // イベントを読み込み
  loadEvents();
  
  // イベントリスナーを登録
  setupEventListeners();

  // 日次グリッドでのクリック追加を有効化
  enableDayGridClickToCreate();
  // 週次グリッドでのクリック追加を有効化
  enableWeekGridClickToCreate();
  
  startAutomaticGoogleSync();
});

window.addEventListener('beforeunload', () => {
  // Firebaseリスナーのクリーンアップ
  if (typeof unsubscribeEvents === 'function') {
    unsubscribeEvents();
    unsubscribeEvents = null;
  }
  // すべてのイベントリスナーのクリーンアップ
  eventListeners.removeAll();
  clearScheduledNotifications();
  stopAutomaticGoogleSync();
});

// イベントリスナーの設定
function setupEventListeners() {
  // 既存のリスナーをクリーンアップ（再初期化時）
  eventListeners.removeAll();
  
  // 日付ナビゲーション（日次・週次・月次用）
  const prevDayBtn = safeGetElementById('prevDay');
  if (prevDayBtn) {
    const handler = () => {
      try {
      if (currentView === 'day') {
        currentDate = addDays(currentDate, -1);
      } else if (currentView === 'week') {
        currentDate = addDays(currentDate, -7);
      } else if (currentView === 'month') {
        currentDate = addMonths(currentDate, -1);
      }
      updateViews();
      } catch (error) {
        showMessage('日付の移動に失敗しました。', 'error', 3000);
      }
    };
    eventListeners.add(prevDayBtn, 'click', handler);
  }
  
  const nextDayBtn = safeGetElementById('nextDay');
  if (nextDayBtn) {
    const handler = () => {
      try {
      if (currentView === 'day') {
        currentDate = addDays(currentDate, 1);
      } else if (currentView === 'week') {
        currentDate = addDays(currentDate, 7);
      } else if (currentView === 'month') {
        currentDate = addMonths(currentDate, 1);
      }
      updateViews();
      } catch (error) {
        showMessage('日付の移動に失敗しました。', 'error', 3000);
      }
    };
    eventListeners.add(nextDayBtn, 'click', handler);
  }
  
  // 月次ナビゲーション（ヘッダーの矢印を使用）
  // prevDay/nextDay が月次ビュー時は前月/翌月に動作するように既に実装済み
  
  const todayBtn = safeGetElementById('todayBtn');
  if (todayBtn) {
    const handler = () => {
      try {
      currentDate = new Date();
      updateViews();
      } catch (error) {
        showMessage('今日の日付への移動に失敗しました。', 'error', 3000);
      }
    };
    eventListeners.add(todayBtn, 'click', handler);
  }
  
  // ビュー切り替え
  const dayViewBtn = safeGetElementById('dayViewBtn');
  if (dayViewBtn) {
    const handler = () => {
      try {
      currentView = 'day';
      switchView('day');
      updateViews();
      } catch (error) {
        showMessage('ビューの切り替えに失敗しました。', 'error', 3000);
      }
    };
    eventListeners.add(dayViewBtn, 'click', handler);
  }
  
  const weekViewBtn = safeGetElementById('weekViewBtn');
  if (weekViewBtn) {
    const handler = () => {
      try {
      currentView = 'week';
      switchView('week');
      updateViews();
      } catch (error) {
        showMessage('ビューの切り替えに失敗しました。', 'error', 3000);
      }
    };
    eventListeners.add(weekViewBtn, 'click', handler);
  }
  
  const monthViewBtn = safeGetElementById('monthViewBtn');
  if (monthViewBtn) {
    const handler = () => {
      try {
      currentView = 'month';
      switchView('month');
      updateViews();
      } catch (error) {
        showMessage('ビューの切り替えに失敗しました。', 'error', 3000);
      }
    };
    eventListeners.add(monthViewBtn, 'click', handler);
  }
  
  const startInput = safeGetElementById('eventStartTime');
  const endInput = safeGetElementById('eventEndTime');
  const allDayCheckbox = safeGetElementById('eventAllDay');
  const allDayRow = safeGetElementById('allDayDateRow');
  const allDayStartInput = safeGetElementById('eventAllDayStart');
  const allDayEndInput = safeGetElementById('eventAllDayEnd');

  if (allDayCheckbox) {
    const handler = () => {
      try {
      if (allDayCheckbox.disabled) return;
      const isAllDay = allDayCheckbox.checked;
      applyAllDayMode(isAllDay, { startInput, endInput, allDayRow });
      if (isAllDay) {
        if (allDayStartInput && !allDayStartInput.value) {
          const source = startInput?.value || formatDateTimeLocal(new Date());
          allDayStartInput.value = formatDateOnly(source);
        }
        if (allDayEndInput && !allDayEndInput.value) {
          allDayEndInput.value = allDayStartInput.value;
        }
      }
      } catch (error) {
        showMessage('終日イベントの設定に失敗しました。', 'error', 3000);
      }
    };
    eventListeners.add(allDayCheckbox, 'change', handler);
  }
  
  const dayAllDayContainer = safeGetElementById('dayAllDayContainer');
  if (dayAllDayContainer) {
    const handler = () => {
      try {
      openAllDayCreateModal(new Date(currentDate));
      } catch (error) {
        showMessage('終日イベントの作成に失敗しました。', 'error', 3000);
      }
    };
    eventListeners.add(dayAllDayContainer, 'click', handler);
  }

  document.querySelectorAll('.week-all-day-columns .all-day-column').forEach((column) => {
    const handler = () => {
      try {
      const dayIndex = Number(column.dataset.day || 0);
      const weekStart = getWeekStart(currentDate);
      const targetDate = new Date(weekStart);
      targetDate.setDate(weekStart.getDate() + dayIndex);
      openAllDayCreateModal(targetDate);
      } catch (error) {
        showMessage('終日イベントの作成に失敗しました。', 'error', 3000);
      }
    };
    eventListeners.add(column, 'click', handler);
  });

  const weekHeaderCells = document.querySelectorAll('#weekView .week-header .day-header-cell');
  const handleWeekHeaderSelect = (dayIndex) => {
    try {
    const weekStart = getWeekStart(currentDate);
    const targetDate = new Date(weekStart);
    targetDate.setDate(weekStart.getDate() + dayIndex);
    currentDate = targetDate;
    currentView = 'day';
    switchView('day');
    updateViews();
    } catch (error) {
      showMessage('日付の選択に失敗しました。', 'error', 3000);
    }
  };
  weekHeaderCells.forEach((cell) => {
    const dayIndex = Number(cell.dataset.day || 0);
    const clickHandler = () => handleWeekHeaderSelect(dayIndex);
    const keypressHandler = (e) => {
      try {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleWeekHeaderSelect(dayIndex);
      }
      } catch (error) {
      }
    };
    eventListeners.add(cell, 'click', clickHandler);
    eventListeners.add(cell, 'keypress', keypressHandler);
  });

  if (allDayStartInput) {
    const handler = () => {
      try {
      if (!allDayEndInput || !allDayStartInput.value) return;
      if (!allDayEndInput.value || new Date(allDayEndInput.value) < new Date(allDayStartInput.value)) {
        allDayEndInput.value = allDayStartInput.value;
      }
      } catch (error) {
      }
    };
    eventListeners.add(allDayStartInput, 'change', handler);
  }
  
  // モーダル関連
  const closeModalBtn = safeGetElementById('closeModal');
  if (closeModalBtn) {
    eventListeners.add(closeModalBtn, 'click', closeEventModal);
  }
  
  // モーダル外クリックで閉じる
  const eventModal = safeGetElementById('eventModal');
  if (eventModal) {
    const handler = (e) => {
      try {
      if (e.target.id === 'eventModal') {
        closeEventModal();
      }
      } catch (error) {
      }
    };
    eventListeners.add(eventModal, 'click', handler);
  }
  
  // ESCキーでモーダルを閉じる
  const escHandler = (e) => {
    try {
    if (e.key === 'Escape') {
      const modal = safeGetElementById('eventModal');
      if (modal && modal.classList.contains('show')) {
        closeEventModal();
      }
    }
    } catch (error) {
    }
  };
  eventListeners.add(document, 'keydown', escHandler);
  
  // フォーム送信
  const eventForm = safeGetElementById('eventForm');
  if (!eventForm) {
    return;
  }
  
  const submitHandler = async (e) => {
    e.preventDefault();
    
    // Prevent double submission
    if (eventForm.dataset.submitting === 'true') {
      return;
    }
    eventForm.dataset.submitting = 'true';
    
    try {
      showLoading('保存中...');
      
      const formData = new FormData(e.target);
      const isAllDay = formData.get('allDay') === 'on';
      
      // 入力値をサニタイズ
      const title = sanitizeTextInput(formData.get('title') || '');
      // Quill editorから内容を取得してサニタイズ
      let description = '';
      if (quillEditor) {
        const html = quillEditor.root.innerHTML;
        const rawDescription = html === '<p><br></p>' ? '' : html;
        description = sanitizeHTML(rawDescription);
      } else {
        description = sanitizeTextInput(formData.get('description') || '');
      }
      
      const event = {
        title: title,
        description: description,
        startTime: formData.get('startTime'),
        endTime: formData.get('endTime'),
        allDay: isAllDay,
        color: formData.get('color'),
        recurrence: (formData.get('recurrence') || 'none'),
        recurrenceEnd: formData.get('recurrenceEnd') || '',
        reminderMinutes: (() => {
          const value = formData.get('reminderMinutes');
          if (!value) return null;
          const num = Number(value);
          return Number.isFinite(num) && num >= 0 ? num : null;
        })()
      };
    if (isAllDay) {
      const allDayStart = formData.get('allDayStart');
      const allDayEnd = formData.get('allDayEnd') || allDayStart;
      event.startTime = allDayStart ? `${allDayStart}T00:00` : '';
      event.endTime = allDayEnd ? `${allDayEnd}T23:59` : '';
    }
    const existingEvent = editingEventId && Array.isArray(events) ? events.find(e => e.id === editingEventId) : null;
    if (existingEvent?.isTimetable) {
      event.startTime = existingEvent.startTime;
      event.endTime = existingEvent.endTime;
    }
    
      // バリデーション
      const errors = validateEvent(event);
      if (errors.length > 0) {
        hideLoading();
        showMessage(errors.join(' / '), 'error', 6000);
        return;
      }
      
      if (editingEventId && typeof editingEventId === 'string' && editingEventId.startsWith('temp-')) {
        // 一時的イベントを正式なイベントに変換
        if (!Array.isArray(events)) {
          hideLoading();
          showMessage('イベントの保存に失敗しました。', 'error', 6000);
          return;
        }
        const tempEventIndex = events.findIndex(e => e.id === editingEventId);
        if (tempEventIndex !== -1) {
          // 一時的イベントを削除
          events.splice(tempEventIndex, 1);
        }
        
        // 新しいイベントを作成
        // Note: addEvent will generate its own ID, so we don't set id here
        const newEvent = {
          title: event.title,
          description: event.description,
          startTime: event.startTime,
          endTime: event.endTime,
          allDay: event.allDay === true,
          color: event.color,
          recurrence: event.recurrence,
          recurrenceEnd: event.recurrenceEnd,
          reminderMinutes: event.reminderMinutes,
          createdAt: new Date().toISOString()
        };
        
        // Firebaseに保存（成功後にローカル配列を更新）
        const newId = await addEvent(newEvent);
        if (newId && !isFirebaseEnabled) {
          // Firebaseが無効な場合のみローカル配列に追加
          newEvent.id = newId;
          events.push(newEvent);
        }
      } else if (editingEventId) {
        // 既存イベントを更新
        // Firebase更新を先に実行し、成功後にローカル配列を更新
        await updateEvent(editingEventId, event);
        // ローカル配列も更新（Firebaseのリアルタイム更新で上書きされる可能性があるが、即座のUI更新のため）
        if (Array.isArray(events)) {
          const eventIndex = events.findIndex(e => e.id === editingEventId);
          if (eventIndex !== -1) {
            events[eventIndex] = {
              ...events[eventIndex],
              title: event.title,
              description: event.description,
              startTime: event.startTime,
              endTime: event.endTime,
              allDay: event.allDay === true,
              color: event.color,
              recurrence: event.recurrence,
              recurrenceEnd: event.recurrenceEnd,
              reminderMinutes: event.reminderMinutes,
              updatedAt: new Date().toISOString()
            };
          }
        }
      } else {
        // 新規イベントを作成
        const newId = await addEvent(event);
        if (newId && !isFirebaseEnabled) {
          // Firebaseが無効な場合のみローカル配列に追加
          const newEvent = { ...event, id: newId, createdAt: new Date().toISOString() };
          events.push(newEvent);
        }
      }
      
      hideLoading();
      closeEventModal();
      showMessage(editingEventId ? '予定を更新しました' : '予定を追加しました', 'success', 3000);
    } catch (error) {
      hideLoading();
      showMessage('イベントの保存に失敗しました。再度お試しください。', 'error', 6000);
    } finally {
      // Reset submission flag
      delete eventForm.dataset.submitting;
    }
  };
  eventListeners.add(eventForm, 'submit', submitHandler);
  
  // 削除ボタン
  const deleteBtn = safeGetElementById('deleteBtn');
  if (deleteBtn) {
    const deleteHandler = async () => {
      if (!editingEventId) return;
      
      const confirmed = await showConfirmModal('この予定を削除してもよろしいですか？', '削除の確認');
      if (confirmed) {
        try {
          showLoading('削除中...');
          await deleteEvent(editingEventId);
          hideLoading();
          closeEventModal();
          showMessage('予定を削除しました', 'success', 3000);
        } catch (error) {
          hideLoading();
          showMessage('イベントの削除に失敗しました。', 'error', 6000);
        }
      }
    };
    eventListeners.add(deleteBtn, 'click', deleteHandler);
  }
  
  // 繰り返し選択時の処理
  const recurrenceSelect = safeGetElementById('eventRecurrence');
  const recurrenceEndGroup = safeGetElementById('recurrenceEndGroup');
  if (recurrenceSelect && recurrenceEndGroup) {
    const handler = () => {
      try {
      const value = recurrenceSelect.value;
      if (value && value !== 'none') {
        recurrenceEndGroup.classList.remove('hidden');
      } else {
        recurrenceEndGroup.classList.add('hidden');
      }
      } catch (error) {
      }
    };
    eventListeners.add(recurrenceSelect, 'change', handler);
  }
}

// 日次グリッドでのクリック/範囲選択作成
function enableDayGridClickToCreate() {
  const container = safeGetElementById('dayEventContainer');
  if (!container) return;

  let isSelecting = false;
  let selectionStart = null;
  let selectionPreview = null;
  let hasMoved = false;
  let startTime = null;
  let tempEventId = null;

  container.addEventListener('mousedown', (e) => {
    // 既存イベントクリックは除外
    if (e.target.closest('.event-item')) return;
    // リサイズハンドルクリックは除外
    if (e.target.classList.contains('resize-handle')) return;

    e.preventDefault();
    isSelecting = true;
    hasMoved = false;
    container.classList.add('selecting');

    const rect = container.getBoundingClientRect();
    const offsetY = e.clientY - rect.top + container.scrollTop;
    selectionStart = offsetY;
    startTime = Date.now();

    // 選択プレビュー要素を作成
    selectionPreview = document.createElement('div');
    selectionPreview.className = 'selection-preview';
    selectionPreview.style.top = `${offsetY}px`;
    selectionPreview.style.height = '0px';
    container.appendChild(selectionPreview);

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp, { once: true });
  });

  function onMouseMove(e) {
    if (!isSelecting || !selectionPreview) return;

    hasMoved = true;

    const rect = container.getBoundingClientRect();
    const offsetY = e.clientY - rect.top + container.scrollTop;
    
    const startY = Math.min(selectionStart, offsetY);
    const endY = Math.max(selectionStart, offsetY);
    
    selectionPreview.style.top = `${startY}px`;
    selectionPreview.style.height = `${endY - startY}px`;
  }

  function onMouseUp(e) {
    if (!isSelecting || !selectionPreview) return;

    isSelecting = false;
    container.classList.remove('selecting');
    
    const rect = container.getBoundingClientRect();
    const offsetY = e.clientY - rect.top + container.scrollTop;
    
    const startY = Math.min(selectionStart, offsetY);
    const endY = Math.max(selectionStart, offsetY);
    
    // 選択プレビューを削除
    if (selectionPreview && selectionPreview.parentNode) {
      selectionPreview.remove();
    }
    document.removeEventListener('mousemove', onMouseMove);
    selectionPreview = null;

    // 15分単位に丸める
    const hourHeight = getHourHeight();
    const quarterHourHeight = hourHeight / 4; // 15分の高さ
    const minutesFromTopStart = Math.max(0, Math.round(startY / hourHeight * 60 / 15) * 15);
    const minutesFromTopEnd = Math.max(0, Math.round(endY / hourHeight * 60 / 15) * 15);
    
    const baseDate = new Date(currentDate);
    baseDate.setHours(0, 0, 0, 0);
    const startTotalMinutes = VISIBLE_START_HOUR * 60 + minutesFromTopStart;
    const endTotalMinutes = VISIBLE_START_HOUR * 60 + minutesFromTopEnd;
    const start = new Date(baseDate.getTime() + startTotalMinutes * 60 * 1000);
    
    // クリック（移動なし）の場合は2時間の予定を作成
    let end;
    if (!hasMoved || (endY - startY) < quarterHourHeight) { // 15分未満の移動はクリックとみなす
      end = new Date(start.getTime() + 2 * 60 * 60 * 1000); // 2時間
    } else {
      const clampedEndTotalMinutes = Math.max(startTotalMinutes + 15, Math.min(endTotalMinutes, (VISIBLE_END_HOUR + 1) * 60));
      end = new Date(baseDate.getTime() + clampedEndTotalMinutes * 60 * 1000);
    }

    // 一時的なイベントを作成して表示
    const tempEvent = {
      id: 'temp-' + Date.now(),
      title: '',
      description: '',
      startTime: formatDateTimeLocal(start),
      endTime: formatDateTimeLocal(end),
      color: '#3b82f6',
      createdAt: new Date().toISOString(),
      isTemporary: true
    };

    // 一時的なイベントを配列に追加
    events.push(tempEvent);
    tempEventId = tempEvent.id;

    // ビューを更新（一時的なイベントを表示）
    updateViews();

    // モーダルを既定値付きで開く
    showEventModal(tempEventId);
    const startTimeInput = safeGetElementById('eventStartTime');
    const endTimeInput = safeGetElementById('eventEndTime');
    if (startTimeInput) startTimeInput.value = formatDateTimeLocal(start);
    if (endTimeInput) endTimeInput.value = formatDateTimeLocal(end);
  }
}

function openAllDayCreateModal(date) {
  const isoDate = formatDateOnly(date);
  const allDayCheckbox = safeGetElementById('eventAllDay');
  const allDayRow = safeGetElementById('allDayDateRow');
  const allDayStartInput = safeGetElementById('eventAllDayStart');
  const allDayEndInput = safeGetElementById('eventAllDayEnd');
  
  // 新規作成モードでモーダルを開く（フォームがクリアされる）
  showEventModal();
  
  // 終日モードを設定
  if (allDayCheckbox) {
    allDayCheckbox.checked = true;
  }
  applyAllDayMode(true, {
    startInput: safeGetElementById('eventStartTime'),
    endInput: safeGetElementById('eventEndTime'),
    allDayRow,
  });
  
  // 終日イベントの日付を設定
  if (allDayStartInput) allDayStartInput.value = isoDate;
  if (allDayEndInput) allDayEndInput.value = isoDate;
  
  // 念のため、タイトルと説明を明示的にクリア（前回の値が残らないように）
  const titleInput = safeGetElementById('eventTitle');
  const descInput = safeGetElementById('eventDescription');
  if (titleInput) titleInput.value = '';
  if (descInput) descInput.value = '';
}

// 週次グリッドでのクリック作成（クリック位置の時間で1時間の予定をモーダルで作成）
function enableWeekGridClickToCreate() {
  const dayContainers = document.querySelectorAll('.week-day .day-events-container');
  dayContainers.forEach((container, dayIndex) => {
    container.addEventListener('click', (e) => {
      // 既存イベントクリックは除外
      if (e.target.closest('.event-item')) return;
      
      const rect = container.getBoundingClientRect();
      const offsetY = e.clientY - rect.top + container.scrollTop;
      
      // 15分単位に丸める
      const hourHeight = getHourHeight();
      const minutesFromTop = Math.max(0, Math.round(offsetY / hourHeight * 60 / 15) * 15);
      const totalStartMinutes = VISIBLE_START_HOUR * 60 + minutesFromTop;
      const totalEndMinutes = Math.min(totalStartMinutes + 60, (VISIBLE_END_HOUR + 1) * 60);
      const referenceWeekStart = getWeekStart(currentDate);
      const clickedDate = new Date(referenceWeekStart);
      clickedDate.setDate(referenceWeekStart.getDate() + dayIndex);
      clickedDate.setHours(0, 0, 0, 0);

      const start = new Date(clickedDate.getTime() + totalStartMinutes * 60000);
      const end = new Date(clickedDate.getTime() + totalEndMinutes * 60000);
      
      // モーダルを開く（既定値セット）
      showEventModal();
      const startTimeInput = safeGetElementById('eventStartTime');
      const endTimeInput = safeGetElementById('eventEndTime');
      if (startTimeInput) startTimeInput.value = formatDateTimeLocal(start);
      if (endTimeInput) endTimeInput.value = formatDateTimeLocal(end);
    });
  });
}

// リサイズ（上下）処理とドラッグ移動処理
function attachResizeHandlers() {
  const items = document.querySelectorAll('.event-item');
  
  items.forEach((item) => {
    if (item.dataset.resizeBound === 'true') {
      return;
    }
    item.dataset.resizeBound = 'true';
    const id = item.dataset.eventId;
    const eventData = Array.isArray(events) ? events.find(ev => ev.id === id) : null;
    const topHandle = item.querySelector('.resize-handle.top');
    const bottomHandle = item.querySelector('.resize-handle.bottom');
    if (!eventData) return;

    if (isAllDayEvent(eventData)) {
      if (topHandle) topHandle.style.display = 'none';
      if (bottomHandle) bottomHandle.style.display = 'none';
      return;
    }

    if (eventData.isTimetable === true) {
      if (topHandle) topHandle.style.display = 'none';
      if (bottomHandle) bottomHandle.style.display = 'none';
      item.classList.add('timetable-locked');
      return;
    }

    if (!topHandle || !bottomHandle) return;
    
    const isMobile = window.innerWidth <= 640; // モバイル判定を各アイテムで実行
    
    // モバイルではリサイズハンドルを非表示
    if (isMobile) {
      topHandle.style.display = 'none';
      bottomHandle.style.display = 'none';
    }

    let startY = 0;
    let originalStart = null;
    let originalEnd = null;
    let resizing = null; // 'top' | 'bottom' | 'move'
    let originalTop = 0;
    let hasDragged = false; // ドラッグが実際に発生したかを追跡

    // リサイズハンドル用のマウスダウン
    function onMouseDown(handle, edge) {
      return (e) => {
        e.stopPropagation();
        const ev = Array.isArray(events) ? events.find(ev => ev.id === id) : null;
        if (!ev || ev.isTimetable === true || !ev.startTime || !ev.endTime) return;
        const startDate = new Date(ev.startTime);
        const endDate = new Date(ev.endTime);
        if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return;
        startY = e.clientY;
        originalStart = startDate;
        originalEnd = endDate;
        resizing = edge;
        item.classList.add('resizing');
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp, { once: true });
      };
    }

    // イベント本体のドラッグ移動用のマウスダウン
    function onEventMouseDown(e) {
      // リサイズハンドルクリックは除外
      if (e.target.classList.contains('resize-handle')) return;
      
      e.stopPropagation();
      const ev = Array.isArray(events) ? events.find(ev => ev.id === id) : null;
      if (!ev || ev.isTimetable === true || !ev.startTime || !ev.endTime) return;
      const startDate = new Date(ev.startTime);
      const endDate = new Date(ev.endTime);
      if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return;
      
      
      startY = e.clientY;
      originalStart = startDate;
      originalEnd = endDate;
      originalTop = parseFloat(item.style.top) || 0;
      resizing = 'move';
      hasDragged = false; // ドラッグ開始時にリセット
      item.classList.add('dragging');
      console.log(`[DRAG START] Event ${id}, startY: ${startY}`);
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp, { once: true });
    }

    // タッチイベント用の関数
    function onEventTouchStart(e) {
      // リサイズハンドルクリックは除外
      if (e.target.classList.contains('resize-handle')) return;
      
      e.preventDefault(); // スクロールを防ぐ
      e.stopPropagation();
      const ev = Array.isArray(events) ? events.find(ev => ev.id === id) : null;
      if (!ev || ev.isTimetable === true) return;
      
      
      if (!e.touches || e.touches.length === 0) return;
      if (!ev.startTime || !ev.endTime) return;
      const startDate = new Date(ev.startTime);
      const endDate = new Date(ev.endTime);
      if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return;
      const touch = e.touches[0];
      startY = touch.clientY;
      originalStart = startDate;
      originalEnd = endDate;
      originalTop = parseFloat(item.style.top) || 0;
      resizing = 'move';
      item.classList.add('dragging');
      window.addEventListener('touchmove', onTouchMove, { passive: false });
      window.addEventListener('touchend', onTouchEnd, { once: true });
    }

    function onMouseMove(e) {
      const hourHeight = getHourHeight();
      const dy = e.clientY - startY;
      const minutesDelta = Math.round(dy / hourHeight * 60 / 15) * 15; // 15分単位に丸める

      // ドラッグが実際に発生したかを検知（5px以上の移動でドラッグとみなす）
      if (Math.abs(dy) >= 5) {
        hasDragged = true;
      }

      console.log(`[DRAG MOVE] dy: ${dy}, hasDragged: ${hasDragged}, minutesDelta: ${minutesDelta}`);
      
      if (resizing === 'top') {
        const newStart = new Date(originalStart.getTime() + minutesDelta * 60000);
        if (newStart < originalEnd) {
          // プレビュー: 位置と高さを更新（VISIBLE_START_HOURを考慮）
          const startMinutesTotal = newStart.getHours() * 60 + newStart.getMinutes();
          const endMinutesTotal = originalEnd.getHours() * 60 + originalEnd.getMinutes();
          const visibleStartMinutes = VISIBLE_START_HOUR * 60;
          const startMinutesFromVisible = Math.max(0, startMinutesTotal - visibleStartMinutes);
          const endMinutesFromVisible = Math.max(startMinutesFromVisible + 15, endMinutesTotal - visibleStartMinutes);
          const top = (startMinutesFromVisible / 60) * hourHeight;
          const endTop = (endMinutesFromVisible / 60) * hourHeight;
          item.style.top = `${top}px`;
          item.style.height = `${Math.max(endTop - top, MIN_EVENT_HEIGHT_PX)}px`;
        }
      } else if (resizing === 'bottom') {
        const newEnd = new Date(originalEnd.getTime() + minutesDelta * 60000);
        if (newEnd > originalStart) {
          // プレビュー: 高さ更新（VISIBLE_START_HOURを考慮）
          const startMinutesTotal = originalStart.getHours() * 60 + originalStart.getMinutes();
          const endMinutesTotal = newEnd.getHours() * 60 + newEnd.getMinutes();
          const visibleStartMinutes = VISIBLE_START_HOUR * 60;
          const startMinutesFromVisible = Math.max(0, startMinutesTotal - visibleStartMinutes);
          const endMinutesFromVisible = Math.max(startMinutesFromVisible + 15, endMinutesTotal - visibleStartMinutes);
          const startTop = (startMinutesFromVisible / 60) * hourHeight;
          const endTop = (endMinutesFromVisible / 60) * hourHeight;
          item.style.height = `${Math.max(endTop - startTop, MIN_EVENT_HEIGHT_PX)}px`;
        }
      } else if (resizing === 'move') {
        // ドラッグ移動のプレビュー
        const newTop = originalTop + dy;
        if (newTop >= 0) {
          item.style.top = `${newTop}px`;
        }
      }
    }

    function onTouchMove(e) {
      e.preventDefault(); // スクロールを防ぐ
      if (!e.touches || e.touches.length === 0) return;
      const touch = e.touches[0];
      const dy = touch.clientY - startY;

      // ドラッグが実際に発生したかを検知（5px以上の移動でドラッグとみなす）
      if (Math.abs(dy) >= 5) {
        hasDragged = true;
      }
      
      if (resizing === 'move') {
        // ドラッグ移動のプレビュー
        const newTop = originalTop + dy;
        if (newTop >= 0) {
          item.style.top = `${newTop}px`;
        }
      }
    }

    async function onMouseUp(e) {
      // イベントリスナーを確実に削除（{once: true}を使用しているが、念のため削除）
      window.removeEventListener('mousemove', onMouseMove);
      item.classList.remove('resizing', 'dragging');

      // 状態を保存（リセット前に）
      const currentResizing = resizing;
      const currentStartY = startY;
      const currentHasDragged = hasDragged;

      // 状態をリセット
      resizing = null;
      startY = 0;
      originalStart = null;
      originalEnd = null;
      originalTop = 0;
      hasDragged = false;

      const hourHeight = getHourHeight();
      const dy = e.clientY - currentStartY;
      const minutesDelta = Math.round(dy / hourHeight * 60 / 15) * 15; // 15分単位に丸める
      const ev = Array.isArray(events) ? events.find(ev => ev.id === id) : null;
      if (!ev) return;

      console.log(`[MOUSE UP] Event ${id}, dy: ${dy}, hasDragged: ${currentHasDragged}, minutesDelta: ${minutesDelta}`);

      // クリック（ドラッグなし）は詳細モーダルを開く
      if (currentResizing === 'move' && !currentHasDragged) {
        console.log(`[MOUSE UP] Click detected (no drag), opening modal for event ${id}`);
        showEventModal(id);
        return;
      }

      console.log(`[MOUSE UP] Drag detected, saving event ${id}`);

      // 新しい時間を計算
      let newStartTime = ev.startTime;
      let newEndTime = ev.endTime;
      
      // モバイルではリサイズを無効化
      if (isMobile && (currentResizing === 'top' || currentResizing === 'bottom')) {
        return; // リサイズ操作は無視
      }
      
      if (currentResizing === 'top') {
        const newStart = new Date(new Date(ev.startTime).getTime() + minutesDelta * 60000);
        if (newStart < new Date(ev.endTime)) {
          newStartTime = formatDateTimeLocal(newStart);
        }
      } else if (currentResizing === 'bottom') {
        const newEnd = new Date(new Date(ev.endTime).getTime() + minutesDelta * 60000);
        if (newEnd > new Date(ev.startTime)) {
          newEndTime = formatDateTimeLocal(newEnd);
        }
      } else if (currentResizing === 'move') {
        // ドラッグ移動の処理
        const newStart = new Date(new Date(ev.startTime).getTime() + minutesDelta * 60000);
        const newEnd = new Date(new Date(ev.endTime).getTime() + minutesDelta * 60000);
        
        // 0時より前には移動できない（VISIBLE_START_HOURを考慮）
        const newStartMinutes = newStart.getHours() * 60 + newStart.getMinutes();
        const minAllowedMinutes = VISIBLE_START_HOUR * 60;
        if (newStartMinutes >= minAllowedMinutes) {
          newStartTime = formatDateTimeLocal(newStart);
          newEndTime = formatDateTimeLocal(newEnd);
        }
      }
      
      // 時間が変更されていない場合は更新しない
      if (newStartTime === ev.startTime && newEndTime === ev.endTime) {
        return;
      }
      
      try {
        showLoading('予定を更新中...');
        await updateEvent(id, {
          title: ev.title,
          description: ev.description || '',
          startTime: newStartTime,
          endTime: newEndTime,
          color: ev.color
        });
        hideLoading();
      } catch (error) {
        hideLoading();
        showMessage('予定の更新に失敗しました。', 'error', 6000);
      }
    }

    async function onTouchEnd(e) {
      // イベントリスナーを確実に削除（{once: true}を使用しているが、念のため削除）
      window.removeEventListener('touchmove', onTouchMove);
      item.classList.remove('resizing', 'dragging');
      
      // 状態を保存（リセット前に）
      const currentResizing = resizing;
      const currentStartY = startY;
      const currentHasDragged = hasDragged;

      // 状態をリセット
      resizing = null;
      startY = 0;
      originalStart = null;
      originalEnd = null;
      originalTop = 0;
      hasDragged = false;

      if (!e.changedTouches || e.changedTouches.length === 0) return;
      const hourHeight = getHourHeight();
      const touch = e.changedTouches[0];
      const dy = touch.clientY - currentStartY;
      const minutesDelta = Math.round(dy / hourHeight * 60 / 15) * 15; // 15分単位に丸める
      const ev = Array.isArray(events) ? events.find(ev => ev.id === id) : null;
      if (!ev) return;

      console.log(`[TOUCH END] Event ${id}, dy: ${dy}, hasDragged: ${currentHasDragged}, minutesDelta: ${minutesDelta}`);

      // クリック（ドラッグなし）は詳細モーダルを開く
      if (currentResizing === 'move' && !currentHasDragged) {
        console.log(`[TOUCH END] Click detected (no drag), opening modal for event ${id}`);
        showEventModal(id);
        return;
      }

      console.log(`[TOUCH END] Drag detected, saving event ${id}`);

      // 新しい時間を計算
      let newStartTime = ev.startTime;
      let newEndTime = ev.endTime;

      // モバイルではリサイズを無効化
      if (isMobile && (currentResizing === 'top' || currentResizing === 'bottom')) {
        return; // リサイズ操作は無視
      }

      if (currentResizing === 'top') {
        const newStart = new Date(new Date(ev.startTime).getTime() + minutesDelta * 60000);
        if (newStart < new Date(ev.endTime)) {
          newStartTime = formatDateTimeLocal(newStart);
        }
      } else if (currentResizing === 'bottom') {
        const newEnd = new Date(new Date(ev.endTime).getTime() + minutesDelta * 60000);
        if (newEnd > new Date(ev.startTime)) {
          newEndTime = formatDateTimeLocal(newEnd);
        }
      } else if (currentResizing === 'move') {
        // ドラッグ移動の処理
        const newStart = new Date(new Date(ev.startTime).getTime() + minutesDelta * 60000);
        const newEnd = new Date(new Date(ev.endTime).getTime() + minutesDelta * 60000);

        // 0時より前には移動できない（VISIBLE_START_HOURを考慮）
        const newStartMinutes = newStart.getHours() * 60 + newStart.getMinutes();
        const minAllowedMinutes = VISIBLE_START_HOUR * 60;
        if (newStartMinutes >= minAllowedMinutes) {
          newStartTime = formatDateTimeLocal(newStart);
          newEndTime = formatDateTimeLocal(newEnd);
        }
      }
      
      // 時間が変更されていない場合は更新しない
      if (newStartTime === ev.startTime && newEndTime === ev.endTime) {
        return;
      }
      
      try {
        showLoading('予定を更新中...');
        await updateEvent(id, {
          title: ev.title,
          description: ev.description || '',
          startTime: newStartTime,
          endTime: newEndTime,
          color: ev.color
        });
        hideLoading();
      } catch (error) {
        hideLoading();
        showMessage('予定の更新に失敗しました。', 'error', 6000);
      }
    }

    // 既存のイベントリスナーを削除（重複登録を防ぐ）
    const existingMouseDown = item._existingMouseDown;
    const existingTouchStart = item._existingTouchStart;
    const existingTopHandleMouseDown = topHandle?._existingMouseDown;
    const existingBottomHandleMouseDown = bottomHandle?._existingMouseDown;
    
    if (existingMouseDown) {
      item.removeEventListener('mousedown', existingMouseDown);
    }
    if (existingTouchStart) {
      item.removeEventListener('touchstart', existingTouchStart);
    }
    if (existingTopHandleMouseDown && topHandle) {
      topHandle.removeEventListener('mousedown', existingTopHandleMouseDown);
    }
    if (existingBottomHandleMouseDown && bottomHandle) {
      bottomHandle.removeEventListener('mousedown', existingBottomHandleMouseDown);
    }
    
    // 新しいイベントリスナーを保存
    item._existingMouseDown = onEventMouseDown;
    item._existingTouchStart = onEventTouchStart;

    // モバイルではリサイズハンドルのイベントリスナーを追加しない
    if (!isMobile) {
      const topHandler = onMouseDown(topHandle, 'top');
      const bottomHandler = onMouseDown(bottomHandle, 'bottom');
      if (topHandle) {
        topHandle._existingMouseDown = topHandler;
        topHandle.addEventListener('mousedown', topHandler);
      }
      if (bottomHandle) {
        bottomHandle._existingMouseDown = bottomHandler;
        bottomHandle.addEventListener('mousedown', bottomHandler);
      }
    }
    
    // イベント本体のドラッグ移動イベントリスナーを追加
    item.addEventListener('mousedown', onEventMouseDown);
    item.addEventListener('touchstart', onEventTouchStart);
  });
}

