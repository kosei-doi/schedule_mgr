let unsubscribeEvents = null;

// グローバル変数
let events = [];
let currentDate = new Date();
let currentView = 'day'; // 'day', 'week', or 'month'
let editingEventId = null;
let isFirebaseEnabled = false;
const clientId = (() => Date.now().toString(36) + Math.random().toString(36).slice(2))();
let messageTimeoutId = null;
let googleSyncIntervalId = null;
let googleSyncTimeoutId = null;
let googleSyncInFlight = false;
const GOOGLE_SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const INITIAL_GOOGLE_SYNC_DELAY_MS = 30 * 1000; // 30 seconds
const VISIBLE_START_HOUR = 4;
const VISIBLE_END_HOUR = 23;
const HOUR_HEIGHT_PX = 25;
const MIN_EVENT_HEIGHT_PX = 15;
const VISIBLE_HOURS = VISIBLE_END_HOUR - VISIBLE_START_HOUR + 1;

// Google Apps Script Web アプリ（POSTエンドポイント）
// デプロイ済み Google Apps Script Web アプリの URL
const GOOGLE_APPS_SCRIPT_ENDPOINT =
  window?.GAS_ENDPOINT_OVERRIDE ||
  'https://script.google.com/macros/s/AKfycbyBvGKQYGvGG7qKlwqXcWbF90kkiXOHAGieu4RJCH2-DNb1hr0bIpvhpkCjot9Ub59bxA/exec';

function showMessage(message, type = 'info', duration = 4000) {
  const area = safeGetElementById('notificationArea');
  if (!area) {
    if (type === 'error') {
      console.error(message);
    } else {
      console.info(message);
    }
    return;
  }
  area.textContent = message;
  area.className = `notification show${type !== 'info' ? ' ' + type : ''}`;
  if (messageTimeoutId) {
    clearTimeout(messageTimeoutId);
  }
  if (duration > 0) {
    messageTimeoutId = setTimeout(() => {
      area.className = 'notification';
      area.textContent = '';
    }, duration);
  }
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
    
    let escHandler = null;
    
    const cleanup = () => {
      modal.classList.remove('show');
      modal.setAttribute('aria-hidden', 'true');
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
    console.warn(`Element with id "${id}" not found`);
  }
  return element;
}

// Firebase接続チェック
function checkFirebase() {
  try {
    if (typeof window.firebase !== 'undefined' && window.firebase.db) {
      isFirebaseEnabled = true;
      console.log('Firebase v11 Realtime Database が有効です');
      return true;
    }
  } catch (error) {
    console.error('Firebase が利用できません。', error);
  }
  isFirebaseEnabled = false;
  return false;
}

// イベントを読み込む関数（combiと同じロジック）
function loadEvents() {
  if (!isFirebaseEnabled || !window.firebase?.db) {
    const message = 'Firebaseが無効のため、予定を読み込めません。設定を確認してください。';
    console.error(message);
    showMessage(message, 'error', 6000);
    return;
  }
  
  const allowedRanges = getAllowedDateRanges();
  logAllowedRanges('Firebase');
  
  if (typeof unsubscribeEvents === 'function') {
    unsubscribeEvents();
    unsubscribeEvents = null;
  }
  
  const eventsRef = window.firebase.ref(window.firebase.db, "events");
  unsubscribeEvents = window.firebase.onValue(eventsRef, (snapshot) => {
    const data = snapshot.val();
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const newEvents = Object.keys(data).map(key => {
        const payload = data[key] || {};
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
      });
      const filteredEvents = newEvents.filter(ev => isEventInAllowedRange(ev, allowedRanges));

      // 重複チェック：IDが同じで内容が同じ場合は更新をスキップ
      const hasChanges = !Array.isArray(events) || filteredEvents.length !== events.length || 
        filteredEvents.some(newEvent => {
          const oldEvent = Array.isArray(events) ? events.find(e => e.id === newEvent.id) : null;
          return !oldEvent || (oldEvent.updatedAt !== newEvent.updatedAt);
        });
      
      if (hasChanges) {
        events = filteredEvents;
        // 開始時刻でソート（無効な日付は最後に）
        events.sort((a, b) => {
          const aTime = a.startTime ? new Date(a.startTime).getTime() : Infinity;
          const bTime = b.startTime ? new Date(b.startTime).getTime() : Infinity;
          if (Number.isNaN(aTime)) return 1;
          if (Number.isNaN(bTime)) return -1;
          return aTime - bTime;
        });
        console.log('Firebaseからイベントを読み込み:', events.length, '件');
        updateViews();
        scheduleAllNotifications();
      }
    } else {
      if (Array.isArray(events) && events.length > 0) {
        events = [];
        console.log('イベントデータがありません');
        updateViews();
      }
    }
  }, (error) => {
    console.error('Firebaseからの読み込みに失敗しました。', error);
    showMessage('予定の読み込みに失敗しました。ネットワークを確認してください。', 'error', 6000);
  });
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
    console.log(`Google Sync Result: ${message} | created=${created} updated=${updated} skipped=${skipped}`);
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
  const { created, updated } = mergeGoogleEvents(googleEvents, rangeSet);
  if (!silent) {
    hideLoading();
    showMessage(
      `Googleカレンダーから取得: ${googleEvents.length}件 (新規:${created} / 更新:${updated})`,
      'success',
      6000
    );
  } else {
    // Always hide loading, even in silent mode
    hideLoading();
    if (googleEvents.length > 0) {
      console.log(
        `Google fetch: total=${googleEvents.length} created=${created} updated=${updated}`
      );
    }
  }
  return { created, updated, total: googleEvents.length };
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
    console.log(`Google clear: deleted=${result.deleted || 0}`);
  }
  return { deleted: Number(result.deleted) || 0 };
}

