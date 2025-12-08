/**
 * Google Apps Script for syncing schedule_mgr events to Google Calendar.
 *
 * Deploy as a Web App (Execute the app as: Me, Who has access: Anyone with the link).
 * Update CALENDAR_ID if you want to target a specific calendar.
 */

const CALENDAR_ID = 'primary';
const DESCRIPTION_TAG = 'schedule_mgr_id:';
const DESCRIPTION_REGEX = new RegExp(`${DESCRIPTION_TAG}([\\w-]+)`, 'i');

function doPost(e) {
  try {
    if (!e?.postData?.contents) {
      return buildResponse({ success: false, message: 'Empty payload.' }, 400);
    }

    const payload = JSON.parse(e.postData.contents);
    const action = (payload?.action || '').toLowerCase();
    const calendarId = payload.calendarId || CALENDAR_ID;
    const calendar = CalendarApp.getCalendarById(calendarId);
    if (!calendar) {
      throw new Error(`Calendar not found: ${calendarId}`);
    }

    if (action === 'mutations') {
      return processMutations(calendar, payload);
    }

    const events = Array.isArray(payload?.events) ? payload.events : [];
    if (events.length === 0) {
      return buildResponse({ success: true, message: 'No events to process.', created: 0, updated: 0, skipped: 0 });
    }

    const windowStart = new Date();
    windowStart.setDate(1); // 今月1日
    windowStart.setHours(0, 0, 0, 0);

    const windowEnd = new Date(windowStart);
    // 2か月後の月末 (今月 +2) の 23:59:59
    windowEnd.setMonth(windowEnd.getMonth() + 3, 0);
    windowEnd.setHours(23, 59, 59, 999);

    const existingEvents = calendar.getEvents(windowStart, windowEnd, { search: DESCRIPTION_TAG });
    const existingMap = buildExistingMap(existingEvents);

    let created = 0;
    let updated = 0;
    let skipped = 0;

    events.forEach((eventPayload) => {
      const eventId = (eventPayload?.id || '').trim() || Utilities.getUuid();
      const start = eventPayload?.startDateTime ? new Date(eventPayload.startDateTime) : null;
      const end = eventPayload?.endDateTime ? new Date(eventPayload.endDateTime) : null;

      if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        skipped += 1;
        return;
      }

      const bodyDescription = sanitizeDescription(eventPayload?.description || '');
      const location = (eventPayload?.location || '').trim();
      const isAllDay = Boolean(eventPayload?.allDay);
      const title = (eventPayload?.title || '').trim() || '無題の予定';
      const reminderMinutes = getReminderMinutes(eventPayload?.reminderMinutes);

      const fullDescription = buildDescription(eventId, bodyDescription);
      const eventEntry = existingMap.get(eventId);

      if (eventEntry) {
        applyUpdates(eventEntry, { title, start, end, location, fullDescription, isAllDay, reminderMinutes });
        updated += 1;
      } else {
        createEvent(calendar, {
          title,
          start,
          end,
          location,
          isAllDay,
          fullDescription,
          reminderMinutes,
        });
        created += 1;
      }
    });

    return buildResponse({
      success: true,
      message: 'Googleカレンダーとの同期が完了しました。',
      created,
      updated,
      skipped,
    });
  } catch (error) {
    console.error('Sync failed:', error);
    return buildResponse({ success: false, message: error.message || 'Sync failed.' }, 500);
  }
}

