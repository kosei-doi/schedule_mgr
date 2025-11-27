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

  deletes.forEach((rawId) => {
    const scheduleId = typeof rawId === 'string' ? rawId.trim() : '';
    if (!scheduleId) return;
    const eventEntry = existingMap.get(scheduleId);
    if (eventEntry) {
      try {
        eventEntry.deleteEvent();
        existingMap.delete(scheduleId);
        deleted += 1;
      } catch (error) {
        console.error('Failed to delete Google event', scheduleId, error);
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
    event.setAllDayDate(new Date(start));
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
  const event = isAllDay
    ? calendar.createAllDayEvent(title, start, { description: fullDescription, location })
    : calendar.createEvent(title, start, end, { description: fullDescription, location });

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
  const items = events.map((event) => {
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

  return buildResponse({
    success: true,
    message: 'Googleカレンダーから予定を取得しました。',
    fetchedAt: toIsoString(new Date()),
    range: {
      start: toIsoString(windowStart),
      end: toIsoString(windowEnd),
    },
    events: items,
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