function mergeGoogleEvents(googleEvents = [], ranges) {
  let created = 0;
  let updated = 0;

  // Ensure events is an array
  if (!Array.isArray(events)) {
    console.warn('mergeGoogleEvents: events is not an array');
    return { created: 0, updated: 0 };
  }

  const eventsById = new Map(events.map(ev => [ev.id, ev]));
  const eventsByGoogleId = new Map(
    events
      .filter(ev => ev.googleEventId)
      .map(ev => [ev.googleEventId, ev])
  );

  const rangeSet = ranges || getAllowedDateRanges();

  googleEvents.forEach(googleEvent => {
    const normalized = normalizeGoogleEvent(googleEvent, rangeSet);
    if (normalized.filteredOut) return;
    if (!normalized.startTime || !normalized.endTime) return;

    if (googleEvent.scheduleMgrId && eventsById.has(googleEvent.scheduleMgrId)) {
      const existing = eventsById.get(googleEvent.scheduleMgrId);
      if (existing.isTimetable === true) {
        return;
      }
      if (!isEventInAllowedRange(existing, rangeSet)) {
        return;
      }
      if (needsExternalUpdate(existing, normalized)) {
        updateEvent(googleEvent.scheduleMgrId, normalized);
        updated += 1;
      }
      return;
    }

    if (normalized.googleEventId && eventsByGoogleId.has(normalized.googleEventId)) {
      const existing = eventsByGoogleId.get(normalized.googleEventId);
       if (existing.isTimetable === true) {
        return;
      }
      if (!isEventInAllowedRange(existing, rangeSet)) {
        return;
      }
      if (needsExternalUpdate(existing, normalized)) {
        updateEvent(existing.id, {
          ...normalized,
          source: existing.source || 'google',
          isGoogleImported: true,
        });
        updated += 1;
      }
      return;
    }

    const newEventId = addEvent({
      ...normalized,
      isTimetable: false,
      source: 'google',
      isGoogleImported: true,
    });
    if (newEventId) {
      created += 1;
    }
  });

  return { created, updated };
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
function addEvent(event) {
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
    console.error(message);
    showMessage(message, 'error', 6000);
    return null;
  }

  try {
  const eventsRef = window.firebase.ref(window.firebase.db, "events");
  const newEventRef = window.firebase.push(eventsRef);
  // DBにはidフィールドを書き込まない（キーと競合させない）
  const { id: _omitId, ...payload } = newEvent;
  window.firebase.set(newEventRef, payload);
  console.log('Firebaseにイベントを追加:', newEventRef.key);
  return newEventRef.key;
  } catch (error) {
    console.error('Firebaseにイベントを追加できませんでした。', error);
    showMessage('イベントを保存できませんでした。ネットワークやFirebase設定を確認してください。', 'error', 6000);
    return null;
  }
}

// イベントを更新（combiと同じロジック）
function updateEvent(id, event) {
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
    console.error(message);
    showMessage(message, 'error', 6000);
    return;
  }

  try {
  // Firebaseの場合、ローカルのevents配列は更新しない
  // Firebaseのリアルタイムリスナーが自動的に更新する
  const eventRef = window.firebase.ref(window.firebase.db, `events/${id}`);
  window.firebase.update(eventRef, updatedEvent);
  console.log('Firebaseでイベントを更新:', id);
  } catch (error) {
    console.error('Firebaseでイベントの更新に失敗しました。', error);
    showMessage('イベントの更新に失敗しました。ネットワーク状況を確認してください。', 'error', 6000);
  }
}

// イベントを削除（combiと同じロジック）
function deleteEvent(id) {
  if (!isFirebaseEnabled || !window.firebase?.db) {
    const message = 'Firebaseが無効のため、イベントを削除できません。設定を確認してください。';
    console.error(message);
    showMessage(message, 'error', 6000);
    return;
  }

  try {
  const eventRef = window.firebase.ref(window.firebase.db, `events/${id}`);
  window.firebase.remove(eventRef);
  console.log('Firebaseからイベントを削除:', id);
  } catch (error) {
    console.error('Firebaseからイベントを削除できませんでした。', error);
    showMessage('イベントの削除に失敗しました。再度お試しください。', 'error', 6000);
  }
}

async function clearAllEvents({ skipConfirm = false, silent = false } = {}) {
  if (!skipConfirm) {
    const confirmed = await showConfirmModal('全ての予定と時間割データを削除します。よろしいですか？', '削除の確認');
    if (!confirmed) return false;
  }

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

    if (!silent) {
      hideLoading();
      showMessage('全ての予定を削除しました。', 'success');
    }
    return true;
  } catch (error) {
    console.error('Firebaseイベント削除エラー:', error);
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
    console.warn('Google Apps Script エンドポイントが設定されていないため、自動同期をスキップします。');
    return;
  }
  if (googleSyncIntervalId) {
    // 既に実行中の場合は停止して再開
    stopAutomaticGoogleSync();
  }

  const syncTask = async () => {
    if (!isFirebaseEnabled) return;
    if (googleSyncInFlight) return;
    googleSyncInFlight = true;
    try {
      await fetchGoogleCalendarEvents({ silent: true });
      await syncEventsToGoogleCalendar({ silent: true });
    } catch (error) {
      console.error('自動Googleカレンダー同期に失敗しました。', error);
    } finally {
      googleSyncInFlight = false;
    }
  };

  googleSyncTimeoutId = setTimeout(async () => {
    googleSyncTimeoutId = null;
    await syncTask();
  }, INITIAL_GOOGLE_SYNC_DELAY_MS);
  googleSyncIntervalId = setInterval(syncTask, GOOGLE_SYNC_INTERVAL_MS);
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