function processMutations(calendar, payload) {
  const upserts = Array.isArray(payload?.upserts) ? payload.upserts : [];
  const deletes = Array.isArray(payload?.deletes) ? payload.deletes : [];

  const windowStart = new Date();
  windowStart.setFullYear(windowStart.getFullYear() - 1);
  windowStart.setMonth(0, 1);
  windowStart.setHours(0, 0, 0, 0);

  const windowEnd = new Date();
  windowEnd.setFullYear(windowEnd.getFullYear() + 2);
  windowEnd.setMonth(11, 31);
  windowEnd.setHours(23, 59, 59, 999);

  const existingEvents = calendar.getEvents(windowStart, windowEnd, { search: DESCRIPTION_TAG });
  const existingMap = buildExistingMap(existingEvents);

  let created = 0;
  let updated = 0;
  let deleted = 0;
  let skipped = 0;

  upserts.forEach((eventPayload) => {
    const eventId = (eventPayload?.id || '').trim();
    const start = eventPayload?.startDateTime ? new Date(eventPayload.startDateTime) : null;
    const end = eventPayload?.endDateTime ? new Date(eventPayload.endDateTime) : null;
    if (!eventId || !start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      skipped += 1;
      return;
    }

    const bodyDescription = sanitizeDescription(eventPayload?.description || '');
    const location = (eventPayload?.location || '').trim();
    const isAllDay = Boolean(eventPayload?.allDay);
    const title = (eventPayload?.title || '').trim() || '無題の予定';
    const reminderMinutes = getReminderMinutes(eventPayload?.reminderMinutes);
    const fullDescription = buildDescription(eventId, bodyDescription);

    const eventEntry = existingMap.get(eventId);
    if (eventEntry) {
      applyUpdates(eventEntry, { title, start, end, location, fullDescription, isAllDay, reminderMinutes });
      updated += 1;
      return;
    }

    createEvent(calendar, {
      title,
      start,
      end,
      location,
      isAllDay,
      fullDescription,
      reminderMinutes,
    });
    created += 1;
  });

  deletes.forEach((rawDeleteItem) => {
    let scheduleId = null;
    let deleteTitle = null;
    let deleteStartDate = null;
    let isAllDay = false;
    
    // 削除アイテムが文字列（IDのみ）の場合
    if (typeof rawDeleteItem === 'string') {
      scheduleId = rawDeleteItem.trim();
    if (!scheduleId) return;
    }
    // 削除アイテムがオブジェクト（ID + イベント情報）の場合
    else if (rawDeleteItem && typeof rawDeleteItem === 'object') {
      scheduleId = (rawDeleteItem.id || '').trim();
      deleteTitle = (rawDeleteItem.title || '').trim();
      deleteStartDate = rawDeleteItem.startTime ? new Date(rawDeleteItem.startTime) : null;
      isAllDay = Boolean(rawDeleteItem.allDay);
      
      if (!scheduleId && !deleteTitle) return;
    } else {
      return;
    }
    
    // まずIDでマッチングを試みる
    let eventEntry = scheduleId ? existingMap.get(scheduleId) : null;
    
    // IDでマッチングできない場合、日付とタイトルでマッチングを試みる
    if (!eventEntry && deleteTitle && deleteStartDate && !Number.isNaN(deleteStartDate.getTime())) {
      // 削除対象の日付を正規化（日付部分のみで比較）
      const targetDate = new Date(deleteStartDate);
      targetDate.setHours(0, 0, 0, 0);
      const targetDateStr = Utilities.formatDate(targetDate, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      
      // 既存のイベントから、IDでマッチングできなかったものを検索
      // 検索範囲は対象日の前後1日（日を跨ぐイベントも考慮）
      const searchStart = new Date(targetDate);
      searchStart.setDate(searchStart.getDate() - 1);
      searchStart.setHours(0, 0, 0, 0);
      const searchEnd = new Date(targetDate);
      searchEnd.setDate(searchEnd.getDate() + 1);
      searchEnd.setHours(23, 59, 59, 999);
      
      const allEvents = calendar.getEvents(searchStart, searchEnd, { search: deleteTitle });
      
      // タイトルと日付が一致するイベントを探す
      for (let i = 0; i < allEvents.length; i++) {
        const event = allEvents[i];
        
        // 既にIDでマッチング済みのイベントはスキップ
        const eventScheduleId = extractScheduleMgrId(event.getDescription() || '');
        if (eventScheduleId && scheduleId && eventScheduleId === scheduleId) {
          continue; // 既にIDでマッチング済みなのでスキップ
        }
        
        const eventTitle = (event.getTitle() || '').trim();
        
        // タイトルが一致するかチェック（正規化して比較）
        if (normalizeTitleForComparison(eventTitle) !== normalizeTitleForComparison(deleteTitle)) {
          continue;
        }
        
        // 日付が一致するかチェック（日付部分のみで比較）
        let eventStartDate = null;
        if (event.isAllDayEvent()) {
          eventStartDate = new Date(event.getAllDayStartDate());
        } else {
          eventStartDate = new Date(event.getStartTime());
        }
        eventStartDate.setHours(0, 0, 0, 0);
        const eventDateStr = Utilities.formatDate(eventStartDate, Session.getScriptTimeZone(), 'yyyy-MM-dd');
        
        // 日付が一致する場合
        if (eventDateStr === targetDateStr) {
          eventEntry = event;
          break;
        }
      }
    }
    
    // マッチしたイベントを削除
    if (eventEntry) {
      try {
        eventEntry.deleteEvent();
        if (scheduleId) {
        existingMap.delete(scheduleId);
        }
        deleted += 1;
      } catch (error) {
        console.error('Failed to delete Google event', scheduleId || deleteTitle, error);
      }
    }
  });

  return buildResponse({
    success: true,
    message: 'Mutations applied.',
    created,
    updated,
    deleted,
    skipped,
  });
}

function buildExistingMap(events) {
  const map = new Map();
  events.forEach((event) => {
    const match = (event.getDescription() || '').match(DESCRIPTION_REGEX);
    if (match && match[1]) {
      map.set(match[1], event);
    }
  });
  return map;
}

function buildDescription(eventId, description) {
  const clean = removeTagFromDescription(description);
  const separator = clean ? '\n\n' : '';
  return `${DESCRIPTION_TAG}${eventId}${separator}${clean}`;
}

function sanitizeDescription(text) {
  return typeof text === 'string' ? text.replace(/\r\n/g, '\n') : '';
}

function removeTagFromDescription(description) {
  // Remove the schedule_mgr_id tag and its value (format: "schedule_mgr_id:value" or "schedule_mgr_id:value\n\ndescription")
  // Match the tag followed by word characters/hyphens (the ID), optionally followed by separator and rest of description
  // Use non-greedy match to stop at first occurrence
  const text = description || '';
  // First, try to match the tag with ID and optional separator
  const tagPattern = new RegExp(`${DESCRIPTION_TAG}[\\w-]+(?:\\s*\\n\\n)?`, 'i');
  return text.replace(tagPattern, '').trim();
}

function getReminderMinutes(value) {
  if (typeof value !== 'number') return null;
  const minutes = Math.floor(value);
  return Number.isFinite(minutes) && minutes >= 0 ? minutes : null;
}

function applyUpdates(event, { title, start, end, location, fullDescription, isAllDay, reminderMinutes }) {
  if (isAllDay) {
    // 終日イベントの場合、開始日と終了日を設定（終了日は「含まない」日として扱われる）
    const startDate = new Date(start);
    const endDate = new Date(end);
    // 終了日が開始日と同じまたはそれ以前の場合、開始日の翌日として扱う
    if (endDate <= startDate) {
      endDate.setDate(startDate.getDate() + 1);
    }
    event.setAllDayDates(startDate, endDate);
  } else {
    event.setTime(start, end);
  }
  event.setTitle(title);
  event.setDescription(fullDescription);
  event.setLocation(location);

  event.removeAllReminders();
  if (reminderMinutes !== null) {
    event.addPopupReminder(reminderMinutes);
  }
}

function createEvent(calendar, { title, start, end, location, isAllDay, fullDescription, reminderMinutes }) {
  let event;
  if (isAllDay) {
    // 終日イベントの場合、開始日と終了日を設定（終了日は「含まない」日として扱われる）
    const startDate = new Date(start);
    const endDate = new Date(end);
    // 終了日が開始日と同じまたはそれ以前の場合、開始日の翌日として扱う
    if (endDate <= startDate) {
      endDate.setDate(startDate.getDate() + 1);
    }
    event = calendar.createAllDayEvent(title, startDate, endDate, { description: fullDescription, location });
  } else {
    event = calendar.createEvent(title, start, end, { description: fullDescription, location });
  }

  if (reminderMinutes !== null) {
    event.removeAllReminders();
    event.addPopupReminder(reminderMinutes);
  }
}

function buildResponse(payload, statusCode) {
  // Note: Google Apps Script ContentService doesn't support setting HTTP status codes
  // The statusCode parameter is accepted for API compatibility but ignored
  const output = ContentService.createTextOutput(JSON.stringify(payload));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}

function doGet(e) {
  try {
    if (e?.parameter?.action === 'events') {
      return fetchCalendarEvents();
    }
    if (e?.parameter?.action === 'clear') {
      return clearCalendarEvents();
    }
    return buildResponse({ success: true, message: 'schedule_mgr Google Calendar Sync endpoint is running.' });
  } catch (error) {
    console.error('doGet failed:', error);
    return buildResponse({ success: false, message: error.message || 'Failed to fetch events.' });
  }
}

function fetchCalendarEvents() {
  const calendar = CalendarApp.getCalendarById(CALENDAR_ID);
  if (!calendar) {
    throw new Error(`Calendar not found: ${CALENDAR_ID}`);
  }

  const windowStart = new Date();
  windowStart.setDate(1);
  windowStart.setHours(0, 0, 0, 0);

  const windowEnd = new Date(windowStart);
  windowEnd.setMonth(windowEnd.getMonth() + 3, 0);
  windowEnd.setHours(23, 59, 59, 999);

  const events = calendar.getEvents(windowStart, windowEnd);
  
  // 重複削除処理を実行（削除されたイベントのIDを取得）
  const deduplicationResult = deduplicateGoogleCalendarEvents(events);
  const deletedEventIds = new Set(deduplicationResult.deletedEventIds || []);
  
  // 削除されたイベントを除外してマッピング
  const items = events
    .filter((event) => !deletedEventIds.has(event.getId()))
    .map((event) => {
      const rawDescription = sanitizeDescription(event.getDescription() || '');
      const scheduleMgrId = extractScheduleMgrId(rawDescription);
      return {
        scheduleMgrId,
        googleEventId: event.getId(),
        title: event.getTitle(),
        description: removeTagFromDescription(rawDescription),
        location: event.getLocation() || '',
        allDay: event.isAllDayEvent(),
        startDateTime: formatEventDate(event, 'start'),
        endDateTime: formatEventDate(event, 'end'),
        lastUpdated: toIsoString(event.getLastUpdated()),
        reminderMinutes: getPrimaryReminderMinutes(event),
      };
    });

  const message = deduplicationResult.deleted > 0
    ? `Googleカレンダーから予定を取得しました。重複削除: ${deduplicationResult.deleted}件`
    : 'Googleカレンダーから予定を取得しました。';

  return buildResponse({
    success: true,
    message: message,
    fetchedAt: toIsoString(new Date()),
    range: {
      start: toIsoString(windowStart),
      end: toIsoString(windowEnd),
    },
    events: items,
    deduplicated: deduplicationResult.deleted,
  });
}

function clearCalendarEvents() {
  const calendar = CalendarApp.getCalendarById(CALENDAR_ID);
  if (!calendar) {
    throw new Error(`Calendar not found: ${CALENDAR_ID}`);
  }

  const windowStart = new Date();
  windowStart.setFullYear(windowStart.getFullYear() - 1);

  const windowEnd = new Date();
  windowEnd.setFullYear(windowEnd.getFullYear() + 2);

  const events = calendar.getEvents(windowStart, windowEnd, { search: DESCRIPTION_TAG });
  let deleted = 0;
  events.forEach((event) => {
    try {
      event.deleteEvent();
      deleted += 1;
    } catch (error) {
      console.error('Failed to delete event', event.getId(), error);
    }
  });

  return buildResponse({
    success: true,
    message: 'Googleカレンダーのschedule_mgrイベントを削除しました。',
    deleted,
    range: {
      start: toIsoString(windowStart),
      end: toIsoString(windowEnd),
    },
  });
}

// Googleカレンダー内の重複イベントを削除（同じ日・同じ名前のイベント）
function deduplicateGoogleCalendarEvents(events) {
  if (!events || events.length === 0) {
    return { deleted: 0, deletedEventIds: [] };
  }

  // 日付とタイトルでグループ化
  const eventsByDateTitle = new Map();
  
  events.forEach((event) => {
    const title = event.getTitle() || '';
    const normalizedTitle = normalizeTitleForComparison(title);
    
    // 開始日を取得（終日イベントの場合はgetAllDayStartDate、そうでない場合はgetStartTime）
    let eventDate;
    if (event.isAllDayEvent()) {
      eventDate = event.getAllDayStartDate();
    } else {
      eventDate = event.getStartTime();
    }
    
    // 日付部分のみを取得（YYYY-MM-DD形式）
    const dateStr = Utilities.formatDate(eventDate, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    const key = `${dateStr}|${normalizedTitle}`;
    
    if (!eventsByDateTitle.has(key)) {
      eventsByDateTitle.set(key, []);
    }
    eventsByDateTitle.get(key).push(event);
  });

  let deleted = 0;
  const deletedEventIds = [];

  // 各グループで重複チェック
  eventsByDateTitle.forEach((duplicates, key) => {
    if (duplicates.length <= 1) return; // 重複なし

    // 最新のイベントを残す（lastUpdatedが新しいもの）
    duplicates.sort((a, b) => {
      const aTime = a.getLastUpdated() ? a.getLastUpdated().getTime() : 0;
      const bTime = b.getLastUpdated() ? b.getLastUpdated().getTime() : 0;
      return bTime - aTime; // 新しい順
    });

    const keeper = duplicates[0];
    const title = keeper.getTitle() || '(無題)';
    const dateStr = key.split('|')[0];
    
    console.log(`[Google重複削除] "${title}" (${dateStr}) -> ${duplicates.length}件の重複を検出`);

    // 最新以外を削除
    for (let i = 1; i < duplicates.length; i++) {
      try {
        const eventId = duplicates[i].getId();
        duplicates[i].deleteEvent();
        deleted += 1;
        deletedEventIds.push(eventId);
        console.log(`[Google重複削除] 削除: "${title}" (${dateStr}) - ${eventId}`);
      } catch (error) {
        console.error(`[Google重複削除] 削除に失敗:`, duplicates[i].getId(), error);
      }
    }
  });

  if (deleted > 0) {
    console.log(`[Google重複削除] 完了: ${deleted}件の重複を削除しました`);
  }

  return { deleted, deletedEventIds };
}

function extractScheduleMgrId(description) {
  const match = (description || '').match(DESCRIPTION_REGEX);
  return match && match[1] ? match[1] : null;
}

function formatEventDate(event, kind) {
  if (event.isAllDayEvent()) {
    const target = kind === 'start' ? event.getAllDayStartDate() : event.getAllDayEndDate();
    return toIsoString(target);
  }
  const target = kind === 'start' ? event.getStartTime() : event.getEndTime();
  return toIsoString(target);
}

function getPrimaryReminderMinutes(event) {
  const reminders = event.getPopupReminders();
  if (!reminders || reminders.length === 0) return null;
  const reminder = reminders[0];
  return typeof reminder.minutes === 'number' ? reminder.minutes : null;
}

function toIsoString(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return Utilities.formatDate(date, 'UTC', "yyyy-MM-dd'T'HH:mm:ss'Z'");
}

// タイトル比較用に正規化（空白を除去、小文字に変換）
function normalizeTitleForComparison(title) {
  if (!title && title !== 0) return '';
  return String(title)
    .trim()
    .replace(/\s+/g, '') // 全ての空白を除去
    .toLowerCase();
}

