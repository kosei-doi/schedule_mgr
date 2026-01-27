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
    windowStart.setDate(1); // First day of current month
    windowStart.setHours(0, 0, 0, 0);

    const windowEnd = new Date(windowStart);
    // End of month 2 months later (current month + 2) at 23:59:59
    windowEnd.setMonth(windowEnd.getMonth() + 3, 0);
    windowEnd.setHours(23, 59, 59, 999);

    const existingEvents = calendar.getEvents(windowStart, windowEnd, { search: DESCRIPTION_TAG });
    let existingMap = buildExistingMap(existingEvents);
    const hasGoogleIdUpserts = events.some((item) => item && item.googleEventId);
    if (hasGoogleIdUpserts) {
      const allEvents = calendar.getEvents(windowStart, windowEnd);
      const allEventsMap = buildExistingMap(allEvents);
      for (const [googleId, event] of allEventsMap.googleIdMap.entries()) {
        if (!existingMap.googleIdMap.has(googleId)) {
          existingMap.googleIdMap.set(googleId, event);
        }
      }
      for (const [scheduleId, event] of allEventsMap.scheduleIdMap.entries()) {
        if (!existingMap.scheduleIdMap.has(scheduleId)) {
          existingMap.scheduleIdMap.set(scheduleId, event);
        }
      }
    }

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
      const title = (eventPayload?.title || '').trim() || 'Untitled Event';
      const reminderMinutes = getReminderMinutes(eventPayload?.reminderMinutes);

      const fullDescription = buildDescription(eventId, bodyDescription);
      let eventEntry = existingMap.scheduleIdMap.get(eventId);
      if (!eventEntry && eventPayload?.googleEventId) {
        eventEntry = existingMap.googleIdMap.get(String(eventPayload.googleEventId).trim());
      }

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
      message: 'Synchronization with Google Calendar completed.',
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

  // Calculate dynamic window based on events being processed (similar to bulk sync)
  // Start with current month, extend based on event dates
  let windowStart = new Date();
  windowStart.setDate(1);
  windowStart.setHours(0, 0, 0, 0);
  
  let windowEnd = new Date(windowStart);
  windowEnd.setMonth(windowEnd.getMonth() + 3, 0);
  windowEnd.setHours(23, 59, 59, 999);

  // Extend window to include all events being processed
  [...upserts, ...deletes].forEach((item) => {
    let eventDate = null;
    if (item && typeof item === 'object') {
      if (item.startDateTime) {
        eventDate = new Date(item.startDateTime);
      } else if (item.startTime) {
        eventDate = new Date(item.startTime);
      }
    }
    
    if (eventDate && !Number.isNaN(eventDate.getTime())) {
      // Extend window to include this event (with 1 month buffer)
      const eventStart = new Date(eventDate);
      eventStart.setDate(1);
      eventStart.setHours(0, 0, 0, 0);
      
      const eventEnd = new Date(eventStart);
      eventEnd.setMonth(eventEnd.getMonth() + 1, 0);
      eventEnd.setHours(23, 59, 59, 999);
      
      if (eventStart < windowStart) {
        windowStart = new Date(eventStart);
      }
      if (eventEnd > windowEnd) {
        windowEnd = new Date(eventEnd);
      }
    }
  });

  // Limit window to reasonable bounds (max 1 year past, 2 years future)
  const minStart = new Date();
  minStart.setFullYear(minStart.getFullYear() - 1);
  minStart.setMonth(0, 1);
  minStart.setHours(0, 0, 0, 0);
  
  const maxEnd = new Date();
  maxEnd.setFullYear(maxEnd.getFullYear() + 2);
  maxEnd.setMonth(11, 31);
  maxEnd.setHours(23, 59, 59, 999);
  
  if (windowStart < minStart) windowStart = new Date(minStart);
  if (windowEnd > maxEnd) windowEnd = new Date(maxEnd);

  // Fetch events with the tag (for upserts and tagged deletes)
  const existingEvents = calendar.getEvents(windowStart, windowEnd, { search: DESCRIPTION_TAG });
  let existingMap = buildExistingMap(existingEvents);
  
  // If any upsert/delete has googleEventId, also fetch ALL events (without tag filter)
  const hasGoogleIdUpserts = upserts.some(item => 
    item && typeof item === 'object' && item.googleEventId
  );
  const hasGoogleIdDeletes = deletes.some(item => 
    item && typeof item === 'object' && item.googleEventId
  );
  if (hasGoogleIdUpserts || hasGoogleIdDeletes) {
    const allEvents = calendar.getEvents(windowStart, windowEnd);
    // Merge all events into the map (this will add fetched-only events that don't have the tag)
    const allEventsMap = buildExistingMap(allEvents);
    // Merge googleIdMap (this is the important one for deletions)
    for (const [googleId, event] of allEventsMap.googleIdMap.entries()) {
      if (!existingMap.googleIdMap.has(googleId)) {
        existingMap.googleIdMap.set(googleId, event);
      }
    }
    // Also merge scheduleIdMap for completeness
    for (const [scheduleId, event] of allEventsMap.scheduleIdMap.entries()) {
      if (!existingMap.scheduleIdMap.has(scheduleId)) {
        existingMap.scheduleIdMap.set(scheduleId, event);
      }
    }
  }

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
    const title = (eventPayload?.title || '').trim() || 'Untitled Event';
    const reminderMinutes = getReminderMinutes(eventPayload?.reminderMinutes);
    const fullDescription = buildDescription(eventId, bodyDescription);

    let eventEntry = existingMap.scheduleIdMap.get(eventId);
    if (!eventEntry && eventPayload?.googleEventId) {
      eventEntry = existingMap.googleIdMap.get(String(eventPayload.googleEventId).trim());
    }
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

    // When delete item has googleEventId (e.g. fetched-only events), delete by Google ID first
    const googleEventId = (rawDeleteItem && typeof rawDeleteItem === 'object' && rawDeleteItem.googleEventId)
      ? String(rawDeleteItem.googleEventId).trim()
      : null;
    const isAllDayDelete = (rawDeleteItem && typeof rawDeleteItem === 'object') ? Boolean(rawDeleteItem.allDay) : false;
    if (googleEventId) {
      // First try to find in the existing events map (faster and more reliable)
      let eventToDelete = existingMap.googleIdMap.get(googleEventId);
      if (eventToDelete) {
        try {
          eventToDelete.deleteEvent();
          deleted += 1;
          return;
        } catch (e) {
          // Fall through to CalendarApp.getEventById() as backup
        }
      }
      // Fallback: try CalendarApp.getEventById() if not found in map
      try {
        const byId = CalendarApp.getEventById(googleEventId);
        if (byId) {
          byId.deleteEvent();
          deleted += 1;
          return;
        }
      } catch (e) {
        // Event not in this calendar or invalid id; fall through to id/title+date matching
      }
    }

    // When delete item is a string (ID only)
    if (typeof rawDeleteItem === 'string') {
      scheduleId = rawDeleteItem.trim();
    if (!scheduleId) return;
    }
    // When delete item is an object (ID + event information)
    else if (rawDeleteItem && typeof rawDeleteItem === 'object') {
      scheduleId = (rawDeleteItem.id || '').trim();
      deleteTitle = (rawDeleteItem.title || '').trim();
      deleteStartDate = rawDeleteItem.startTime ? new Date(rawDeleteItem.startTime) : null;
      isAllDay = Boolean(rawDeleteItem.allDay);
      
      if (!scheduleId && !deleteTitle) return;
    } else {
      return;
    }
    
    // First try matching by ID
    let eventEntry = scheduleId ? existingMap.scheduleIdMap.get(scheduleId) : null;
    
    // If ID matching fails, try matching by comprehensive event properties (title + startTime + endTime + allDay)
    // Use existing events from the map instead of making additional calendar queries
    if (!eventEntry && deleteTitle && deleteStartDate && !Number.isNaN(deleteStartDate.getTime())) {
      // Normalize target date for deletion (compare date part only)
      const targetDate = new Date(deleteStartDate);
      targetDate.setHours(0, 0, 0, 0);
      const targetDateStr = Utilities.formatDate(targetDate, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      
      // Get full start and end times for comparison
      const deleteStartTimeStr = deleteStartDate ? toIsoString(deleteStartDate) : '';
      const deleteEndDate = rawDeleteItem && typeof rawDeleteItem === 'object' && rawDeleteItem.endTime 
        ? new Date(rawDeleteItem.endTime) 
        : null;
      const deleteEndTimeStr = deleteEndDate && !Number.isNaN(deleteEndDate.getTime()) ? toIsoString(deleteEndDate) : '';
      const deleteAllDayKey = isAllDay ? '1' : '0';
      
      // Search through already-fetched existing events instead of making new queries
      const normalizedDeleteTitle = normalizeTitleForComparison(deleteTitle);
      
      for (const [existingId, existingEvent] of existingMap.scheduleIdMap.entries()) {
        // Skip if already matched by ID
        if (scheduleId && existingId === scheduleId) {
          continue;
        }
        
        const eventTitle = (existingEvent.getTitle() || '').trim();
        
        // Check if title matches (normalize and compare)
        if (normalizeTitleForComparison(eventTitle) !== normalizedDeleteTitle) {
          continue;
        }
        
        // Check if date matches (compare date part only)
        let eventStartDate = null;
        if (existingEvent.isAllDayEvent()) {
          eventStartDate = new Date(existingEvent.getAllDayStartDate());
        } else {
          eventStartDate = new Date(existingEvent.getStartTime());
        }
        eventStartDate.setHours(0, 0, 0, 0);
        const eventDateStr = Utilities.formatDate(eventStartDate, Session.getScriptTimeZone(), 'yyyy-MM-dd');
        
        // When date matches, also check startTime, endTime, and allDay status
        if (eventDateStr === targetDateStr) {
          // Get full start and end times for comparison
          let eventStartTimeStr = '';
          let eventEndTimeStr = '';
          if (existingEvent.isAllDayEvent()) {
            const startDate = existingEvent.getAllDayStartDate();
            const endDate = existingEvent.getAllDayEndDate();
            eventStartTimeStr = startDate ? toIsoString(startDate) : '';
            eventEndTimeStr = endDate ? toIsoString(endDate) : '';
          } else {
            const startTime = existingEvent.getStartTime();
            const endTime = existingEvent.getEndTime();
            eventStartTimeStr = startTime ? toIsoString(startTime) : '';
            eventEndTimeStr = endTime ? toIsoString(endTime) : '';
          }
          const eventAllDayKey = existingEvent.isAllDayEvent() ? '1' : '0';
          
          // Match only if startTime, endTime, and allDay status also match
          if (eventStartTimeStr === deleteStartTimeStr && 
              eventEndTimeStr === deleteEndTimeStr && 
              eventAllDayKey === deleteAllDayKey) {
            eventEntry = existingEvent;
            break;
          }
        }
      }
    }
    
    // Delete matched event
    if (eventEntry) {
      try {
        eventEntry.deleteEvent();
        if (scheduleId) {
        existingMap.scheduleIdMap.delete(scheduleId);
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
  const googleIdMap = new Map();
  events.forEach((event) => {
    const match = (event.getDescription() || '').match(DESCRIPTION_REGEX);
    if (match && match[1]) {
      map.set(match[1], event);
    }
    // Also map by Google event ID for faster lookup
    const googleId = event.getId();
    if (googleId) {
      googleIdMap.set(googleId, event);
    }
  });
  return { scheduleIdMap: map, googleIdMap: googleIdMap };
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
    // For all-day events, set start and end dates (end date is treated as exclusive)
    const startDate = new Date(start);
    startDate.setHours(0, 0, 0, 0); // Ensure start is at midnight
    
    const endDate = new Date(end);
    // Extract date portion and add 1 day for exclusive end date
    // The app sends inclusive end (e.g., Jan 2 23:59), but Google expects exclusive (Jan 3 00:00)
    endDate.setHours(0, 0, 0, 0); // Normalize to midnight
    endDate.setDate(endDate.getDate() + 1); // Add 1 day for exclusive end
    
    // If end date is the same as or before start date, treat as the day after start date
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
    // For all-day events, set start and end dates (end date is treated as exclusive)
    const startDate = new Date(start);
    startDate.setHours(0, 0, 0, 0); // Ensure start is at midnight
    
    const endDate = new Date(end);
    // Extract date portion and add 1 day for exclusive end date
    // The app sends inclusive end (e.g., Jan 2 23:59), but Google expects exclusive (Jan 3 00:00)
    endDate.setHours(0, 0, 0, 0); // Normalize to midnight
    endDate.setDate(endDate.getDate() + 1); // Add 1 day for exclusive end
    
    // If end date is the same as or before start date, treat as the day after start date
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
  
  // Execute deduplication (get IDs of deleted events)
  const deduplicationResult = deduplicateGoogleCalendarEvents(events);
  const deletedEventIds = new Set(deduplicationResult.deletedEventIds || []);
  
  // Exclude deleted events and map
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
    ? `Fetched events from Google Calendar. Duplicates removed: ${deduplicationResult.deleted}`
    : 'Fetched events from Google Calendar.';

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
    message: 'Deleted schedule_mgr events from Google Calendar.',
    deleted,
    range: {
      start: toIsoString(windowStart),
      end: toIsoString(windowEnd),
    },
  });
}

// Build a comprehensive key for Google Calendar events that includes more properties
function buildGoogleEventKey(event) {
  if (!event) return null;
  
  const title = event.getTitle() || '';
  const normalizedTitle = normalizeTitleForComparison(title);
  
  // Get date part (YYYY-MM-DD format)
  let eventDate;
  if (event.isAllDayEvent()) {
    eventDate = event.getAllDayStartDate();
  } else {
    eventDate = event.getStartTime();
  }
  const dateStr = Utilities.formatDate(eventDate, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  
  // Get full start time (ISO string)
  let startTimeStr = '';
  if (event.isAllDayEvent()) {
    const startDate = event.getAllDayStartDate();
    startTimeStr = startDate ? toIsoString(startDate) : '';
  } else {
    const startTime = event.getStartTime();
    startTimeStr = startTime ? toIsoString(startTime) : '';
  }
  
  // Get full end time (ISO string)
  let endTimeStr = '';
  if (event.isAllDayEvent()) {
    const endDate = event.getAllDayEndDate();
    endTimeStr = endDate ? toIsoString(endDate) : '';
  } else {
    const endTime = event.getEndTime();
    endTimeStr = endTime ? toIsoString(endTime) : '';
  }
  
  // Get description (normalized)
  const description = event.getDescription() || '';
  const normalizedDescription = normalizeTitleForComparison(description);
  
  // Get all-day status
  const allDayKey = event.isAllDayEvent() ? '1' : '0';
  
  // Build comprehensive key: date|title|startTime|endTime|description|allDay
  return `${dateStr}|${normalizedTitle}|${startTimeStr}|${endTimeStr}|${normalizedDescription}|${allDayKey}`;
}

// Remove duplicate events in Google Calendar (events must match title, startTime, endTime, description, and allDay status)
function deduplicateGoogleCalendarEvents(events) {
  if (!events || events.length === 0) {
    return { deleted: 0, deletedEventIds: [] };
  }

  // Group by comprehensive key (date + title + startTime + endTime + description + allDay)
  const eventsByKey = new Map();
  
  events.forEach((event) => {
    const key = buildGoogleEventKey(event);
    if (!key) return;
    
    if (!eventsByKey.has(key)) {
      eventsByKey.set(key, []);
    }
    eventsByKey.get(key).push(event);
  });

  let deleted = 0;
  const deletedEventIds = [];

  // Check duplicates in each group
  eventsByKey.forEach((duplicates, key) => {
    if (duplicates.length <= 1) return; // No duplicates

    // Keep the latest event (newest lastUpdated)
    duplicates.sort((a, b) => {
      const aTime = a.getLastUpdated() ? a.getLastUpdated().getTime() : 0;
      const bTime = b.getLastUpdated() ? b.getLastUpdated().getTime() : 0;
      return bTime - aTime; // Newest first
    });

    const keeper = duplicates[0];
    const title = keeper.getTitle() || '(Untitled)';
    const dateStr = key.split('|')[0];
    
    console.log(`[Google Deduplication] "${title}" (${dateStr}) -> Found ${duplicates.length} duplicates`);

    // Delete all except the latest
    for (let i = 1; i < duplicates.length; i++) {
      try {
        const eventId = duplicates[i].getId();
        duplicates[i].deleteEvent();
        deleted += 1;
        deletedEventIds.push(eventId);
        console.log(`[Google Deduplication] Deleted: "${title}" (${dateStr}) - ${eventId}`);
      } catch (error) {
        console.error(`[Google Deduplication] Failed to delete:`, duplicates[i].getId(), error);
      }
    }
  });

  if (deleted > 0) {
    console.log(`[Google Deduplication] Completed: Removed ${deleted} duplicates`);
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

// Normalize title for comparison (remove whitespace, convert to lowercase)
function normalizeTitleForComparison(title) {
  if (!title && title !== 0) return '';
  return String(title)
    .trim()
    .replace(/\s+/g, '') // Remove all whitespace
    .toLowerCase();
}