// 特定日のイベントを取得
function getEventsByDate(date) {
  const dateStr = formatDate(date, 'YYYY-MM-DD');
  const list = [];
  if (!Array.isArray(events)) return list;
  events.forEach(ev => {
    if (!ev.recurrence || ev.recurrence === 'none') {
      if (!ev.startTime) return;
      const eventDate = ev.startTime.split('T')[0];
      if (eventDate === dateStr) list.push(ev);
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
        list.push(inst);
      }
    }
  });
  return list;
}

// 特定週のイベントを取得
function getEventsByWeek(startDate) {
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 6);
  endDate.setHours(23, 59, 59, 999);
  
  if (!Array.isArray(events)) return [];
  
  return events.filter(event => {
    if (!event || !event.startTime) return false;
    const eventDate = new Date(event.startTime);
    if (Number.isNaN(eventDate.getTime())) return false;
    return eventDate >= startDate && eventDate <= endDate;
  });
}

// 日次ビューの描画
function renderDayView() {
  const container = safeGetElementById('dayEventContainer');
  const allDayContainer = safeGetElementById('dayAllDayContainer');
  if (!container) {
    console.warn('Day event container not found');
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
    sortedAllDay.forEach(event => {
      const chip = createEventElement(event, { variant: 'all-day' });
      allDayContainer.appendChild(chip);
    });
  }
  
  const sortedTimed = [...timedEvents].sort((a, b) => {
    const aTime = new Date(a.startTime || 0).getTime();
    const bTime = new Date(b.startTime || 0).getTime();
    const safeATime = Number.isNaN(aTime) ? 0 : aTime;
    const safeBTime = Number.isNaN(bTime) ? 0 : bTime;
    return safeATime - safeBTime;
  });
  const groups = calculateEventGroups(sortedTimed);

  sortedTimed.forEach((event, index) => {
    const eventElement = createEventElement(event);
    positionEventInDayView(eventElement, event);
    const groupInfo = groups[index];
    if (groupInfo && groupInfo.totalInGroup > 1) {
      const widthPercent = 100 / groupInfo.totalInGroup;
      const leftPercent = widthPercent * groupInfo.indexInGroup;
      eventElement.style.left = `${leftPercent}%`;
      eventElement.style.right = `${100 - (leftPercent + widthPercent)}%`;
    }
    container.appendChild(eventElement);
  });

  // 生成後にリサイズハンドラを付与
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
    if (!eventsContainer) continue;
    eventsContainer.innerHTML = '';
    if (allDayColumn) {
      allDayColumn.innerHTML = '';
    }
    const dayEvents = getEventsByDate(dayDate);
    const { allDayEvents, timedEvents } = splitEventsByAllDay(dayEvents);
    
    // 重なり検出とグループ化
    if (allDayColumn) {
      const sortedAllDay = [...allDayEvents].sort((a, b) => {
        const aTime = new Date(a.startTime || 0).getTime();
        const bTime = new Date(b.startTime || 0).getTime();
        const safeATime = Number.isNaN(aTime) ? 0 : aTime;
        const safeBTime = Number.isNaN(bTime) ? 0 : bTime;
        return safeATime - safeBTime;
      });
      sortedAllDay.forEach((event) => {
        const chip = createEventElement(event, { variant: 'all-day' });
        allDayColumn.appendChild(chip);
      });
    }

    const sortedTimed = [...timedEvents].sort((a, b) => {
      const aTime = new Date(a.startTime || 0).getTime();
      const bTime = new Date(b.startTime || 0).getTime();
      const safeATime = Number.isNaN(aTime) ? 0 : aTime;
      const safeBTime = Number.isNaN(bTime) ? 0 : bTime;
      return safeATime - safeBTime;
    });
    const groups = calculateEventGroups(sortedTimed);
    
    sortedTimed.forEach((event, index) => {
      const eventElement = createEventElement(event);
      // 週次でも日次と同じ計算で時間軸に配置
      positionEventInDayView(eventElement, event);
      
      // 重なり情報を適用（横並び等分）
      const groupInfo = groups[index];
      if (groupInfo && groupInfo.totalInGroup > 1) {
        const widthPercent = 100 / groupInfo.totalInGroup;
        const leftPercent = widthPercent * groupInfo.indexInGroup;
        eventElement.style.left = `${leftPercent}%`;
        eventElement.style.right = `${100 - (leftPercent + widthPercent)}%`;
      }
      
      eventsContainer.appendChild(eventElement);
    });
  }
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

// イベント要素を作成（日次ビュー用）
function createEventElement(event, options = {}) {
  const { variant } = options;
  const isAllDay = variant === 'all-day' || isAllDayEvent(event);
  const div = document.createElement('div');
  div.className = 'event-item';
  if (isAllDay) {
    div.classList.add('all-day');
  }
  if (event.isTimetable === true) {
    div.classList.add('timetable-event');
  }
  div.style.backgroundColor = event.color || '#3b82f6';
  div.dataset.eventId = event.id;
  if (event.isTimetable === true) {
    div.dataset.isTimetable = 'true';
  }
  if (isAllDay) {
    div.dataset.allDay = 'true';
  }
  div.tabIndex = 0;
  div.setAttribute('role', 'button');
  const title = escapeHtml(event.title || '(無題)');

  if (isAllDay) {
    div.setAttribute('aria-label', `${title} (終日)`);
    div.innerHTML = `
      <div class="event-title">${title}</div>
    `;
  } else {
    const startLabel = event.startTime ? formatTime(event.startTime) : '--:--';
    const endLabel = event.endTime ? formatTime(event.endTime) : '--:--';
    div.setAttribute('aria-label', `${title}, ${startLabel}から${endLabel}`);
    div.innerHTML = `
      <div class="resize-handle top"></div>
      <div class="event-title">${title}</div>
      <div class="event-time">${startLabel} - ${endLabel}</div>
      <div class="resize-handle bottom"></div>
    `;
  }
  
  div.addEventListener('click', (e) => {
    e.stopPropagation();
    showEventModal(event.id);
  });
  div.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      showEventModal(event.id);
    }
  });
  
  return div;
}

// 日次ビューでのイベント配置
function positionEventInDayView(element, event) {
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
  
  const startMinutesTotal = startTime.getHours() * 60 + startTime.getMinutes();
  const endMinutesTotal = endTime.getHours() * 60 + endTime.getMinutes();
  const visibleStartMinutes = VISIBLE_START_HOUR * 60;
  const visibleEndMinutes = (VISIBLE_END_HOUR + 1) * 60;

  const startMinutesFromVisible = Math.max(0, startMinutesTotal - visibleStartMinutes);
  const endMinutesFromVisible = Math.max(startMinutesFromVisible + 15, Math.min(visibleEndMinutes - visibleStartMinutes, endMinutesTotal - visibleStartMinutes));

  const top = (startMinutesFromVisible / 60) * HOUR_HEIGHT_PX;
  const height = Math.max(MIN_EVENT_HEIGHT_PX, (endMinutesFromVisible - startMinutesFromVisible) / 60 * HOUR_HEIGHT_PX);

  element.style.top = `${top}px`;
  element.style.height = `${height}px`;
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
    console.error('Event modal required elements not found');
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
    const descInput = safeGetElementById('eventDescription');
    if (titleInput) titleInput.value = event.title || '';
    if (descInput) descInput.value = event.description || '';
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
    
    // 一時的イベントの場合は既存の値を保持
    if (eventId && typeof eventId === 'string' && eventId.startsWith('temp-')) {
      if (!Array.isArray(events)) return;
      const event = events.find(e => e.id === eventId);
      if (event) {
        const titleInput = safeGetElementById('eventTitle');
        const descInput = safeGetElementById('eventDescription');
        if (titleInput) titleInput.value = '';
        if (descInput) descInput.value = event.description || '';
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
  }
  const titleInput = safeGetElementById('eventTitle');
  if (titleInput) titleInput.focus();
}

// モーダルを閉じる
function closeEventModal() {
  const modal = safeGetElementById('eventModal');
  if (modal) {
    modal.classList.remove('show');
    modal.setAttribute('aria-hidden', 'true');
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
    console.warn('Month grid not found');
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
    console.warn('Invalid date passed to createMonthDayElement');
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
    
    // 最大3件まで表示（色ドット + 時刻 + タイトル）
    visibleEvents.slice(0, 3).forEach(event => {
      const eventElement = document.createElement('div');
      eventElement.className = 'month-event-item';

      const dot = document.createElement('span');
      dot.className = 'month-event-dot';
      dot.style.backgroundColor = event.color || '#3b82f6';

      const time = document.createElement('span');
      time.className = 'month-event-time';
      time.textContent = isAllDayEvent(event) ? '' : formatTime(event.startTime);
      if (!time.textContent) time.classList.add('hidden');

      const title = document.createElement('span');
      title.className = 'month-event-title';
      title.textContent = event.title || '';

      eventElement.appendChild(dot);
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
    const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
    if (match) return match[1];
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
  console.log(
    `${label} target range:`,
    `${formatDateOnly(rangeStart)}〜${formatDateOnly(rangeEnd)}`
  );
}

function isEventInAllowedRange(event, ranges) {
  if (!event || !event.startTime) return false;
  const eventDate = new Date(event.startTime);
  if (Number.isNaN(eventDate.getTime())) return false;
  const { rangeStart, rangeEnd } = ranges || getAllowedDateRanges();
  return eventDate >= rangeStart && eventDate <= rangeEnd;
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
    console.error('通知のスケジュールに失敗しました:', error);
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
    console.error('エクスポートエラー:', error);
    showMessage('エクスポートに失敗しました。', 'error', 6000);
  }
}

function importEventsFromJSONData(obj) {
      if (!obj || !Array.isArray(obj.events)) throw new Error('フォーマット不正');
  let importedCount = 0;
      obj.events.forEach(ev => {
        const dup = Array.isArray(events) ? events.find(e => e.startTime === ev.startTime && (e.title || '') === (ev.title || '')) : null;
        if (dup) return;
        const toAdd = {
          title: ev.title || '',
          description: ev.description || '',
          startTime: ev.startTime,
          endTime: ev.endTime,
      allDay: ev.allDay === true,
          color: ev.color || '#3b82f6',
          recurrence: ev.recurrence || 'none',
          recurrenceEnd: ev.recurrenceEnd || '',
      reminderMinutes: (ev.reminderMinutes ?? null),
      isTimetable: ev.isTimetable === true
        };
        addEvent(toAdd);
    importedCount++;
  });
  return importedCount;
}

function handleJSONImport(jsonData) {
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
    const count = importTimetableFromData(jsonData);
    showMessage(`時間割をインポートしました: ${count}件の予定を追加`, 'success');
    return;
  }
  if (Array.isArray(jsonData.events)) {
    const count = importEventsFromJSONData(jsonData);
    showMessage(`イベントをインポートしました: ${count}件`, 'success');
    return;
  }
  throw new Error('対応していないJSON形式です');
}

// 時間割データを取り込む
function importTimetableFromData(data) {
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

    uniqueDates.forEach((dateStr) => {
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

      addEvent(newEvent);
      importedCount++;
    });

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
    weekdays.forEach((weekdaySymbol) => {
      const classDates = Array.isArray(classDaysByWeekday[weekdaySymbol])
        ? classDaysByWeekday[weekdaySymbol]
        : [];
      const periodsForDay = Array.isArray(scheduleByWeekday[weekdaySymbol])
        ? scheduleByWeekday[weekdaySymbol].map(Number).filter((n) => Number.isFinite(n) && periodMap.has(n))
        : [];
      if (periodsForDay.length === 0) return;

      const minPeriod = Math.min(...periodsForDay);
      const maxPeriod = Math.max(...periodsForDay);
      const startPeriodTime = periodMap.get(minPeriod);
      const endPeriodTime = periodMap.get(maxPeriod);
      if (!startPeriodTime || !startPeriodTime.start || !endPeriodTime || !endPeriodTime.end) return;

      classDates.forEach((classDate) => {
        if (typeof classDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(classDate)) return;
        const startTime = `${classDate}T${startPeriodTime.start}`;
        const endTime = `${classDate}T${endPeriodTime.end}`;

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
          color: baseColor,
          allDay: false,
          recurrence: 'none',
          recurrenceEnd: '',
          reminderMinutes: null,
          isTimetable: true,
        };

        addEvent(newEvent);
        importedCount++;
      });
    });
    return importedCount;
  }

  weekdays.forEach((weekdaySymbol, weekdayIndex) => {
    const classDates = Array.isArray(classDaysByWeekday[weekdaySymbol])
      ? classDaysByWeekday[weekdaySymbol]
      : [];

    classDates.forEach((classDate) => {
      if (!classDate || typeof classDate !== 'string') return;

      timetableGrid.forEach((subjectsForPeriod, periodIndex) => {
        const subjectEntry = subjectsForPeriod?.[weekdayIndex];
        const subjectName = typeof subjectEntry === 'object' ? subjectEntry.title : subjectEntry;
        if (!subjectName || subjectName.trim() === '') return;

        const periodTime = periodTimes[periodIndex];
        if (!periodTime || !periodTime.start || !periodTime.end) return;

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
        if (duplicate) return;

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

        addEvent(newEvent);
        importedCount++;
      });
    });
  });

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
  console.log('アプリケーションを初期化中...');
  
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
  
  console.log('アプリケーション初期化完了');
  startAutomaticGoogleSync();
});

window.addEventListener('beforeunload', () => {
  if (typeof unsubscribeEvents === 'function') {
    unsubscribeEvents();
    unsubscribeEvents = null;
  }
  clearScheduledNotifications();
  stopAutomaticGoogleSync();
});

// イベントリスナーの設定
function setupEventListeners() {
  // 日付ナビゲーション（日次・週次・月次用）
  const prevDayBtn = safeGetElementById('prevDay');
  if (prevDayBtn) {
    prevDayBtn.addEventListener('click', () => {
      if (currentView === 'day') {
        currentDate = addDays(currentDate, -1);
      } else if (currentView === 'week') {
        currentDate = addDays(currentDate, -7);
      } else if (currentView === 'month') {
        currentDate = addMonths(currentDate, -1);
      }
      updateViews();
    });
  }
  
  const nextDayBtn = safeGetElementById('nextDay');
  if (nextDayBtn) {
    nextDayBtn.addEventListener('click', () => {
      if (currentView === 'day') {
        currentDate = addDays(currentDate, 1);
      } else if (currentView === 'week') {
        currentDate = addDays(currentDate, 7);
      } else if (currentView === 'month') {
        currentDate = addMonths(currentDate, 1);
      }
      updateViews();
    });
  }
  
  // 月次ナビゲーション（ヘッダーの矢印を使用）
  // prevDay/nextDay が月次ビュー時は前月/翌月に動作するように既に実装済み
  
  const todayBtn = safeGetElementById('todayBtn');
  if (todayBtn) {
    todayBtn.addEventListener('click', () => {
      currentDate = new Date();
      updateViews();
    });
  }
  
  // ビュー切り替え
  const dayViewBtn = safeGetElementById('dayViewBtn');
  if (dayViewBtn) {
    dayViewBtn.addEventListener('click', () => {
      currentView = 'day';
      switchView('day');
      updateViews();
    });
  }
  
  const weekViewBtn = safeGetElementById('weekViewBtn');
  if (weekViewBtn) {
    weekViewBtn.addEventListener('click', () => {
      currentView = 'week';
      switchView('week');
      updateViews();
    });
  }
  
  const monthViewBtn = safeGetElementById('monthViewBtn');
  if (monthViewBtn) {
    monthViewBtn.addEventListener('click', () => {
      currentView = 'month';
      switchView('month');
      updateViews();
    });
  }
  
  // 予定追加ボタン
  const addEventBtn = safeGetElementById('addEventBtn');
  if (addEventBtn) {
    addEventBtn.addEventListener('click', () => {
      showEventModal();
    });
  }
  // インポート/エクスポート
  const importBtn = safeGetElementById('importBtn');
  const exportBtn = safeGetElementById('exportBtn');
  const importFile = safeGetElementById('importFile');
  if (importBtn && exportBtn && importFile) {
    importBtn.addEventListener('click', () => importFile.click());
    importFile.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      if (file.name.endsWith('.json')) {
        const reader = new FileReader();
        reader.onload = () => {
          try {
            if (!reader.result || typeof reader.result !== 'string') {
              throw new Error('ファイルの内容が読み取れませんでした');
            }
            const jsonData = JSON.parse(reader.result);
            handleJSONImport(jsonData);
          } catch (error) {
            console.error('インポートエラー:', error);
            showMessage('インポートに失敗しました。詳細はコンソールを確認してください。', 'error', 6000);
          }
        };
        reader.onerror = () => {
          const errorMsg = reader.error ? reader.error.message || String(reader.error) : '不明なエラー';
          console.error('ファイル読み込みに失敗しました:', errorMsg);
          showMessage('ファイルの読み込みに失敗しました。', 'error', 6000);
        };
        reader.readAsText(file);
      } else {
        const message = '現時点ではJSONファイルのみ対応しています。';
        console.warn(message);
        showMessage(message, 'error', 4000);
      }
      importFile.value = '';
    });
    exportBtn.addEventListener('click', () => exportEventsAsJSON('all'));
  }
  
  const startInput = safeGetElementById('eventStartTime');
  const endInput = safeGetElementById('eventEndTime');
  const allDayCheckbox = safeGetElementById('eventAllDay');
  const allDayRow = safeGetElementById('allDayDateRow');
  const allDayStartInput = safeGetElementById('eventAllDayStart');
  const allDayEndInput = safeGetElementById('eventAllDayEnd');

  if (allDayCheckbox) {
    allDayCheckbox.addEventListener('change', () => {
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
    });
  }
  
  const dayAllDayContainer = safeGetElementById('dayAllDayContainer');
  if (dayAllDayContainer) {
    dayAllDayContainer.addEventListener('click', () => {
      openAllDayCreateModal(new Date(currentDate));
    });
  }

  document.querySelectorAll('.week-all-day-columns .all-day-column').forEach((column) => {
    column.addEventListener('click', () => {
      const dayIndex = Number(column.dataset.day || 0);
      const weekStart = getWeekStart(currentDate);
      const targetDate = new Date(weekStart);
      targetDate.setDate(weekStart.getDate() + dayIndex);
      openAllDayCreateModal(targetDate);
    });
  });

  const weekHeaderCells = document.querySelectorAll('#weekView .week-header .day-header-cell');
  const handleWeekHeaderSelect = (dayIndex) => {
    const weekStart = getWeekStart(currentDate);
    const targetDate = new Date(weekStart);
    targetDate.setDate(weekStart.getDate() + dayIndex);
    currentDate = targetDate;
    currentView = 'day';
    switchView('day');
    updateViews();
  };
  weekHeaderCells.forEach((cell) => {
    const dayIndex = Number(cell.dataset.day || 0);
    cell.addEventListener('click', () => handleWeekHeaderSelect(dayIndex));
    cell.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleWeekHeaderSelect(dayIndex);
      }
    });
  });

  if (allDayStartInput) {
    allDayStartInput.addEventListener('change', () => {
      if (!allDayEndInput || !allDayStartInput.value) return;
      if (!allDayEndInput.value || new Date(allDayEndInput.value) < new Date(allDayStartInput.value)) {
        allDayEndInput.value = allDayStartInput.value;
      }
    });
  }
  
  // モーダル関連
  const closeModalBtn = safeGetElementById('closeModal');
  if (closeModalBtn) {
    closeModalBtn.addEventListener('click', closeEventModal);
  }
  
  const cancelBtn = safeGetElementById('cancelBtn');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', closeEventModal);
  }
  
  // モーダル外クリックで閉じる
  const eventModal = safeGetElementById('eventModal');
  if (eventModal) {
    eventModal.addEventListener('click', (e) => {
      if (e.target.id === 'eventModal') {
        closeEventModal();
      }
    });
  }
  
  // ESCキーでモーダルを閉じる
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const modal = safeGetElementById('eventModal');
      if (modal && modal.classList.contains('show')) {
        closeEventModal();
      }
    }
  });
  
  // フォーム送信
  const eventForm = safeGetElementById('eventForm');
  if (!eventForm) {
    console.error('Event form not found');
    return;
  }
  
  eventForm.addEventListener('submit', async (e) => {
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
      const description = sanitizeTextInput(formData.get('description') || '');
      
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
        const newId = addEvent(newEvent);
        if (newId && !isFirebaseEnabled) {
          // Firebaseが無効な場合のみローカル配列に追加
          newEvent.id = newId;
          events.push(newEvent);
        }
      } else if (editingEventId) {
        // 既存イベントを更新
        // Firebase更新を先に実行し、成功後にローカル配列を更新
        updateEvent(editingEventId, event);
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
        const newId = addEvent(event);
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
      console.error('イベント保存エラー:', error);
      showMessage('イベントの保存に失敗しました。再度お試しください。', 'error', 6000);
    } finally {
      // Reset submission flag
      delete eventForm.dataset.submitting;
    }
  });
  
  // 削除ボタン
  const deleteBtn = safeGetElementById('deleteBtn');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', async () => {
      if (!editingEventId) return;
      
      const confirmed = await showConfirmModal('この予定を削除してもよろしいですか？', '削除の確認');
      if (confirmed) {
        try {
          showLoading('削除中...');
          deleteEvent(editingEventId);
          hideLoading();
          closeEventModal();
          showMessage('予定を削除しました', 'success', 3000);
        } catch (error) {
          hideLoading();
          console.error('イベント削除エラー:', error);
          showMessage('イベントの削除に失敗しました。', 'error', 6000);
        }
      }
    });
  }
  
  // 繰り返し選択時の処理
  const recurrenceSelect = safeGetElementById('eventRecurrence');
  const recurrenceEndGroup = safeGetElementById('recurrenceEndGroup');
  if (recurrenceSelect && recurrenceEndGroup) {
    recurrenceSelect.addEventListener('change', () => {
      const value = recurrenceSelect.value;
      if (value && value !== 'none') {
        recurrenceEndGroup.classList.remove('hidden');
      } else {
        recurrenceEndGroup.classList.add('hidden');
      }
    });
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
    const minutesFromTopStart = Math.max(0, Math.round(startY / HOUR_HEIGHT_PX * 60 / 15) * 15);
    const minutesFromTopEnd = Math.max(0, Math.round(endY / HOUR_HEIGHT_PX * 60 / 15) * 15);
    
    const baseDate = new Date(currentDate);
    baseDate.setHours(0, 0, 0, 0);
    const startTotalMinutes = VISIBLE_START_HOUR * 60 + minutesFromTopStart;
    const endTotalMinutes = VISIBLE_START_HOUR * 60 + minutesFromTopEnd;
    const start = new Date(baseDate.getTime() + startTotalMinutes * 60 * 1000);
    
    // クリック（移動なし）の場合は2時間の予定を作成
    let end;
    if (!hasMoved || (endY - startY) < 6.25) { // 6.25px = 15分
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
    const titleInput = safeGetElementById('eventTitle');
    if (startTimeInput) startTimeInput.value = formatDateTimeLocal(start);
    if (endTimeInput) endTimeInput.value = formatDateTimeLocal(end);
    if (titleInput) titleInput.focus();
  }
}

function openAllDayCreateModal(date) {
  const isoDate = formatDateOnly(date);
  const allDayCheckbox = safeGetElementById('eventAllDay');
  const allDayRow = safeGetElementById('allDayDateRow');
  const allDayStartInput = safeGetElementById('eventAllDayStart');
  const allDayEndInput = safeGetElementById('eventAllDayEnd');
  showEventModal();
  if (allDayCheckbox) {
    allDayCheckbox.checked = true;
  }
  applyAllDayMode(true, {
    startInput: safeGetElementById('eventStartTime'),
    endInput: safeGetElementById('eventEndTime'),
    allDayRow,
  });
  if (allDayStartInput) allDayStartInput.value = isoDate;
  if (allDayEndInput) allDayEndInput.value = isoDate;
  const titleInput = safeGetElementById('eventTitle');
  if (titleInput) titleInput.focus();
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
      
      // 15分単位に丸める（1時間 = HOUR_HEIGHT_PX）
      const minutesFromTop = Math.max(0, Math.round(offsetY / HOUR_HEIGHT_PX * 60 / 15) * 15);
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
      const titleInput = safeGetElementById('eventTitle');
      if (startTimeInput) startTimeInput.value = formatDateTimeLocal(start);
      if (endTimeInput) endTimeInput.value = formatDateTimeLocal(end);
      if (titleInput) titleInput.focus();
    });
  });
}

// リサイズ（上下）処理とドラッグ移動処理
function attachResizeHandlers() {
  const items = document.querySelectorAll('.event-item');
  
  items.forEach((item) => {
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
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp, { once: true });
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
      
      console.log('イベント移動開始:', ev.title, 'isMobile:', isMobile);
      
      startY = e.clientY;
      originalStart = startDate;
      originalEnd = endDate;
      originalTop = parseFloat(item.style.top) || 0;
      resizing = 'move';
      item.classList.add('dragging');
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp, { once: true });
    }

    // タッチイベント用の関数
    function onEventTouchStart(e) {
      // リサイズハンドルクリックは除外
      if (e.target.classList.contains('resize-handle')) return;
      
      e.preventDefault(); // スクロールを防ぐ
      e.stopPropagation();
      const ev = Array.isArray(events) ? events.find(ev => ev.id === id) : null;
      if (!ev || ev.isTimetable === true) return;
      
      console.log('タッチ移動開始:', ev.title);
      
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
      document.addEventListener('touchmove', onTouchMove, { passive: false });
      document.addEventListener('touchend', onTouchEnd, { once: true });
    }

    function onMouseMove(e) {
      const dy = e.clientY - startY;
      const minutesDelta = Math.round(dy / 25 * 60 / 15) * 15; // 25px=1h, 15分単位に丸める
      
      if (resizing === 'top') {
        const newStart = new Date(originalStart.getTime() + minutesDelta * 60000);
        if (newStart < originalEnd) {
          // プレビュー: 位置と高さを更新（VISIBLE_START_HOURを考慮）
          const startMinutesTotal = newStart.getHours() * 60 + newStart.getMinutes();
          const endMinutesTotal = originalEnd.getHours() * 60 + originalEnd.getMinutes();
          const visibleStartMinutes = VISIBLE_START_HOUR * 60;
          const startMinutesFromVisible = Math.max(0, startMinutesTotal - visibleStartMinutes);
          const endMinutesFromVisible = Math.max(startMinutesFromVisible + 15, endMinutesTotal - visibleStartMinutes);
          const top = (startMinutesFromVisible / 60) * HOUR_HEIGHT_PX;
          const endTop = (endMinutesFromVisible / 60) * HOUR_HEIGHT_PX;
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
          const startTop = (startMinutesFromVisible / 60) * HOUR_HEIGHT_PX;
          const endTop = (endMinutesFromVisible / 60) * HOUR_HEIGHT_PX;
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
      const minutesDelta = Math.round(dy / 25 * 60 / 15) * 15; // 25px=1h, 15分単位に丸める
      
      if (resizing === 'move') {
        // ドラッグ移動のプレビュー
        const newTop = originalTop + dy;
        if (newTop >= 0) {
          item.style.top = `${newTop}px`;
        }
      }
    }

    function onMouseUp(e) {
      document.removeEventListener('mousemove', onMouseMove);
      item.classList.remove('resizing', 'dragging');

      const dy = e.clientY - startY;
      const minutesDelta = Math.round(dy / 25 * 60 / 15) * 15; // 15分単位に丸める
      const ev = Array.isArray(events) ? events.find(ev => ev.id === id) : null;
      if (!ev) return;

      console.log('イベント移動終了:', ev.title, 'resizing:', resizing, 'minutesDelta:', minutesDelta);

      // クリック（移動なし）は詳細モーダルを開く
      if (resizing === 'move' && minutesDelta === 0) {
        showEventModal(id);
        return;
      }

      // 新しい時間を計算
      let newStartTime = ev.startTime;
      let newEndTime = ev.endTime;
      
      // モバイルではリサイズを無効化
      if (isMobile && (resizing === 'top' || resizing === 'bottom')) {
        return; // リサイズ操作は無視
      }
      
      if (resizing === 'top') {
        const newStart = new Date(new Date(ev.startTime).getTime() + minutesDelta * 60000);
        if (newStart < new Date(ev.endTime)) {
          newStartTime = formatDateTimeLocal(newStart);
        }
      } else if (resizing === 'bottom') {
        const newEnd = new Date(new Date(ev.endTime).getTime() + minutesDelta * 60000);
        if (newEnd > new Date(ev.startTime)) {
          newEndTime = formatDateTimeLocal(newEnd);
        }
      } else if (resizing === 'move') {
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
      
      // Firebaseにのみ更新を送信（ローカル配列は変更しない）
      updateEvent(id, {
        title: ev.title,
        description: ev.description || '',
        startTime: newStartTime,
        endTime: newEndTime,
        color: ev.color
      });
    }

    function onTouchEnd(e) {
      document.removeEventListener('touchmove', onTouchMove);
      item.classList.remove('resizing', 'dragging');

      if (!e.changedTouches || e.changedTouches.length === 0) return;
      const touch = e.changedTouches[0];
      const dy = touch.clientY - startY;
      const minutesDelta = Math.round(dy / 25 * 60 / 15) * 15; // 15分単位に丸める
      const ev = Array.isArray(events) ? events.find(ev => ev.id === id) : null;
      if (!ev) return;

      console.log('タッチ移動終了:', ev.title, 'resizing:', resizing, 'minutesDelta:', minutesDelta);

      // クリック（移動なし）は詳細モーダルを開く
      if (resizing === 'move' && minutesDelta === 0) {
        showEventModal(id);
        return;
      }

      // 新しい時間を計算
      let newStartTime = ev.startTime;
      let newEndTime = ev.endTime;
      
      if (resizing === 'move') {
        // ドラッグ移動の処理
        const newStart = new Date(new Date(ev.startTime).getTime() + minutesDelta * 60000);
        const newEnd = new Date(new Date(ev.endTime).getTime() + minutesDelta * 60000);
        
        // 0時より前には移動できない
        if (newStart.getHours() >= 0) {
          newStartTime = formatDateTimeLocal(newStart);
          newEndTime = formatDateTimeLocal(newEnd);
        }
      }
      
      // Firebaseにのみ更新を送信（ローカル配列は変更しない）
      updateEvent(id, {
        title: ev.title,
        description: ev.description || '',
        startTime: newStartTime,
        endTime: newEndTime,
        color: ev.color
      });
    }

    // モバイルではリサイズハンドルのイベントリスナーを追加しない
    if (!isMobile) {
      topHandle.addEventListener('mousedown', onMouseDown(topHandle, 'top'));
      bottomHandle.addEventListener('mousedown', onMouseDown(bottomHandle, 'bottom'));
    }
    
    // イベント本体のドラッグ移動イベントリスナーを追加
    item.addEventListener('mousedown', onEventMouseDown);
    item.addEventListener('touchstart', onEventTouchStart);
  });
}

