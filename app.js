let unsubscribeEvents = null;
let unsubscribeChildAdded = null;
let unsubscribeChildChanged = null;
let unsubscribeChildRemoved = null;

// Event listener cleanup utility
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
      // Ignore errors
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

// Global variables
let events = [];
let currentDate = new Date();
let currentView = 'day'; // 'day', 'week', or 'month'
let editingEventId = null;
let isFirebaseEnabled = false;
const clientId = (() => Date.now().toString(36) + Math.random().toString(36).slice(2))();
let googleSyncIntervalId = null;
let googleSyncTimeoutId = null;
let googleSyncInFlight = false;
let isGoogleSyncing = false; // Google sync in progress flag (prevents re-rendering)
let googleSyncStatus = 'unsynced'; // 'unsynced' | 'syncing' | 'synced' | 'error'
let googleSyncStartTime = null; // Sync start time (Date object)
let googleSyncLastDuration = null; // Last sync duration (milliseconds)
let googleSyncTooltipTimerId = null; // Tooltip real-time update timer ID
const GOOGLE_SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
let crudStatus = 'idle'; // 'idle' | 'processing' | 'success' | 'error'
let crudStatusStartTime = null; // CRUD operation start time (Date object)
let crudStatusLastDuration = null; // Last CRUD operation duration (milliseconds)
let currentTimeIndicatorIntervalId = null; // Interval ID for updating current time indicator
const VISIBLE_START_HOUR = 4;
const VISIBLE_END_HOUR = 23;
const HOUR_HEIGHT_PX = 25; // Fallback value (actual value is obtained dynamically)
const MIN_EVENT_HEIGHT_PX = 15;
const VISIBLE_HOURS = VISIBLE_END_HOUR - VISIBLE_START_HOUR + 1;

// Get actual height of time slot (1 hour)
function getHourHeight() {
  // Find time slot in day view or week view
  const timeSlot = document.querySelector('.time-slot');
  if (timeSlot) {
    const rect = timeSlot.getBoundingClientRect();
    if (rect.height > 0) {
      return rect.height;
    }
  }
  // Fallback: Divide week view day-events-container height by 20 (priority)
  const weekContainer = document.querySelector('.day-events-container');
  if (weekContainer) {
    const rect = weekContainer.getBoundingClientRect();
    if (rect.height > 0) {
      return rect.height / 20;
    }
  }
  // Fallback: Divide event container height by 20 (day view)
  const dayContainer = document.querySelector('.event-container');
  if (dayContainer) {
    const rect = dayContainer.getBoundingClientRect();
    if (rect.height > 0) {
      return rect.height / 20;
    }
  }
  return HOUR_HEIGHT_PX;
}

// Convert hex color to RGB
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

// Google Apps Script Web App (POST endpoint)
// Deployed Google Apps Script Web App URL
const GOOGLE_APPS_SCRIPT_ENDPOINT =
  window?.GAS_ENDPOINT_OVERRIDE ||
  'https://script.google.com/macros/s/AKfycbyBvGKQYGvGG7qKlwqXcWbF90kkiXOHAGieu4RJCH2-DNb1hr0bIpvhpkCjot9Ub59bxA/exec';

function showMessage(message, type = 'info', duration = 4000) {
  // Notification display disabled (notifications below header are not shown)
  return;
}

// Show confirmation modal
function showConfirmModal(message, title = 'Confirm') {
  return new Promise((resolve) => {
    const modal = safeGetElementById('confirmModal');
    const titleEl = safeGetElementById('confirmTitle');
    const messageEl = safeGetElementById('confirmMessage');
    const okBtn = safeGetElementById('confirmOkBtn');
    const cancelBtn = safeGetElementById('confirmCancelBtn');
    
    if (!modal || !titleEl || !messageEl || !okBtn || !cancelBtn) {
      // Fallback: Use browser confirm
      resolve(confirm(message));
      return;
    }
    
    titleEl.textContent = title;
    messageEl.textContent = message;
    modal.classList.add('show');
    modal.setAttribute('aria-hidden', 'false');
    // Control body overflow to prevent scrollbar on mobile (CSS class only)
    document.body.classList.add('modal-open');
    
    let escHandler = null;
    
    const cleanup = () => {
      modal.classList.remove('show');
      modal.setAttribute('aria-hidden', 'true');
      // Only remove modal-open class if event modal is not open
      // The event modal will handle removing it when it closes
      const eventModal = safeGetElementById('eventModal');
      if (!eventModal || !eventModal.classList.contains('show')) {
        document.body.classList.remove('modal-open');
      }
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
    
    // Cancel with ESC key
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

// Show/hide loading overlay
function showLoading(message = 'Processing...') {
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

// Safely get element by ID (with null check)
function safeGetElementById(id) {
  const element = document.getElementById(id);
  if (!element) {
  }
  return element;
}

// Update Google sync status indicator (unified with CRUD status)
function updateGoogleSyncIndicator(status) {
  googleSyncStatus = status;
  
  if (status === 'syncing' && !googleSyncStartTime) {
    googleSyncStartTime = new Date();
  } else if (status !== 'syncing' && googleSyncStartTime) {
    googleSyncLastDuration = Date.now() - googleSyncStartTime.getTime();
    googleSyncStartTime = null;
  }
  
  updateUnifiedStatusIndicator();
}

// Update unified status indicator (shows CRUD status when active, otherwise Google sync status)
function updateUnifiedStatusIndicator() {
  const indicator = safeGetElementById('googleSyncIndicator');
  if (!indicator) return;
  
  // Remove all status classes
  indicator.classList.remove('status-synced', 'status-syncing', 'status-error', 'status-unsynced', 'status-idle', 'status-processing', 'status-success');
  
  // If Google sync is actively syncing, show that (even if CRUD is processing/success)
  // This ensures users see Google sync status when CRUD operations trigger Google sync
  if (googleSyncStatus === 'syncing') {
    indicator.classList.add('status-syncing');
  } else if (crudStatus === 'processing') {
    // Show CRUD processing when Google sync is not active
    indicator.classList.add('status-processing');
  } else if (crudStatus === 'success') {
    // Show CRUD success briefly, but if Google sync is still syncing, that takes priority
    indicator.classList.add('status-success');
  } else if (crudStatus === 'error') {
    indicator.classList.add('status-error');
  } else {
    // Show Google sync status when CRUD is idle
    if (googleSyncStatus === 'synced') {
      indicator.classList.add('status-synced');
    } else if (googleSyncStatus === 'error') {
      indicator.classList.add('status-error');
    } else {
      indicator.classList.add('status-unsynced');
    }
  }
}

// Get Google sync status details
function getGoogleSyncStatusInfo() {
  let statusText = '';
  switch (googleSyncStatus) {
    case 'synced':
      statusText = 'Synced';
      break;
    case 'syncing':
      statusText = 'Syncing';
      break;
    case 'error':
      statusText = 'Error';
      break;
    default:
      statusText = 'Unsynced';
  }
  
  let timeText = '';
  if (googleSyncStatus === 'syncing' && googleSyncStartTime) {
    const elapsed = Date.now() - googleSyncStartTime.getTime();
    const seconds = (elapsed / 1000).toFixed(1);
    timeText = `${seconds}s`;
  } else if (googleSyncLastDuration !== null) {
    const seconds = (googleSyncLastDuration / 1000).toFixed(1);
    timeText = `${seconds}s`;
  }
  
  return { status: statusText, time: timeText };
}

// Show unified status tooltip (shows both CRUD and Google sync status)
function showGoogleSyncStatusTooltip(event) {
  // Remove existing tooltips (prevent duplicates)
  const existingTooltips = document.querySelectorAll('#googleSyncTooltip, #crudStatusTooltip');
  existingTooltips.forEach(el => el.remove());
  
  // Create new tooltip
  const tooltip = document.createElement('div');
  tooltip.id = 'googleSyncTooltip';
  tooltip.className = 'google-sync-tooltip';
  document.body.appendChild(tooltip);
  
  const indicator = safeGetElementById('googleSyncIndicator');
  if (!indicator) return;
  
  const rect = indicator.getBoundingClientRect();
  
  // Build tooltip text (only Google sync status)
  const googleInfo = getGoogleSyncStatusInfo();
  const tooltipText = googleInfo.status 
    ? `Google: ${googleInfo.status}${googleInfo.time ? ' ' + googleInfo.time : ''}`
    : 'Status';
  tooltip.textContent = tooltipText;
  tooltip.style.left = rect.left + rect.width / 2 + 'px';
  tooltip.style.top = rect.bottom + 8 + 'px';
  tooltip.classList.add('visible');
  
  // Update elapsed time in real-time if syncing
  if (googleSyncStatus === 'syncing') {
    if (googleSyncTooltipTimerId) {
      clearInterval(googleSyncTooltipTimerId);
    }
    googleSyncTooltipTimerId = setInterval(() => {
      // Show only Google sync status (with time)
      const googleInfo = getGoogleSyncStatusInfo();
      if (googleInfo.status) {
        const time = googleSyncStatus === 'syncing' && googleSyncStartTime
          ? ((Date.now() - googleSyncStartTime.getTime()) / 1000).toFixed(1) + 's'
          : googleInfo.time;
        tooltip.textContent = `Google: ${googleInfo.status}${time ? ' ' + time : ''}`;
      } else {
        tooltip.textContent = 'Status';
      }
      
      if (googleSyncStatus !== 'syncing' && crudStatus !== 'processing') {
        clearInterval(googleSyncTooltipTimerId);
        googleSyncTooltipTimerId = null;
      }
    }, 100);
  }
}

// Hide Google sync status tooltip
function hideGoogleSyncStatusTooltip() {
  const tooltip = safeGetElementById('googleSyncTooltip');
  if (tooltip) {
    tooltip.classList.remove('visible');
  }
  if (googleSyncTooltipTimerId) {
    clearInterval(googleSyncTooltipTimerId);
    googleSyncTooltipTimerId = null;
  }
}

// Update CRUD operation status indicator (updates unified indicator)
function updateCrudStatusIndicator(status) {
  crudStatus = status;
  
  if (status === 'processing' && !crudStatusStartTime) {
    crudStatusStartTime = new Date();
  } else if (status !== 'processing' && crudStatusStartTime) {
    crudStatusLastDuration = Date.now() - crudStatusStartTime.getTime();
    crudStatusStartTime = null;
  }
  
  // Update unified indicator
  updateUnifiedStatusIndicator();
  
  // Auto-return to idle after showing success/error
  if (status === 'success') {
    setTimeout(() => {
      if (crudStatus === 'success') {
        updateCrudStatusIndicator('idle');
      }
    }, 2000);
  } else if (status === 'error') {
    setTimeout(() => {
      if (crudStatus === 'error') {
        updateCrudStatusIndicator('idle');
      }
    }, 3000);
  }
}

// Get CRUD operation status details
function getCrudStatusInfo() {
  let statusText = '';
  switch (crudStatus) {
    case 'processing':
      statusText = 'Processing';
      break;
    case 'success':
      statusText = 'Complete';
      break;
    case 'error':
      statusText = 'Error';
      break;
    default:
      statusText = '';
  }
  
  let timeText = '';
  if (crudStatus === 'processing' && crudStatusStartTime) {
    const elapsed = Date.now() - crudStatusStartTime.getTime();
    const seconds = (elapsed / 1000).toFixed(1);
    timeText = `${seconds}s`;
  } else if (crudStatusLastDuration !== null) {
    const seconds = (crudStatusLastDuration / 1000).toFixed(1);
    timeText = `${seconds}s`;
  }
  
  return { status: statusText, time: timeText };
}

// Show CRUD operation status tooltip (now uses unified tooltip)
function showCrudStatusTooltip(event) {
  // Use the unified tooltip function
  showGoogleSyncStatusTooltip(event);
}

// Hide CRUD operation status tooltip (now uses unified tooltip)
function hideCrudStatusTooltip() {
  // Use the unified tooltip function
  hideGoogleSyncStatusTooltip();
}

// Check Firebase connection
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

// Update only views affected by a specific event (considering events that span multiple days)
function updateViewsForEvent(event) {
  if (!event || !event.id) return;
  
  const allowedRanges = getAllowedDateRanges();
  if (!isEventInAllowedRange(event, allowedRanges)) {
    // Only handle removal for out-of-range events
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
  
  // Calculate event start and end dates
  let eventStartDate = null;
  let eventEndDate = null;
  
  if (event.startTime) {
    if (isAllDayEvent(event)) {
      // All-day event
      const startDateStr = typeof event.startTime === 'string' ? event.startTime.split('T')[0] : '';
      const endDateStr = event.endTime && typeof event.endTime === 'string' ? event.endTime.split('T')[0] : startDateStr;
      if (startDateStr) {
        eventStartDate = new Date(startDateStr);
        eventEndDate = endDateStr ? new Date(endDateStr) : eventStartDate;
      }
    } else {
      // Timed event
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
  
  // Day view: Check if event is included in the day
  if (currentView === 'day') {
    const currentDay = new Date(currentDate);
    currentDay.setHours(0, 0, 0, 0);
    const currentDayEnd = new Date(currentDay);
    currentDayEnd.setHours(23, 59, 59, 999);
    
    // Check if event period overlaps with current day
    if (eventStartDate <= currentDayEnd && eventEndDate >= currentDay) {
      renderDayView();
    }
  }
  // Week view: Check if event is included in the week
  else if (currentView === 'week') {
    const weekStart = getWeekStart(currentDate);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);
    
    // Check if event period overlaps with current week
    if (eventStartDate <= weekEnd && eventEndDate >= weekStart) {
      renderWeekView();
    }
  }
  // Month view: Check if event is included in the month
  else if (currentView === 'month') {
    const currentMonth = currentDate.getMonth();
    const currentYear = currentDate.getFullYear();
    
    // Get event start and end months
    const eventStartMonth = eventStartDate.getMonth();
    const eventStartYear = eventStartDate.getFullYear();
    const eventEndMonth = eventEndDate.getMonth();
    const eventEndYear = eventEndDate.getFullYear();
    
    // Check if event overlaps with current month
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

  // Reattach resize handlers
  attachResizeHandlers();

  scheduleAllNotifications();
}

// Normalize event
function normalizeEventFromSnapshot(snapshot, key) {
  if (!snapshot || !key) {
    return null;
  }
  const payload = snapshot.val() || {};
  if (typeof payload !== 'object') {
    return null;
  }
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

// Load events function (incremental update version)
async function loadEvents() {
  if (!isFirebaseEnabled || !window.firebase?.db) {
    const message = 'Firebase is disabled. Cannot load events. Please check your settings.';
    showMessage(message, 'error', 6000);
    return;
  }
  
  const allowedRanges = getAllowedDateRanges();
  
  // Unsubscribe existing listeners
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
  
  // Initial: Get all events
  try {
    const snapshot = await window.firebase.get(eventsRef);
    const data = snapshot.val();
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const newEvents = Object.keys(data).map(key => {
        const payload = data[key] || {};
        return normalizeEventFromSnapshot({ val: () => payload }, key);
      }).filter(ev => ev !== null && ev !== undefined);
      // Skip range check for timetable events (Combi data) to ensure they are included
      const filteredEvents = newEvents.filter(ev => 
        ev.isTimetable === true || isEventInAllowedRange(ev, allowedRanges)
      );
      events = filteredEvents;
      events.sort((a, b) => {
        const aTime = a.startTime ? new Date(a.startTime).getTime() : Infinity;
        const bTime = b.startTime ? new Date(b.startTime).getTime() : Infinity;
        if (Number.isNaN(aTime)) return 1;
        if (Number.isNaN(bTime)) return -1;
        return aTime - bTime;
      });
      
      // Check for duplicates in Firebase
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
    showMessage('Failed to load events. Please check your network.', 'error', 6000);
    return;
  }
  
  // Afterward: Incremental updates via child events
  unsubscribeChildAdded = window.firebase.onChildAdded(eventsRef, (snapshot) => {
    try {
    const key = snapshot.key;
    if (!key) return;
    
    if (!Array.isArray(events)) {
      events = [];
    }
    
    const newEvent = normalizeEventFromSnapshot(snapshot, key);
    if (!newEvent || !newEvent.id) return;
    
    // Skip range check for timetable events (Combi data)
    const isTimetableEvent = newEvent.isTimetable === true;
    if (!isTimetableEvent && !isEventInAllowedRange(newEvent, allowedRanges)) return;
    
    // Check for existing event
    const existingIndex = events.findIndex(e => e && e.id === key);
    if (existingIndex === -1) {
      events.push(newEvent);
      events.sort((a, b) => {
        if (!a || !b) return 0;
        const aTime = a.startTime ? new Date(a.startTime).getTime() : Infinity;
        const bTime = b.startTime ? new Date(b.startTime).getTime() : Infinity;
        if (Number.isNaN(aTime)) return 1;
        if (Number.isNaN(bTime)) return -1;
        return aTime - bTime;
      });
      // Skip re-rendering during Google sync (batch update after sync completes)
      // However, always reflect updates for timetable events (Combi data)
      if (!isGoogleSyncing || isTimetableEvent) {
        updateViewsForEvent(newEvent);
      }
      }
    } catch (error) {
      // Don't stop the app even if an error occurs
    }
  }, (error) => {
    showMessage('Failed to add event.', 'error', 4000);
  });
  
  unsubscribeChildChanged = window.firebase.onChildChanged(eventsRef, (snapshot) => {
    try {
    const key = snapshot.key;
    if (!key) return;
    
    if (!Array.isArray(events)) {
      events = [];
    }
    
    const updatedEvent = normalizeEventFromSnapshot(snapshot, key);
    if (!updatedEvent || !updatedEvent.id) return;
    
    const existingIndex = events.findIndex(e => e && e.id === key);
    
    if (existingIndex !== -1) {
      const oldEvent = events[existingIndex];
      if (!oldEvent) return;
      
      // Detect updates from external apps (Combi or Google)
      const isExternalUpdate = updatedEvent.externalUpdatedAt && 
        updatedEvent.externalUpdatedAt !== oldEvent.externalUpdatedAt;
      const isTimetableEvent = updatedEvent.isTimetable === true;
      
      // Skip if updatedAt hasn't changed (prevent infinite loop)
      // However, always update for external app updates (externalUpdatedAt changed) or timetable events
      if (!isExternalUpdate && !isTimetableEvent && 
          oldEvent.updatedAt === updatedEvent.updatedAt && 
          oldEvent.lastWriteClientId === updatedEvent.lastWriteClientId) {
        return;
      }
      
      events[existingIndex] = updatedEvent;
      events.sort((a, b) => {
        if (!a || !b) return 0;
        const aTime = a.startTime ? new Date(a.startTime).getTime() : Infinity;
        const bTime = b.startTime ? new Date(b.startTime).getTime() : Infinity;
        if (Number.isNaN(aTime)) return 1;
        if (Number.isNaN(bTime)) return -1;
        return aTime - bTime;
      });
      
      const wasInRange = isEventInAllowedRange(oldEvent, allowedRanges);
      const isInRange = isEventInAllowedRange(updatedEvent, allowedRanges);
      
      // Skip re-rendering during Google sync (batch update after sync completes)
      // However, always reflect updates for timetable events (Combi data)
      if (isGoogleSyncing && !isTimetableEvent) {
        return;
      }
      // Update if: out-of-range→in-range, in-range→out-of-range, or date change within range
      // For timetable events, update even if out-of-range (to ensure Combi data is reflected)
      if (wasInRange || isInRange || isTimetableEvent) {
        updateViewsForEvent(updatedEvent);
        if (wasInRange && !isInRange && !isTimetableEvent) {
          // If moved out of range, also update old date
          updateViewsForEvent(oldEvent);
        }
      }
      }
    } catch (error) {
      // Don't stop the app even if an error occurs
    }
  }, (error) => {
    showMessage('Failed to update event.', 'error', 4000);
  });
  
  unsubscribeChildRemoved = window.firebase.onChildRemoved(eventsRef, (snapshot) => {
    try {
    const key = snapshot.key;
    if (!key) return;
    
    if (!Array.isArray(events)) {
      events = [];
      return;
    }
    
    const existingIndex = events.findIndex(e => e && e.id === key);
    if (existingIndex !== -1) {
      const removedEvent = events[existingIndex];
      if (removedEvent) {
        const isTimetableEvent = removedEvent.isTimetable === true;
        events.splice(existingIndex, 1);
        // Skip redraw during Google sync (batch update after sync completes)
        // However, always reflect updates for timetable events (Combi data)
        if (!isGoogleSyncing || isTimetableEvent) {
          updateViewsForEvent(removedEvent);
        }
      }
      }
    } catch (error) {
      // Don't stop the app even if an error occurs
    }
  }, (error) => {
    showMessage('Failed to delete event.', 'error', 4000);
  });
  
  // Unified unsubscribe function
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
    const message = 'Google Apps Script web app URL is not configured.';
    showMessage(message, 'error', 6000);
    throw new Error(message);
  }

  const filteredUpserts = Array.isArray(upserts)
    ? upserts.filter(ev => ev && ev.id && ev.isTimetable !== true)
    : [];
  // Deletes accept either ID or event object. Include googleEventId when present so code.js can delete by Google ID (e.g. fetched-only events).
  const filteredDeletes = Array.isArray(deletes)
    ? deletes
        .filter(item => {
          if (typeof item === 'string') return item.trim().length > 0;
          if (item && typeof item === 'object' && item.id) return true;
          return false;
        })
        .map(item => {
          if (typeof item === 'string') {
            return item;
          }
          const out = {
            id: item.id,
            title: item.title || '',
            startTime: item.startTime || null,
            endTime: item.endTime || null,
            allDay: item.allDay === true,
          };
          if (item.googleEventId && typeof item.googleEventId === 'string') {
            out.googleEventId = item.googleEventId.trim();
          }
          return out;
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
    showMessage('Failed to update Google Calendar. Please check your network.', 'error', 6000);
    throw error;
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    const message = `Failed to update Google Calendar (${response.status}) ${errorText || ''}`.trim();
    showMessage(message, 'error', 6000);
    throw new Error(message);
  }

  let result;
  try {
    result = await response.json();
  } catch (error) {
    const message = 'Failed to parse Google Calendar response.';
    showMessage(message, 'error', 6000);
    throw error;
  }

  if (result?.success === false) {
    const message = result?.message || 'Failed to update Google Calendar.';
    showMessage(message, 'error', 6000);
    throw new Error(message);
  }

  if (!silent) {
    showMessage('Google Calendar updated.', 'success', 4000);
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
    const message = 'Google Apps Script web app URL is not configured.';
    if (!silent) showMessage(message, 'error', 6000);
    throw new Error(message);
  }

  const rangeSet = getAllowedDateRanges();

  if (!isFirebaseEnabled) {
    const message = 'Please try again after Firebase sync is complete.';
    if (!silent) showMessage(message, 'error', 6000);
    throw new Error(message);
  }
  
  // Set Google sync in progress flag (prevents re-rendering)
  isGoogleSyncing = true;
  updateGoogleSyncIndicator('syncing');
  
  // Safety mechanism: Automatically reset flag after 30 seconds (prevent freeze)
  const syncTimeout = setTimeout(() => {
    if (isGoogleSyncing) {
      isGoogleSyncing = false;
      updateGoogleSyncIndicator('error');
      updateViews({ useLoadingOverlay: false });
    }
  }, 30000);
  
  if (!silent) {
    showLoading('Syncing with Google Calendar...');
  }

  if (!Array.isArray(events) || events.length === 0) {
    // No local events to sync — treat as a successful no-op and reset state
    clearTimeout(syncTimeout);
    isGoogleSyncing = false;
    updateGoogleSyncIndicator('synced');
    if (!silent) {
      hideLoading();
      showMessage('No events to sync.', 'info', 4000);
    } else {
      hideLoading();
    }
    // Ensure views are refreshed once to clear any loading state
    setTimeout(() => {
      updateViews({ useLoadingOverlay: false });
    }, 100);
    return { created: 0, updated: 0, skipped: 0 };
  }

  if (!Array.isArray(events)) {
    // Event data not available — reset state and report error
    clearTimeout(syncTimeout);
    isGoogleSyncing = false;
    updateGoogleSyncIndicator('error');
    if (!silent) {
      hideLoading();
      showMessage('Event data is not loaded.', 'error', 6000);
    } else {
      hideLoading();
    }
    setTimeout(() => {
      updateViews({ useLoadingOverlay: false });
    }, 100);
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
    // No local events to sync — treat as successful and reset state
    clearTimeout(syncTimeout);
    isGoogleSyncing = false;
    updateGoogleSyncIndicator('synced');
    if (!silent) {
      hideLoading();
      showMessage('No local events to sync with Google.', 'info', 4000);
    } else {
      hideLoading();
    }
    setTimeout(() => {
      updateViews({ useLoadingOverlay: false });
    }, 100);
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
    clearTimeout(syncTimeout);
    isGoogleSyncing = false;
    updateGoogleSyncIndicator('error');
    if (!silent) {
      hideLoading();
      showMessage('Failed to sync with Google Calendar. Please check your network.', 'error', 6000);
    }
      // Update UI even if error occurs (prevent freeze)
    setTimeout(() => {
      updateViews({ useLoadingOverlay: false });
    }, 100);
    throw error;
  }

  if (!response.ok) {
    clearTimeout(syncTimeout);
    isGoogleSyncing = false;
    updateGoogleSyncIndicator('error');
    const errorText = await response.text().catch(() => '');
    const message = `Failed to call Google Apps Script (${response.status}) ${errorText || ''}`.trim();
    if (!silent) {
      hideLoading();
      showMessage(message, 'error', 6000);
    }
      // Update UI even if error occurs (prevent freeze)
    setTimeout(() => {
      updateViews({ useLoadingOverlay: false });
    }, 100);
    throw new Error(message);
  }

  let result = null;
  try {
    result = await response.json();
  } catch (error) {
    clearTimeout(syncTimeout);
    isGoogleSyncing = false;
    updateGoogleSyncIndicator('error');
    // Treat as success if response is not JSON
    if (!silent) {
      hideLoading();
      showMessage('Synced with Google Calendar.', 'success', 5000);
    } else {
      hideLoading();
    }
    // After sync completes, reset flag with slight delay and update view once
    setTimeout(() => {
      updateViews({ useLoadingOverlay: false });
    }, 1000);
    return { created: 0, updated: 0, skipped: 0 };
  }

  try {
    const created = Number(result?.created) || 0;
    const updated = Number(result?.updated) || 0;
    const skipped = Number(result?.skipped) || 0;
    const message =
      typeof result?.message === 'string' && result.message.trim().length > 0
        ? result.message.trim()
        : 'Synced with Google Calendar.';

    // Clear timeout
    clearTimeout(syncTimeout);
    
    // After sync completes, reset flag with slight delay and update view once
    setTimeout(() => {
      isGoogleSyncing = false;
      // If error message is included, it's an error; otherwise success
      if (message.includes('Error') || message.includes('Failed')) {
        updateGoogleSyncIndicator('error');
      } else {
        updateGoogleSyncIndicator('synced');
      }
      // Update view once since changes may have occurred during sync
      updateViews({ useLoadingOverlay: false });
    }, 1000);

    if (!silent) {
      hideLoading();
      showMessage(`${message} (Created:${created} / Updated:${updated} / Skipped:${skipped})`, 'success', 6000);
    } else {
      // Always hide loading, even in silent mode
      hideLoading();
    }
    
    return { created, updated, skipped };
  } catch (error) {
    // Always reset flag even if error occurs
    clearTimeout(syncTimeout);
    isGoogleSyncing = false;
    if (!silent) {
      hideLoading();
    }
      // Update UI even if error occurs (prevent freeze)
    setTimeout(() => {
      updateViews({ useLoadingOverlay: false });
    }, 100);
    throw error;
  }
}

async function fetchGoogleCalendarEvents({ silent = false } = {}) {
  if (!GOOGLE_APPS_SCRIPT_ENDPOINT) {
    const message = 'Google Apps Script web app URL is not configured.';
    if (!silent) showMessage(message, 'error', 6000);
    throw new Error(message);
  }

  const rangeSet = getAllowedDateRanges();
  
  if (!silent) {
    showLoading('Fetching from Google Calendar...');
  }

  // Set Google sync in progress flag (prevents re-rendering)
  isGoogleSyncing = true;
  updateGoogleSyncIndicator('syncing');
  
  // Safety mechanism: Automatically reset flag after 30 seconds (prevent freeze)
  const syncTimeout = setTimeout(() => {
    if (isGoogleSyncing) {
      isGoogleSyncing = false;
      updateGoogleSyncIndicator('error');
      updateViews({ useLoadingOverlay: false });
    }
  }, 30000);

  let response;
  try {
    const url = `${GOOGLE_APPS_SCRIPT_ENDPOINT}?action=events`;
    response = await fetch(url, { method: 'GET', mode: 'cors' });
  } catch (error) {
    clearTimeout(syncTimeout);
    isGoogleSyncing = false;
    updateGoogleSyncIndicator('error');
    if (!silent) {
      hideLoading();
      showMessage('Failed to fetch from Google Calendar. Please check your network.', 'error', 6000);
    }
    throw error;
  }

  if (!response.ok) {
    clearTimeout(syncTimeout);
    isGoogleSyncing = false;
    updateGoogleSyncIndicator('error');
    const errorText = await response.text().catch(() => '');
    const message = `Failed to fetch from Google Calendar (${response.status}) ${errorText || ''}`.trim();
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
    clearTimeout(syncTimeout);
    isGoogleSyncing = false;
    updateGoogleSyncIndicator('error');
    const message = 'Google Calendar response is invalid.';
    if (!silent) {
      hideLoading();
      showMessage(message, 'error', 6000);
    }
    throw error;
  }

  try {
    const googleEvents = Array.isArray(result?.events) ? result.events : [];
    const { created, updated, deleted } = await mergeGoogleEvents(googleEvents, rangeSet);
    
    // Clear timeout
    clearTimeout(syncTimeout);
    
    // Reset flag immediately (syncEventsToGoogleCalendar will set it again if needed)
    isGoogleSyncing = false;
    
    if (!silent) {
      hideLoading();
      showMessage(
        `Fetched from Google Calendar: ${googleEvents.length} events (New:${created} / Updated:${updated} / Duplicates removed:${deleted})`,
        'success',
        6000
      );
    } else {
      // Always hide loading, even in silent mode
      hideLoading();
    }
    
    // Update view once since changes may have occurred during sync
    setTimeout(() => {
      updateViews({ useLoadingOverlay: false });
    }, 100);
    
    return { created, updated, deleted: deleted || 0, total: googleEvents.length };
  } catch (error) {
    // Always reset flag even if error occurs
    clearTimeout(syncTimeout);
    isGoogleSyncing = false;
    updateGoogleSyncIndicator('error');
    if (!silent) {
      hideLoading();
      showMessage('Failed to merge Google Calendar events.', 'error', 6000);
    } else {
      hideLoading();
    }
    // Update UI even if error occurs (prevent freeze)
    setTimeout(() => {
      updateViews({ useLoadingOverlay: false });
    }, 100);
    throw error;
  }
}

async function clearGoogleCalendarEvents({ silent = false } = {}) {
  if (!GOOGLE_APPS_SCRIPT_ENDPOINT) {
    const message = 'Google Apps Script web app URL is not configured.';
    if (!silent) showMessage(message, 'error', 6000);
    throw new Error(message);
  }

  const url = `${GOOGLE_APPS_SCRIPT_ENDPOINT}?action=clear&_=${Date.now()}`;
  let response;
  try {
    response = await fetch(url, { method: 'GET', mode: 'cors' });
  } catch (error) {
    if (!silent) showMessage('Failed to delete from Google Calendar. Please check your network.', 'error', 6000);
    throw error;
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    const message = `Failed to delete events from Google Calendar (${response.status}) ${errorText || ''}`.trim();
    if (!silent) showMessage(message, 'error', 6000);
    throw new Error(message);
  }

  const result = await response.json().catch(() => null);
  if (!result) {
    if (!silent) showMessage('Deleted events from Google Calendar.', 'success', 6000);
    return { deleted: 0 };
  }

  if (!silent) {
    showMessage(
      `Deleted ${result.deleted || 0} events from Google Calendar (schedule_mgr)`,
      'success',
      6000
    );
  } else {
  }
  return { deleted: Number(result.deleted) || 0 };
}

// Normalize for title comparison
function normalizeTitleForComparison(title) {
  if (!title && title !== 0) return '';
  return String(title)
    .trim()
    .replace(/\s+/g, '') // Remove all whitespace
    .toLowerCase();
}

function buildDateTitleKey(startTime, title) {
  if (!startTime) return null;
  const dateKey = formatDateOnly(startTime);
  if (!dateKey) return null;
  const titleKey = normalizeTitleForComparison(title || '');
  return `${dateKey}__${titleKey}`;
}

// Build a comprehensive key that includes more event properties to prevent false duplicates
function buildEventKey(event) {
  if (!event || !event.startTime) return null;
  const dateKey = formatDateOnly(event.startTime);
  if (!dateKey) return null;
  const titleKey = normalizeTitleForComparison(event.title || '');
  const startTimeKey = event.startTime ? new Date(event.startTime).toISOString() : '';
  const endTimeKey = event.endTime ? new Date(event.endTime).toISOString() : '';
  const descriptionKey = event.description ? normalizeTitleForComparison(event.description) : '';
  const allDayKey = event.allDay ? '1' : '0';
  // Include startTime, endTime, description, and allDay status in the key
  return `${dateKey}__${titleKey}__${startTimeKey}__${endTimeKey}__${descriptionKey}__${allDayKey}`;
}

// Check for duplicates in all Firebase events (prioritize Google-originated)
async function deduplicateFirebaseEvents() {
  if (!Array.isArray(events) || events.length === 0) {
    return { deleted: 0 };
  }

  const rangeSet = getAllowedDateRanges();
  let deleted = 0;

  // Group all events by comprehensive key (date + title + startTime + endTime + description + allDay)
  const eventsByKey = new Map();
  for (const ev of events) {
    if (!ev?.startTime) continue;
    if (ev.isTimetable === true) continue;
    if (!isEventInAllowedRange(ev, rangeSet)) continue;

    const key = buildEventKey(ev);
    if (!key) continue;
    if (!eventsByKey.has(key)) {
      eventsByKey.set(key, []);
    }
    eventsByKey.get(key).push(ev);
  }

  // Check for duplicates in each group
  for (const [key, duplicates] of eventsByKey.entries()) {
    if (duplicates.length <= 1) continue; // No duplicates

    // Prioritize Google-originated events
    const googleEvents = duplicates.filter(
      ev => ev.source === 'google' || ev.isGoogleImported === true
    );
    const localEvents = duplicates.filter(
      ev => ev.source !== 'google' && ev.isGoogleImported !== true
    );

    // If there is one or more Google-originated events, delete local ones
    if (googleEvents.length > 0) {
      const dateLabel = formatDateOnly(duplicates[0].startTime) || '';

      // If there are multiple Google-originated events, keep only one (the latest)
      if (googleEvents.length > 1) {
        googleEvents.sort((a, b) => {
          const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
          const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
          return bTime - aTime; // Newest first
        });
        // Delete Google-originated events except the latest
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

      // Delete all local events
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
      // If there are no Google-originated events, keep only one local duplicate (the latest)
      if (localEvents.length > 1) {
        localEvents.sort((a, b) => {
          const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
          const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
          return bTime - aTime; // Newest first
        });
        const dateLabel = formatDateOnly(localEvents[0].startTime) || '';
        // Delete all except the latest
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

  const eventsById = new Map(events.filter(ev => ev && ev.id).map(ev => [ev.id, ev]));
  const eventsByGoogleId = new Map(
    events
      .filter(ev => ev && ev.googleEventId)
      .map(ev => [ev.googleEventId, ev])
  );

  const rangeSet = ranges || getAllowedDateRanges();

  // Group all events by comprehensive key (date + title + startTime + endTime + description + allDay)
  const eventsByKey = new Map();
  const registerEventByKey = (ev) => {
    if (!ev?.startTime) return;
    if (ev.isTimetable === true) return;
    if (!isEventInAllowedRange(ev, rangeSet)) return;
    const key = buildEventKey(ev);
    if (!key) return;
    if (!eventsByKey.has(key)) {
      eventsByKey.set(key, []);
    }
    eventsByKey.get(key).push({
      id: ev.id,
      title: ev.title || '',
      startTime: ev.startTime,
      endTime: ev.endTime,
      description: ev.description || '',
      allDay: ev.allDay || false,
      source: ev.source || '',
      isGoogleImported: ev.isGoogleImported === true,
      googleEventId: ev.googleEventId || null,
    });
  };
  events.forEach(registerEventByKey);

  const updateKeyEntry = (key, eventLike) => {
    if (!key) return;
    if (!eventLike) {
      eventsByKey.delete(key);
      return;
    }
    eventsByKey.set(key, [eventLike]);
  };

  for (const googleEvent of googleEvents) {
    const normalized = normalizeGoogleEvent(googleEvent, rangeSet);
    if (normalized.filteredOut) continue;
    if (!normalized.startTime || !normalized.endTime) continue;

    const key = buildEventKey(normalized);
    const dateLabel = formatDateOnly(normalized.startTime) || normalized.startTime || '';
    const linkedId =
      googleEvent.scheduleMgrId && eventsById.has(googleEvent.scheduleMgrId)
        ? googleEvent.scheduleMgrId
        : null;

    if (key) {
      const duplicates = eventsByKey.get(key) || [];
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
          eventsByKey.set(key, survivors);
        } else {
          eventsByKey.delete(key);
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

  // Check for duplicates in all Firebase events
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
  let startTime, endTime;

  // For all-day events, Google uses exclusive end dates (e.g., Jan 2 00:00 means "ends at start of Jan 2", i.e., Jan 1 inclusive)
  // We need to convert this to our app's inclusive end date format (e.g., Jan 1 23:59)
  if (googleEvent.allDay) {
    startTime = normalizeEventDateTimeString(googleEvent.startDateTime);
    const normalizedEnd = normalizeEventDateTimeString(googleEvent.endDateTime);
    
    if (normalizedEnd) {
      // Extract date part and subtract 1 day to convert exclusive end to inclusive end
      const endDatePart = normalizedEnd.split('T')[0];
      if (endDatePart) {
        const endDate = new Date(endDatePart + 'T00:00:00');
        endDate.setDate(endDate.getDate() - 1); // Subtract 1 day
        const year = endDate.getFullYear();
        const month = String(endDate.getMonth() + 1).padStart(2, '0');
        const day = String(endDate.getDate()).padStart(2, '0');
        endTime = `${year}-${month}-${day}T23:59`;
      } else {
        endTime = normalizedEnd;
      }
    } else {
      endTime = '';
    }
  } else {
    // Timed events: use normal conversion
    startTime = normalizeEventDateTimeString(googleEvent.startDateTime);
    endTime = normalizeEventDateTimeString(googleEvent.endDateTime);
  }

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

// Add event
async function addEvent(event, options = {}) {
  const { syncGoogle = true } = options;

  const normalizedStart = normalizeEventDateTimeString(event.startTime);
  const normalizedEnd = normalizeEventDateTimeString(event.endTime);

  const baseEvent = {
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
    lastWriteClientId: clientId,
  };

  // When Firebase is disabled, operate purely on local state
  if (!isFirebaseEnabled || !window.firebase?.db) {
    if (!Array.isArray(events)) {
      events = [];
    }
    const id = generateId();
    const newEvent = { ...baseEvent, id };
    events.push(newEvent);
    updateViews();
    scheduleAllNotifications();
    return id;
  }

  // Normal path: write to Firebase and rely on realtime listeners to update `events`
  try {
    const eventsRef = window.firebase.ref(window.firebase.db, 'events');
    const newEventRef = window.firebase.push(eventsRef);
    const { id: _omitId, ...payload } = baseEvent;
    await window.firebase.set(newEventRef, payload);
    const newId = newEventRef.key;

    if (syncGoogle && newId && baseEvent.isTimetable !== true) {
      try {
        // Update Google sync indicator to show syncing
        updateGoogleSyncIndicator('syncing');
        await mirrorMutationsToGoogle({
          upserts: [{ ...baseEvent, id: newId }],
          silent: true,
        });
        // Update Google sync indicator to show synced
        updateGoogleSyncIndicator('synced');
      } catch (error) {
        // If Google sync fails, mark as error
        updateGoogleSyncIndicator('error');
      }
    }

    return newId;
  } catch (error) {
    showMessage('Could not save event. Please check your network and Firebase settings.', 'error', 6000);
    return null;
  }
}

// Update event
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
    lastWriteClientId: clientId,
  };

  // Local-only update when Firebase is disabled
  if (!isFirebaseEnabled || !window.firebase?.db) {
    if (!Array.isArray(events)) {
      events = [];
    }
    const idx = events.findIndex(e => e.id === id);
    if (idx === -1) return false;
    events[idx] = { ...events[idx], ...updatedEvent };
    updateViews();
    scheduleAllNotifications();
    return true;
  }

  // Normal path: update Firebase; local state comes from realtime listener
  const eventRef = window.firebase.ref(window.firebase.db, `events/${id}`);
  try {
    await window.firebase.update(eventRef, updatedEvent);
  } catch (error) {
    showMessage('Failed to update event. Please check your network connection.', 'error', 6000);
    return false;
  }

  if (syncGoogle && updatedEvent.isTimetable !== true) {
    try {
      // Update Google sync indicator to show syncing
      updateGoogleSyncIndicator('syncing');
      await mirrorMutationsToGoogle({
        upserts: [{ ...updatedEvent, id }],
        silent: true,
      });
      // Update Google sync indicator to show synced
      updateGoogleSyncIndicator('synced');
    } catch (error) {
      // If Google sync fails, mark as error
      updateGoogleSyncIndicator('error');
    }
  }

  return true;
}

// Delete event
async function deleteEvent(id, options = {}) {
  const { syncGoogle = true } = options;

  // Local-only delete when Firebase is disabled
  if (!isFirebaseEnabled || !window.firebase?.db) {
    if (!Array.isArray(events)) {
      events = [];
    }
    const idx = events.findIndex(e => e.id === id);
    if (idx === -1) return false;
    const [removed] = events.splice(idx, 1);
    updateViews();
    scheduleAllNotifications();
    return true;
  }

  const existingEvent = Array.isArray(events) ? events.find(e => e.id === id) : null;
  const eventRef = window.firebase.ref(window.firebase.db, `events/${id}`);

  try {
    await window.firebase.remove(eventRef);
  } catch (error) {
    showMessage('Failed to delete event. Please try again.', 'error', 6000);
    return false;
  }

  if (syncGoogle && existingEvent?.isTimetable !== true) {
    try {
      // Update Google sync indicator to show syncing
      updateGoogleSyncIndicator('syncing');
      await mirrorMutationsToGoogle({
        deletes: existingEvent ? [existingEvent] : [id],
        silent: true,
      });
      // Update Google sync indicator to show synced
      updateGoogleSyncIndicator('synced');
    } catch (error) {
      // If Google sync fails, mark as error
      updateGoogleSyncIndicator('error');
    }
  }

  return true;
}

// Find all events in a recurring series
function findRecurringSeriesEvents(recurringSeriesId) {
  if (!recurringSeriesId || !Array.isArray(events)) {
    return [];
  }
  return events.filter(ev => ev && ev.recurringSeriesId === recurringSeriesId);
}

// Find this event and all subsequent events in a recurring series
function findThisAndSubsequentEvents(eventId, recurringSeriesId) {
  if (!eventId || !recurringSeriesId || !Array.isArray(events)) {
    return [];
  }
  
  const currentEvent = events.find(ev => ev && ev.id === eventId);
  if (!currentEvent || !currentEvent.startTime) {
    return [];
  }
  
  const currentStartTime = new Date(currentEvent.startTime);
  if (Number.isNaN(currentStartTime.getTime())) {
    return [];
  }
  
  const seriesEvents = findRecurringSeriesEvents(recurringSeriesId);
  
  // Return current event and all events that start on or after the current event's start time
  return seriesEvents.filter(ev => {
    if (!ev || !ev.startTime) return false;
    const evStartTime = new Date(ev.startTime);
    if (Number.isNaN(evStartTime.getTime())) return false;
    return evStartTime >= currentStartTime;
  }).sort((a, b) => {
    const aTime = new Date(a.startTime).getTime();
    const bTime = new Date(b.startTime).getTime();
    return aTime - bTime;
  });
}

// Bulk update this event and all subsequent events in a recurring series
async function updateThisAndSubsequentEvents(eventId, recurringSeriesId, eventUpdates, options = {}) {
  const { syncGoogle = true } = options;
  
  const targetEvents = findThisAndSubsequentEvents(eventId, recurringSeriesId);
  if (targetEvents.length === 0) {
    return { updated: 0 };
  }
  
  let updatedCount = 0;
  const errors = [];
  
  for (const event of targetEvents) {
    try {
      const success = await updateEvent(event.id, eventUpdates, { syncGoogle: false });
      if (success) {
        updatedCount++;
      } else {
        errors.push(event.id);
      }
    } catch (error) {
      errors.push(event.id);
    }
  }
  
  // Sync all updates to Google at once
  if (syncGoogle && updatedCount > 0) {
    try {
      updateGoogleSyncIndicator('syncing');
      const updatedEvents = targetEvents
        .filter(ev => !errors.includes(ev.id))
        .map(ev => ({
          ...ev,
          ...eventUpdates,
          id: ev.id,
        }));
      
      await mirrorMutationsToGoogle({
        upserts: updatedEvents,
        silent: true,
      });
      updateGoogleSyncIndicator('synced');
    } catch (error) {
      updateGoogleSyncIndicator('error');
    }
  }
  
  return { updated: updatedCount, errors };
}

// Bulk delete this event and all subsequent events in a recurring series
async function deleteThisAndSubsequentEvents(eventId, recurringSeriesId, options = {}) {
  const { syncGoogle = true } = options;
  
  const targetEvents = findThisAndSubsequentEvents(eventId, recurringSeriesId);
  if (targetEvents.length === 0) {
    return { deleted: 0 };
  }
  
  let deletedCount = 0;
  const errors = [];
  
  for (const event of targetEvents) {
    try {
      const success = await deleteEvent(event.id, { syncGoogle: false });
      if (success) {
        deletedCount++;
      } else {
        errors.push(event.id);
      }
    } catch (error) {
      errors.push(event.id);
    }
  }
  
  // Sync all deletes to Google at once
  if (syncGoogle && deletedCount > 0) {
    try {
      updateGoogleSyncIndicator('syncing');
      const deletedEvents = targetEvents.filter(ev => !errors.includes(ev.id));
      await mirrorMutationsToGoogle({
        deletes: deletedEvents,
        silent: true,
      });
      updateGoogleSyncIndicator('synced');
    } catch (error) {
      updateGoogleSyncIndicator('error');
    }
  }
  
  return { deleted: deletedCount, errors };
}

// Bulk update all events in a recurring series
async function updateRecurringSeries(recurringSeriesId, eventUpdates, options = {}) {
  const { syncGoogle = true } = options;
  
  const seriesEvents = findRecurringSeriesEvents(recurringSeriesId);
  if (seriesEvents.length === 0) {
    return { updated: 0 };
  }
  
  let updatedCount = 0;
  const errors = [];
  
  for (const event of seriesEvents) {
    try {
      const success = await updateEvent(event.id, eventUpdates, { syncGoogle: false });
      if (success) {
        updatedCount++;
      } else {
        errors.push(event.id);
      }
    } catch (error) {
      errors.push(event.id);
    }
  }
  
  // Sync all updates to Google at once
  if (syncGoogle && updatedCount > 0) {
    try {
      updateGoogleSyncIndicator('syncing');
      const updatedEvents = seriesEvents
        .filter(ev => !errors.includes(ev.id))
        .map(ev => ({
          ...ev,
          ...eventUpdates,
          id: ev.id,
        }));
      
      await mirrorMutationsToGoogle({
        upserts: updatedEvents,
        silent: true,
      });
      updateGoogleSyncIndicator('synced');
    } catch (error) {
      updateGoogleSyncIndicator('error');
    }
  }
  
  return { updated: updatedCount, errors };
}

// Bulk delete all events in a recurring series
async function deleteRecurringSeries(recurringSeriesId, options = {}) {
  const { syncGoogle = true } = options;
  
  const seriesEvents = findRecurringSeriesEvents(recurringSeriesId);
  if (seriesEvents.length === 0) {
    return { deleted: 0 };
  }
  
  let deletedCount = 0;
  const errors = [];
  
  for (const event of seriesEvents) {
    try {
      const success = await deleteEvent(event.id, { syncGoogle: false });
      if (success) {
        deletedCount++;
      } else {
        errors.push(event.id);
      }
    } catch (error) {
      errors.push(event.id);
    }
  }
  
  // Sync all deletes to Google at once
  if (syncGoogle && deletedCount > 0) {
    try {
      updateGoogleSyncIndicator('syncing');
      const deletedEvents = seriesEvents.filter(ev => !errors.includes(ev.id));
      await mirrorMutationsToGoogle({
        deletes: deletedEvents,
        silent: true,
      });
      updateGoogleSyncIndicator('synced');
    } catch (error) {
      updateGoogleSyncIndicator('error');
    }
  }
  
  return { deleted: deletedCount, errors };
}

async function clearAllEvents({ skipConfirm = false, silent = false } = {}) {
  if (!skipConfirm) {
    const confirmed = await showConfirmModal('Delete all events and timetable data. Are you sure?', 'Confirm Deletion');
    if (!confirmed) return false;
  }

  const deletableEvents = Array.isArray(events)
    ? events.filter(ev => ev?.id && ev.isTimetable !== true)
    : [];

  try {
    if (!silent) {
      updateCrudStatusIndicator('processing');
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
        // Update Google sync indicator to show syncing
        updateGoogleSyncIndicator('syncing');
        // Also send event information (date and title) on delete so matching is possible even if ID doesn't match
        await mirrorMutationsToGoogle({ deletes: deletableEvents, silent: true });
        // Update Google sync indicator to show synced
        updateGoogleSyncIndicator('synced');
      } catch (error) {
        // If Google sync fails, mark as error
        updateGoogleSyncIndicator('error');
      }
    }

    if (!silent) {
      updateCrudStatusIndicator('success');
      showMessage('All events deleted.', 'success');
    }
    return true;
  } catch (error) {
    if (!silent) {
      updateCrudStatusIndicator('error');
      showMessage('Failed to delete event. Please try again.', 'error', 6000);
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
    // If already running, stop and restart
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
      // Ignore errors
    } finally {
      googleSyncInFlight = false;
    }
  };

  // Execute initial sync immediately
  syncTask('initial-delay');
  // Set up periodic sync
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

// Get events for specific day (including events that span days)
function getEventsByDate(date) {
  if (!date) return [];
  const dateObj = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(dateObj.getTime())) return [];
  
  const dateStr = formatDate(dateObj, 'YYYY-MM-DD');
  if (!dateStr) return [];
  
  const targetDate = new Date(dateObj);
  targetDate.setHours(0, 0, 0, 0);
  const targetDateEnd = new Date(targetDate);
  targetDateEnd.setHours(23, 59, 59, 999);
  
  const list = [];
  if (!Array.isArray(events)) return list;
  
  events.forEach(ev => {
    if (!ev || !ev.id) return;
    if (!ev.startTime) return;
    
    // All-day event
    if (isAllDayEvent(ev)) {
      if (typeof ev.startTime !== 'string') return;
      const eventStartDate = ev.startTime.split('T')[0];
      const eventEndDate = ev.endTime && typeof ev.endTime === 'string' ? ev.endTime.split('T')[0] : eventStartDate;
      // Check if specified date is between event start and end date (inclusive)
      if (dateStr >= eventStartDate && dateStr <= eventEndDate) {
        list.push(ev);
      }
      return;
    }
    
    // Timed event
    const eventStart = new Date(ev.startTime);
    const eventEnd = ev.endTime ? new Date(ev.endTime) : new Date(eventStart);
    
    if (Number.isNaN(eventStart.getTime()) || Number.isNaN(eventEnd.getTime())) return;
    
    // Check if period from 00:00 to 23:59:59 of specified date overlaps with event period
    // Event starts on previous day and ends on specified day, or
    // Event starts on specified day and ends on next day, or
    // Event period is completely contained within specified day
    if (eventStart <= targetDateEnd && eventEnd >= targetDate) {
      list.push(ev);
    }
  });
  return list;
}

// Get events for specific week (including events that span weeks)
function getEventsByWeek(startDate) {
  if (!startDate) return [];
  const startDateObj = startDate instanceof Date ? startDate : new Date(startDate);
  if (Number.isNaN(startDateObj.getTime())) return [];
  
  const weekStart = new Date(startDateObj);
  weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(startDateObj);
  weekEnd.setDate(weekEnd.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);
  
  if (!Array.isArray(events)) return [];
  
  return events.filter(event => {
    if (!event || !event.startTime) return false;
    
    // All-day event
    if (isAllDayEvent(event)) {
      if (typeof event.startTime !== 'string') return false;
      const eventStartDate = event.startTime.split('T')[0];
      const eventEndDate = event.endTime && typeof event.endTime === 'string' ? event.endTime.split('T')[0] : eventStartDate;
      const weekStartStr = formatDate(weekStart, 'YYYY-MM-DD');
      const weekEndStr = formatDate(weekEnd, 'YYYY-MM-DD');
      
      // Check if event period overlaps with week period
      return eventStartDate <= weekEndStr && eventEndDate >= weekStartStr;
    }
    
    // Timed event
    const eventStart = new Date(event.startTime);
    const eventEnd = event.endTime ? new Date(event.endTime) : new Date(eventStart);
    
    if (Number.isNaN(eventStart.getTime()) || Number.isNaN(eventEnd.getTime())) return false;
    
    // Check if event period overlaps with week period
    return eventStart <= weekEnd && eventEnd >= weekStart;
  });
}

// Render day view
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
  updateCurrentTimeIndicator();
}

// Render week view
function renderWeekView() {
  const weekStart = getWeekStart(currentDate);
  
  // Update date for each day
  for (let i = 0; i < 7; i++) {
    const dayDate = new Date(weekStart);
    dayDate.setDate(dayDate.getDate() + i);
    
    // Correctly get corresponding column and header in week view
    const dayElement = document.querySelector(`#weekView .week-day[data-day="${i}"]`);
    const dateHeaderElement = document.querySelector(`#weekView .week-header .day-header-cell[data-day="${i}"] .day-date`);
    const eventsContainer = dayElement ? dayElement.querySelector('.day-events-container') : null;
    const allDayColumn = document.querySelector(`#weekView .week-all-day-columns .all-day-column[data-day="${i}"]`);
    const headerCell = document.querySelector(`#weekView .week-header .day-header-cell[data-day="${i}"]`);
    
    // Date display (without weekday)
    const dayNumber = dayDate.getDate();
    if (dateHeaderElement) {
      dateHeaderElement.textContent = dayNumber;
    }
    if (headerCell) {
      headerCell.setAttribute('role', 'button');
      headerCell.tabIndex = 0;
      headerCell.setAttribute('aria-label', formatDate(dayDate, 'MMMM D, YYYY (ddd)'));
    }
    
    // Display events
    if (!eventsContainer) {
      continue;
    }
    
    // Clear container
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
  
  // Attach resize handlers
  attachResizeHandlers();
  updateCurrentTimeIndicator();
}

// Event overlap detection and grouping (for side-by-side equal division display of same time slot)
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
  const fullTitle = event.title || '(No title)';
  // Show 31 characters instead of 30 + ellipsis
  const displayTitle = truncateText(fullTitle, 30);

  if (isAllDay) {
    element.setAttribute('aria-label', `${fullTitle} (All day)`);
    element.innerHTML = `
      <div class="event-title">${escapeHtml(displayTitle)}</div>
    `;
  } else {
    const startLabel = event.startTime ? formatTime(event.startTime) : '--:--';
    const endLabel = event.endTime ? formatTime(event.endTime) : '--:--';
    element.setAttribute('aria-label', `${fullTitle}, ${startLabel} to ${endLabel}`);
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

    try {
      const referenceNode = index < container.children.length ? container.children[index] : null;
      if (referenceNode !== element) {
        container.insertBefore(element, referenceNode || null);
      }
    } catch (error) {
      // Append to end if insertBefore fails
      container.appendChild(element);
    }
    processedIds.add(event.id);
  });

  Array.from(cacheMap.entries()).forEach(([id, info]) => {
    if (!processedIds.has(id)) {
      const element = info?.element;
      if (element && element.parentElement === container) {
        try {
          container.removeChild(element);
        } catch (error) {
          // Ignore if removeChild fails (may already be deleted)
        }
      }
      cacheMap.delete(id);
    }
  });
}

// Position events in day view
// Calculate event position in day view (considering events that span days)
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
  
  // Get 00:00 and 23:59:59 of target day (each day for week view, currentDate for day view)
  const displayDate = targetDate || currentDate;
  const currentDay = new Date(displayDate);
  currentDay.setHours(0, 0, 0, 0);
  const currentDayEnd = new Date(currentDay);
  currentDayEnd.setHours(23, 59, 59, 999);
  
  // Limit event display range to current day
  // For events that span days, only display the portion within current day range
  const displayStart = startTime < currentDay ? currentDay : startTime;
  const displayEnd = endTime > currentDayEnd ? currentDayEnd : endTime;
  
  // Don't display anything if display range doesn't overlap with current day
  if (displayStart >= currentDayEnd || displayEnd <= currentDay) {
    element.style.display = 'none';
    return;
  }
  
  element.style.display = '';
  
  // Get actual height of time slot (also needed for special positioning)
  const hourHeight = getHourHeight();
  
  // Minimum height for title only (about 30% of 1 hour height)
  const MIN_HEIGHT_TITLE_ONLY = hourHeight * 0.3;
  // Minimum height for both title and time (1.5 hours)
  const MIN_HEIGHT_FOR_TIME = hourHeight * 1.5;
  
  // Calculate event actual time in minutes from 00:00 of current day
  const eventStartMinutes = Math.floor((startTime.getTime() - currentDay.getTime()) / 60000);
  const eventEndMinutes = Math.floor((endTime.getTime() - currentDay.getTime()) / 60000);
  
  // Thresholds: 2am (120 minutes) and 4am (240 minutes)
  const DAY_END_HOUR = 2; // 2am is considered end of day
  const DAY_END_MINUTES = DAY_END_HOUR * 60; // 120 minutes
  
  // Special handling: Positioning for 0-4am events
  let useSpecialPositioning = false;
  let specialTop = null;
  let specialHeight = null;
  
  // Case 1: If event ends before 2am, display at 11pm-0am position (bottommost)
  // Set end time to midnight (00:00) for display
  if (eventEndMinutes < DAY_END_MINUTES && eventEndMinutes > 0) {
    useSpecialPositioning = true;
    // Bottommost position: 11pm (23:00) = VISIBLE_END_HOUR (23) - VISIBLE_START_HOUR (4) = 19 hours
    const bottomPositionHours = VISIBLE_END_HOUR - VISIBLE_START_HOUR; // 19 hours
    // Calculate event actual duration
    const actualDurationMinutes = Math.max(15, eventEndMinutes - Math.max(0, eventStartMinutes));
    // Use actual duration for height
    specialHeight = Math.max(MIN_HEIGHT_TITLE_ONLY, (actualDurationMinutes / 60) * hourHeight);
    // Position at bottommost (adjust position upward by height amount so bottom edge is at 11pm position)
    specialTop = (bottomPositionHours * hourHeight) - specialHeight;
  }
  // Case 2: If event starts after 2am and ends before 4am, display at 4-5am position (topmost)
  // Display as 4:00 AM to 5:00 AM (1 hour)
  else if (eventStartMinutes >= DAY_END_MINUTES && eventEndMinutes < VISIBLE_START_HOUR * 60 && eventStartMinutes < 1440) {
    useSpecialPositioning = true;
    // Topmost position: 4am = 0 (start of visible range)
    specialTop = 0;
    // Fixed height for 1 hour (4am-5am)
    specialHeight = hourHeight;
  }
  
  // If using special positioning
  if (useSpecialPositioning && specialTop !== null && specialHeight !== null) {
    element.style.top = `${specialTop}px`;
    element.style.height = `${specialHeight}px`;
    
    // Hide time element if height is below minimum
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
  
  // Normal positioning process
  // Calculate display start and end times in minutes
  const displayStartMinutesTotal = displayStart.getHours() * 60 + displayStart.getMinutes();
  const displayEndMinutesTotal = displayEnd.getHours() * 60 + displayEnd.getMinutes();
  const visibleStartMinutes = VISIBLE_START_HOUR * 60;
  const visibleEndMinutes = (VISIBLE_END_HOUR + 1) * 60;

  // Calculate start and end positions within visible range
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
  
  // Hide time element if height is below minimum
  const timeElement = element.querySelector('.event-time');
  if (timeElement) {
    if (calculatedHeight < MIN_HEIGHT_FOR_TIME) {
      timeElement.style.display = 'none';
    } else {
      timeElement.style.display = '';
    }
  }
}

// Show modal
function showEventModal(eventId = null) {
  const modal = safeGetElementById('eventModal');
  const modalTitle = safeGetElementById('modalTitle');
  const form = safeGetElementById('eventForm');
  const deleteBtn = safeGetElementById('deleteBtn');
  const saveBtn = form?.querySelector('button[type="submit"]');
  const startDateInput = safeGetElementById('eventStartDate');
  const startHourInput = safeGetElementById('eventStartHour');
  const startMinuteInput = safeGetElementById('eventStartMinute');
  const endDateInput = safeGetElementById('eventEndDate');
  const endHourInput = safeGetElementById('eventEndHour');
  const endMinuteInput = safeGetElementById('eventEndMinute');
  const allDayCheckbox = safeGetElementById('eventAllDay');
  const allDayRow = safeGetElementById('allDayDateRow');
  const allDayStartInput = safeGetElementById('eventAllDayStart');
  const allDayEndInput = safeGetElementById('eventAllDayEnd');
  
  // Check required elements
  if (!modal || !modalTitle || !form || !startDateInput || !startHourInput || !startMinuteInput || 
      !endDateInput || !endHourInput || !endMinuteInput) {
    return;
  }
  
  const allDayControls = { 
    startInput: startDateInput, 
    endInput: endDateInput, 
    allDayRow,
    startHourInput,
    startMinuteInput,
    endHourInput,
    endMinuteInput
  };
  
  editingEventId = eventId;
  
  const resetTimeInputs = () => {
    if (startDateInput) {
      startDateInput.disabled = false;
      startDateInput.classList.remove('readonly-input');
    }
    if (startHourInput) {
      startHourInput.disabled = false;
    }
    if (startMinuteInput) {
      startMinuteInput.disabled = false;
    }
    if (endDateInput) {
      endDateInput.disabled = false;
      endDateInput.classList.remove('readonly-input');
    }
    if (endHourInput) {
      endHourInput.disabled = false;
    }
    if (endMinuteInput) {
      endMinuteInput.disabled = false;
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
    // Edit mode (non-temporary event)
    if (!Array.isArray(events)) return;
    const event = events.find(e => e.id === eventId);
    if (!event) return;
    
    if (modalTitle) modalTitle.textContent = 'Edit Event';
    if (deleteBtn) deleteBtn.style.display = 'block';
    if (saveBtn) saveBtn.textContent = 'Save';
    
    // Check if this event is part of a recurring series
    const recurringSeriesId = event.recurringSeriesId;
    const seriesEvents = recurringSeriesId ? findRecurringSeriesEvents(recurringSeriesId) : [];
    const isPartOfSeries = seriesEvents.length > 1;
    
    // Show/hide recurring series options
    const recurringSeriesOptions = safeGetElementById('recurringSeriesOptions');
    if (recurringSeriesOptions) {
      if (isPartOfSeries) {
        recurringSeriesOptions.classList.remove('hidden');
        // Set default to "single" (this event only)
        const singleRadio = recurringSeriesOptions.querySelector('input[value="single"]');
        if (singleRadio) singleRadio.checked = true;
      } else {
        recurringSeriesOptions.classList.add('hidden');
      }
    }
    
    // Set form values
    const titleInput = safeGetElementById('eventTitle');
    if (titleInput) titleInput.value = event.title || '';
    const descInput = safeGetElementById('eventDescription');
    if (descInput) descInput.value = event.description || '';
    
    // Set datetime inputs
    setDateTimeFromISO(startDateInput, startHourInput, startMinuteInput, event.startTime);
    setDateTimeFromISO(endDateInput, endHourInput, endMinuteInput, event.endTime || event.startTime);
    
    if (allDayCheckbox) {
      const isAllDay = isAllDayEvent(event);
      allDayCheckbox.checked = isAllDay;
      if (isAllDay) {
        if (allDayStartInput) allDayStartInput.value = formatDateOnly(event.startTime);
        if (allDayEndInput) allDayEndInput.value = formatDateOnly(event.endTime || event.startTime);
      }
      applyAllDayMode(isAllDay, allDayControls);
    }
    
    // Set color
    const colorRadio = document.querySelector(`input[name="color"][value="${event.color}"]`);
    if (colorRadio) colorRadio.checked = true;
    
    // Set recurrence
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
    
    // Set reminder
    const reminderSelect = safeGetElementById('eventReminder');
    if (reminderSelect) {
      reminderSelect.value = event.reminderMinutes !== null && event.reminderMinutes !== undefined ? String(event.reminderMinutes) : '';
    }
  } else {
    // New creation mode (temporary event or new)
    if (modalTitle) modalTitle.textContent = 'New Event';
    if (deleteBtn) deleteBtn.style.display = 'none';
    if (saveBtn) saveBtn.textContent = 'Create';
    
    // Default reminder: 30 minutes before
    const reminderSelect = safeGetElementById('eventReminder');
    if (reminderSelect) reminderSelect.value = '30';
    
    // Clear all fields (title, description, color, etc.)
    const titleInput = safeGetElementById('eventTitle');
    if (titleInput) titleInput.value = '';
    const descInput = safeGetElementById('eventDescription');
    if (descInput) descInput.value = '';
    
    // Reset color to default (blue)
    const defaultColorRadio = document.querySelector('input[name="color"][value="#3b82f6"]');
    if (defaultColorRadio) defaultColorRadio.checked = true;
    
      // Keep existing values for temporary events
      if (eventId && typeof eventId === 'string' && eventId.startsWith('temp-')) {
        if (!Array.isArray(events)) return;
        const event = events.find(e => e.id === eventId);
        if (event) {
          const descInput = safeGetElementById('eventDescription');
          if (descInput) descInput.value = event.description || '';
          
          // Set datetime inputs
          setDateTimeFromISO(startDateInput, startHourInput, startMinuteInput, event.startTime);
          setDateTimeFromISO(endDateInput, endHourInput, endMinuteInput, event.endTime || event.startTime);
          
          if (allDayCheckbox) {
            const isAllDay = isAllDayEvent(event);
            allDayCheckbox.checked = isAllDay;
            if (isAllDay) {
              if (allDayStartInput) allDayStartInput.value = formatDateOnly(event.startTime);
              if (allDayEndInput) allDayEndInput.value = formatDateOnly(event.endTime || event.startTime);
            }
            applyAllDayMode(isAllDay, allDayControls);
          }
          
          // Set color
          const colorRadio = document.querySelector(`input[name="color"][value="${event.color}"]`);
          if (colorRadio) colorRadio.checked = true;
        }
      } else {
        // Set default datetime values (current date/time, rounded to nearest 15 minutes)
        const now = new Date();
        const roundedMinutes = Math.round(now.getMinutes() / 15) * 15;
        const defaultStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), roundedMinutes);
        const defaultEnd = new Date(defaultStart.getTime() + 60 * 60 * 1000); // 1 hour later
        
        setDateTimeFromISO(startDateInput, startHourInput, startMinuteInput, defaultStart.toISOString());
        setDateTimeFromISO(endDateInput, endHourInput, endMinuteInput, defaultEnd.toISOString());
      }
    if (allDayCheckbox) {
      allDayCheckbox.checked = false;
      applyAllDayMode(false, allDayControls);
    }
    
    // Hide recurrence end date field
    const recurrenceEndGroup = safeGetElementById('recurrenceEndGroup');
    if (recurrenceEndGroup) {
      recurrenceEndGroup.classList.add('hidden');
    }
    
    // Hide recurring series options (only shown when editing events in a series)
    const recurringSeriesOptions = safeGetElementById('recurringSeriesOptions');
    if (recurringSeriesOptions) {
      recurringSeriesOptions.classList.add('hidden');
    }
    
    // Reset recurrence; default reminder 30 minutes before
    const recurrenceSelect = safeGetElementById('eventRecurrence');
    if (recurrenceSelect) recurrenceSelect.value = 'none';
    if (reminderSelect) reminderSelect.value = '30';
  }
  
  if (modal) {
    modal.classList.add('show');
    modal.setAttribute('aria-hidden', 'false');
    // Control body overflow to prevent scrollbar on mobile (CSS class only)
    document.body.classList.add('modal-open');
  }
}

// Close modal
function closeEventModal() {
  try {
    const modal = safeGetElementById('eventModal');
    if (modal) {
      modal.classList.remove('show');
      modal.setAttribute('aria-hidden', 'true');
      // Restore body overflow (CSS class only)
      document.body.classList.remove('modal-open');
    }
    
    // Reset form submission flag (just in case)
    const eventForm = safeGetElementById('eventForm');
    if (eventForm) {
      delete eventForm.dataset.submitting;
    }
    
    // Delete if temporary event
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
  } catch (error) {
    console.error('Error in closeEventModal:', error);
    // Fallback: force close modal even if there's an error
    const modal = document.getElementById('eventModal');
    if (modal) {
      modal.classList.remove('show');
      modal.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('modal-open');
    }
    const eventForm = document.getElementById('eventForm');
    if (eventForm) {
      delete eventForm.dataset.submitting;
    }
  }
}

// Update date display
function updateDateDisplay() {
  const currentDateElement = safeGetElementById('currentDate');
  if (!currentDateElement) return;
  
  // Ensure currentDate is a valid Date object
  if (!(currentDate instanceof Date) || Number.isNaN(currentDate.getTime())) {
    currentDate = new Date();
  }
  
  try {
    if (currentView === 'day') {
      currentDateElement.textContent = formatDate(currentDate, 'MMM D, YYYY (ddd)');
    } else if (currentView === 'week') {
      const weekStart = getWeekStart(currentDate);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);
      
      currentDateElement.textContent = `${formatDate(weekStart, 'M/D')} - ${formatDate(weekEnd, 'M/D')}`;
    } else if (currentView === 'month') {
      currentDateElement.textContent = formatDate(currentDate, 'MMM YYYY');
    }
  } catch (error) {
    console.error('Error updating date display:', error);
    // Fallback to today's date
    const today = new Date();
    currentDateElement.textContent = formatDate(today, 'MMMM D, YYYY (ddd)');
  }
}

// Render month view
function renderMonthView() {
  const monthGrid = safeGetElementById('monthGrid');
  if (!monthGrid) {
    return;
  }
  monthGrid.innerHTML = '';
  
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  
  // First and last day of month
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  
  // Start date of first week of month (Sunday)
  const startDate = new Date(firstDay);
  startDate.setDate(startDate.getDate() - firstDay.getDay());
  
  // Generate dates for 6 weeks
  for (let week = 0; week < 6; week++) {
    for (let day = 0; day < 7; day++) {
      const date = new Date(startDate);
      date.setDate(startDate.getDate() + (week * 7) + day);
      
      const dayElement = createMonthDayElement(date, month);
      monthGrid.appendChild(dayElement);
    }
  }
}

// Create month view date element
function createMonthDayElement(date, currentMonth) {
  const div = document.createElement('div');
  div.className = 'month-day';
  // Validate date before calling toISOString()
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return div;
  }
  div.dataset.date = date.toISOString().split('T')[0];
  
  // Check if date is from another month
  if (date.getMonth() !== currentMonth) {
    div.classList.add('other-month');
  }
  
  // Check if today
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    div.classList.add('today');
  }
  
  // Date number
  const dayNumber = document.createElement('div');
  dayNumber.className = 'month-day-number';
  dayNumber.textContent = date.getDate();
  div.appendChild(dayNumber);
  
  // Events for that day (timetable events are hidden in month view)
  const dayEvents = getEventsByDate(date);
  const visibleEvents = dayEvents.filter(event => event.isTimetable !== true);

  if (visibleEvents.length > 0) {
    const eventsContainer = document.createElement('div');
    eventsContainer.className = 'month-day-events';
    
    // Display up to 3 items (background color + time + title)
    visibleEvents.slice(0, 3).forEach(event => {
      const eventElement = document.createElement('div');
      eventElement.className = 'month-event-item';
      
      // Use event color as background color
      const eventColor = event.color || '#3b82f6';
      eventElement.style.backgroundColor = eventColor;
      
      // Adjust text color based on background color (dark text for light colors, light text for dark colors)
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
      // Display shortened in month view (max 15 characters, but show 16th character instead of ellipsis)
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
    
    // Display "+N" if more than 3 items
    if (visibleEvents.length > 3) {
      const moreElement = document.createElement('div');
      moreElement.className = 'month-event-item';
      moreElement.textContent = `+${visibleEvents.length - 3}`;
      eventsContainer.appendChild(moreElement);
    }
    
    div.appendChild(eventsContainer);
  }
  
  // Switch to day view on date click
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
  div.setAttribute('aria-label', `Day ${date.getDate()}`);
  
  return div;
}

// Update current time indicator for day and week views
function updateCurrentTimeIndicator() {
  const now = new Date();
  const currentHour = now.getHours();
  const currentMinutes = now.getMinutes();
  
  // Only show indicator if current time is within visible range
  if (currentHour < VISIBLE_START_HOUR || currentHour > VISIBLE_END_HOUR) {
    // Remove indicators if outside visible range
    removeCurrentTimeIndicators();
    return;
  }
  
  if (currentView === 'day') {
    updateDayViewCurrentTime(now, currentHour, currentMinutes);
  } else if (currentView === 'week') {
    updateWeekViewCurrentTime(now, currentHour, currentMinutes);
  }
  // Month view uses CSS class 'today' which is already handled in renderMonthView
}

function updateDayViewCurrentTime(now, currentHour, currentMinutes) {
  const container = safeGetElementById('dayEventContainer');
  if (!container) return;
  
  // Check if we're viewing today
  const today = new Date();
  if (currentDate.toDateString() !== today.toDateString()) {
    removeCurrentTimeIndicator(container);
    return;
  }
  
  const hourHeight = getHourHeight();
  const currentTotalMinutes = currentHour * 60 + currentMinutes;
  const visibleStartMinutes = VISIBLE_START_HOUR * 60;
  const minutesFromTop = currentTotalMinutes - visibleStartMinutes;
  const topPosition = (minutesFromTop / 60) * hourHeight;
  
  let indicator = container.querySelector('.current-time-indicator');
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.className = 'current-time-indicator';
    container.appendChild(indicator);
  }
  
  indicator.style.top = `${topPosition}px`;
  indicator.style.display = 'block';
}

function updateWeekViewCurrentTime(now, currentHour, currentMinutes) {
  const weekStart = getWeekStart(currentDate);
  const today = new Date();
  
  // Find which day column corresponds to today
  for (let i = 0; i < 7; i++) {
    const dayDate = new Date(weekStart);
    dayDate.setDate(weekStart.getDate() + i);
    
    const dayElement = document.querySelector(`#weekView .week-day[data-day="${i}"]`);
    const eventsContainer = dayElement ? dayElement.querySelector('.day-events-container') : null;
    
    if (!eventsContainer) continue;
    
    // Check if this day is today
    if (dayDate.toDateString() === today.toDateString()) {
      const hourHeight = getHourHeight();
      const currentTotalMinutes = currentHour * 60 + currentMinutes;
      const visibleStartMinutes = VISIBLE_START_HOUR * 60;
      const minutesFromTop = currentTotalMinutes - visibleStartMinutes;
      const topPosition = (minutesFromTop / 60) * hourHeight;
      
      let indicator = eventsContainer.querySelector('.current-time-indicator');
      if (!indicator) {
        indicator = document.createElement('div');
        indicator.className = 'current-time-indicator';
        eventsContainer.appendChild(indicator);
      }
      
      indicator.style.top = `${topPosition}px`;
      indicator.style.display = 'block';
    } else {
      // Remove indicator from other days
      removeCurrentTimeIndicator(eventsContainer);
    }
  }
}

function removeCurrentTimeIndicators() {
  const dayContainer = safeGetElementById('dayEventContainer');
  if (dayContainer) {
    removeCurrentTimeIndicator(dayContainer);
  }
  
  const weekDayContainers = document.querySelectorAll('#weekView .day-events-container');
  weekDayContainers.forEach(container => {
    removeCurrentTimeIndicator(container);
  });
}

function removeCurrentTimeIndicator(container) {
  if (!container) return;
  const indicator = container.querySelector('.current-time-indicator');
  if (indicator) {
    indicator.style.display = 'none';
  }
}

// Start interval to update current time indicator every minute
function startCurrentTimeIndicator() {
  // Clear existing interval if any
  if (currentTimeIndicatorIntervalId) {
    clearInterval(currentTimeIndicatorIntervalId);
  }
  
  // Update immediately
  updateCurrentTimeIndicator();
  
  // Update every minute
  currentTimeIndicatorIntervalId = setInterval(() => {
    updateCurrentTimeIndicator();
  }, 60000); // 60 seconds
}

// Stop interval for current time indicator
function stopCurrentTimeIndicator() {
  if (currentTimeIndicatorIntervalId) {
    clearInterval(currentTimeIndicatorIntervalId);
    currentTimeIndicatorIntervalId = null;
  }
  removeCurrentTimeIndicators();
}

// Update views
function updateViews() {
  updateDateDisplay();
  
  if (currentView === 'day') {
    renderDayView();
  } else if (currentView === 'week') {
    renderWeekView();
  } else if (currentView === 'month') {
    renderMonthView();
  }
  // Reschedule proximity notifications on each view update
  scheduleAllNotifications();
  // Update current time indicator after view render
  updateCurrentTimeIndicator();
}

// Utility functions

// Date formatting
function formatDate(date, format) {
  if (!date || !(date instanceof Date) || Number.isNaN(date.getTime())) {
    return '';
  }
  if (!format || typeof format !== 'string') {
    format = 'YYYY-MM-DD';
  }
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const monthIndex = date.getMonth();
  const day = date.getDate();
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                      'July', 'August', 'September', 'October', 'November', 'December'];
  const monthAbbr = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                     'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dayName = dayNames[date.getDay()];
  const monthName = monthNames[monthIndex];
  const monthAbbrName = monthAbbr[monthIndex];
  
  // Replace patterns in order, using a placeholder system to avoid conflicts
  // The issue: replacing 'D' replaces ALL D's including in "December"
  // Solution: Use placeholders that don't contain M or D, then replace format tokens, then restore
  
  // Use unique placeholders that don't contain M or D to avoid conflicts
  const MONTH_PLACEHOLDER = '___X1___';
  const MONTH_ABBR_PLACEHOLDER = '___X2___';
  const DAY_PLACEHOLDER = '___X3___';
  
  let result = format;
  
  // Step 1: Replace longer patterns first and use placeholders for text values
  result = result.replace(/YYYY/g, String(year));
  result = result.replace(/MMMM/g, MONTH_PLACEHOLDER);
  result = result.replace(/MMM/g, MONTH_ABBR_PLACEHOLDER);
  result = result.replace(/ddd/g, DAY_PLACEHOLDER);
  result = result.replace(/DD/g, day.toString().padStart(2, '0'));
  result = result.replace(/MM/g, month.toString().padStart(2, '0'));
  
  // Step 2: Replace single D and M tokens (now safe since placeholders don't contain M or D)
  result = result.replace(/D/g, String(day));
  result = result.replace(/M/g, String(month));
  
  // Step 3: Replace placeholders with actual month/day names
  result = result.replace(MONTH_PLACEHOLDER, monthName);
  result = result.replace(MONTH_ABBR_PLACEHOLDER, monthAbbrName);
  result = result.replace(DAY_PLACEHOLDER, dayName);
  
  return result;
}

// Truncate text to specified length (show one more character instead of ellipsis)
function truncateText(text, maxLength) {
  if (!text || typeof text !== 'string') return '';
  if (text.length <= maxLength) return text;
  // Return one more character instead of ellipsis to provide more information
  return text.substring(0, maxLength + 1);
}

// Time format
function formatTime(dateTimeString) {
  if (!dateTimeString) return '--:--';
  const date = new Date(dateTimeString);
  if (Number.isNaN(date.getTime())) return '--:--';
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

// Format for datetime-local (kept for backward compatibility)
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

// Helper functions for date + time number inputs
function setDateTimeFromISO(dateInput, hourInput, minuteInput, isoString) {
  if (!isoString) return;
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return;
  
  if (dateInput) {
    dateInput.value = formatDateOnly(date);
  }
  if (hourInput) {
    hourInput.value = date.getHours();
  }
  if (minuteInput) {
    // Round to nearest 15 minutes
    const minutes = date.getMinutes();
    const roundedMinutes = Math.round(minutes / 15) * 15;
    minuteInput.value = roundedMinutes;
  }
}

function getDateTimeAsISO(dateInput, hourInput, minuteInput) {
  if (!dateInput || !hourInput || !minuteInput) return '';
  if (!dateInput.value || hourInput.value === '' || minuteInput.value === '') return '';
  
  const dateStr = dateInput.value;
  const hour = parseInt(hourInput.value, 10);
  const minute = parseInt(minuteInput.value, 10);
  
  if (Number.isNaN(hour) || Number.isNaN(minute)) return '';
  if (hour < 0 || hour > 23) return '';
  if (minute < 0 || minute > 59) return '';
  
  const date = new Date(`${dateStr}T${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`);
  if (Number.isNaN(date.getTime())) return '';
  
  return date.toISOString();
}

function formatDateOnly(value) {
  if (!value) return '';
  if (typeof value === 'string') {
    // Return as-is if date only (YYYY-MM-DD)
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

function formatTimeOnly(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

function combineDateAndTime(dateStr, timeStr) {
  if (!dateStr || !timeStr) return '';
  return `${dateStr}T${timeStr}`;
}

function splitDateTime(dateTimeStr) {
  if (!dateTimeStr) return { date: '', time: '' };
  const parts = dateTimeStr.split('T');
  return {
    date: parts[0] || '',
    time: parts[1] || ''
  };
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
  const { startInput, endInput, allDayRow, startHourInput, startMinuteInput, endHourInput, endMinuteInput } = controls;
  const allDayStartInput = safeGetElementById('eventAllDayStart');
  const allDayEndInput = safeGetElementById('eventAllDayEnd');
  if (isAllDay) {
    allDayRow?.classList.remove('hidden');
    startInput?.classList.add('readonly-input');
    endInput?.classList.add('readonly-input');
    startInput?.setAttribute('disabled', 'disabled');
    endInput?.setAttribute('disabled', 'disabled');
    startHourInput?.setAttribute('disabled', 'disabled');
    startMinuteInput?.setAttribute('disabled', 'disabled');
    endHourInput?.setAttribute('disabled', 'disabled');
    endMinuteInput?.setAttribute('disabled', 'disabled');
    allDayStartInput?.removeAttribute('disabled');
    allDayEndInput?.removeAttribute('disabled');
  } else {
    allDayRow?.classList.add('hidden');
    startInput?.classList.remove('readonly-input');
    endInput?.classList.remove('readonly-input');
    startInput?.removeAttribute('disabled');
    endInput?.removeAttribute('disabled');
    startHourInput?.removeAttribute('disabled');
    startMinuteInput?.removeAttribute('disabled');
    endHourInput?.removeAttribute('disabled');
    endMinuteInput?.removeAttribute('disabled');
    allDayStartInput?.setAttribute('disabled', 'disabled');
    allDayEndInput?.setAttribute('disabled', 'disabled');
  }
}

function normalizeEventDateTimeString(value) {
  if (!value) return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
    return value;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const out = formatDateTimeLocal(date);
  return out;
}

function getAllowedDateRanges() {
  const now = new Date();
  
  // Safely calculate date 6 months ago
  const rangeStart = new Date(now);
  const currentMonth = rangeStart.getMonth();
  const targetMonth = currentMonth - 6;
  
  // Handle when month becomes negative
  if (targetMonth < 0) {
    rangeStart.setFullYear(rangeStart.getFullYear() - 1);
    rangeStart.setMonth(12 + targetMonth);
  } else {
    rangeStart.setMonth(targetMonth);
  }
  rangeStart.setDate(1); // First day of month
  rangeStart.setHours(0, 0, 0, 0);

  // Calculate date 1 year later
  const rangeEnd = new Date(now);
  rangeEnd.setFullYear(rangeEnd.getFullYear() + 1);
  rangeEnd.setMonth(11); // December
  rangeEnd.setDate(31); // End of month
  rangeEnd.setHours(23, 59, 59, 999);

  return { rangeStart, rangeEnd };
}


// Check if event is within allowed range (considering events that span days)
function isEventInAllowedRange(event, ranges) {
  if (!event || !event.startTime) return false;
  
  const { rangeStart, rangeEnd } = ranges || getAllowedDateRanges();
  
  // For all-day events
  if (isAllDayEvent(event)) {
    const eventStartDate = new Date(event.startTime.split('T')[0]);
    const eventEndDate = event.endTime ? new Date(event.endTime.split('T')[0]) : eventStartDate;
    
    if (Number.isNaN(eventStartDate.getTime()) || Number.isNaN(eventEndDate.getTime())) return false;
    
    // Check if event period overlaps with allowed range
    return eventStartDate <= rangeEnd && eventEndDate >= rangeStart;
  }
  
  // Timed event
  const eventStart = new Date(event.startTime);
  const eventEnd = event.endTime ? new Date(event.endTime) : eventStart;
  
  if (Number.isNaN(eventStart.getTime()) || Number.isNaN(eventEnd.getTime())) return false;
  
  // Check if event period overlaps with allowed range
  return eventStart <= rangeEnd && eventEnd >= rangeStart;
}

// Notification schedule
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
    const soon = now + 7 * 24 * 60 * 60 * 1000; // Within 7 days only
    events.forEach(ev => {
      if (!ev || !ev.id) return;
      if (!ev.reminderMinutes && ev.reminderMinutes !== 0) return;
      if (isAllDayEvent(ev)) return;
      if (!ev.startTime) return;
      const start = new Date(ev.startTime).getTime();
      if (Number.isNaN(start)) return;
      if (Number.isNaN(start)) return;
      const fireAt = start - (ev.reminderMinutes * 60000);
      if (fireAt < now || fireAt > soon) return;
      const timeoutDelay = fireAt - now;
      if (timeoutDelay <= 0) return; // Additional safety check
      const timeout = setTimeout(() => {
        try { new Notification(ev.title || 'Event', { body: `Starts at ${formatTime(ev.startTime)}`, silent: false }); } catch {}
      }, timeoutDelay);
      scheduledTimeouts.push(timeout);
    });
  }).catch((error) => {
  });
}

// Export/Import (JSON only, ICS to follow)
function exportEventsAsJSON(range = 'all') {
  try {
    // range parameter is currently unused (for future expansion)
    const data = { version: '1.1', exportedAt: new Date().toISOString(), events };
    const jsonString = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'events.json';
    try {
      document.body.appendChild(a);
      a.click();
    } catch (error) {
      // Ignore if click fails
    } finally {
      try {
        document.body.removeChild(a);
      } catch (error) {
        // Ignore if removeChild fails
      }
      URL.revokeObjectURL(url);
    }
    showMessage('Events exported', 'success', 3000);
  } catch (error) {
    showMessage('Export failed.', 'error', 6000);
  }
}

async function importEventsFromJSONData(obj) {
  if (!obj || !Array.isArray(obj.events)) throw new Error('Invalid format');
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
    const newId = await addEvent(toAdd, { syncGoogle: false });
    if (newId) {
      importedCount++;
    }
  }
  return importedCount;
}


// Date calculation
function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

// Generate all occurrence dates for a recurring event
function generateRecurrenceOccurrences(startTime, endTime, recurrence, recurrenceEnd) {
  if (!recurrence || recurrence === 'none' || !recurrenceEnd) {
    return [];
  }
  
  const start = new Date(startTime);
  if (Number.isNaN(start.getTime())) {
    return [];
  }
  
  // Parse recurrenceEnd (date-only string YYYY-MM-DD)
  const recurEndStr = typeof recurrenceEnd === 'string' && recurrenceEnd.includes('T')
    ? recurrenceEnd
    : (recurrenceEnd || '') + 'T23:59:59';
  const end = new Date(recurEndStr);
  if (Number.isNaN(end.getTime())) {
    return [];
  }
  
  // Calculate duration of the original event
  const originalEnd = new Date(endTime);
  const duration = Number.isNaN(originalEnd.getTime()) ? 0 : (originalEnd.getTime() - start.getTime());
  
  const occurrences = [];
  const current = new Date(start);
  
  while (current <= end) {
    // Check if this occurrence matches the recurrence pattern
    let matches = false;
    
    if (recurrence === 'daily') {
      matches = true;
    } else if (recurrence === 'weekly') {
      // Same day of week as start
      matches = current.getDay() === start.getDay();
    } else if (recurrence === 'monthly') {
      // Same day of month as start
      matches = current.getDate() === start.getDate();
    }
    
    if (matches) {
      occurrences.push({
        startTime: new Date(current),
        endTime: new Date(current.getTime() + duration)
      });
    }
    
    // Move to next day
    current.setDate(current.getDate() + 1);
    
    // Safety limit: prevent infinite loops (max 10 years)
    if (occurrences.length > 3650) {
      break;
    }
  }
  
  return occurrences;
}

// Month calculation
function addMonths(date, months) {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

// View switching
function switchView(view) {
  if (view !== 'day' && view !== 'week' && view !== 'month') {
    return;
  }
  
  // Update current view
  currentView = view;
  
  // Save to localStorage
  try {
    localStorage.setItem('scheduleView', view);
  } catch (error) {
    // Ignore if localStorage is not available
  }
  
  // Deactivate all views
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
  
  // Reset header classes
  const header = document.querySelector('.header');
  if (header) header.classList.remove('month-view-active');
  
  // Activate selected view
  if (view === 'day') {
    if (dayView) dayView.classList.add('active');
    if (dayViewBtn) dayViewBtn.classList.add('active');
  } else if (view === 'week') {
    if (weekView) weekView.classList.add('active');
    if (weekViewBtn) weekViewBtn.classList.add('active');
  } else if (view === 'month') {
    if (monthView) monthView.classList.add('active');
    if (monthViewBtn) monthViewBtn.classList.add('active');
    // Add class to header for month view (don't hide arrows)
    // if (header) header.classList.add('month-view-active');
  }
  
  // Update views
  updateViews();
}

// Get week start date (Sunday)
function getWeekStart(date) {
  if (!date) return new Date();
  const result = date instanceof Date ? new Date(date) : new Date(date);
  if (Number.isNaN(result.getTime())) return new Date();
  const day = result.getDay();
  result.setDate(result.getDate() - day);
  result.setHours(0, 0, 0, 0);
  return result;
}

// HTML escape
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = String(text);
  return div.innerHTML;
}

// Sanitize input values
function sanitizeInput(input) {
  if (typeof input !== 'string') return input;
  // Remove HTML tags and escape dangerous characters
  return input
    .trim()
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

// Sanitize text input (remove HTML tags, preserve special characters)
function sanitizeTextInput(input) {
  if (typeof input !== 'string') return '';
  return input.trim();
}

// Sanitize HTML content (only allow safe HTML tags used by Quill)
function sanitizeHTML(html) {
  if (typeof html !== 'string') return '';
  
  // Create temporary div element to parse HTML
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = html;
  
  // Allowed tags and attributes
  const allowedTags = ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'ul', 'ol', 'li', 'a', 'h1', 'h2', 'h3', 'span'];
  const allowedAttributes = {
    'a': ['href', 'target'],
    'span': ['style'],
    'p': ['style']
  };
  
  // Recursively sanitize elements
  function sanitizeNode(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.cloneNode(true);
    }
    
    if (node.nodeType === Node.ELEMENT_NODE) {
      const tagName = node.tagName.toLowerCase();
      
      if (!allowedTags.includes(tagName)) {
        // Unallowed tags: keep content only
        const fragment = document.createDocumentFragment();
        Array.from(node.childNodes).forEach(child => {
          const sanitized = sanitizeNode(child);
          if (sanitized) {
            fragment.appendChild(sanitized);
          }
        });
        return fragment;
      }
      
      // Create element if tag is allowed
      const newElement = document.createElement(tagName);
      
      // Copy only allowed attributes
      const allowedAttrs = allowedAttributes[tagName] || [];
      Array.from(node.attributes).forEach(attr => {
        if (allowedAttrs.includes(attr.name.toLowerCase())) {
          if (attr.name === 'href') {
            // Only allow safe URLs for href attribute
            try {
              const url = new URL(attr.value, window.location.href);
              if (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:') {
                newElement.setAttribute(attr.name, attr.value);
              }
            } catch (e) {
              // Ignore invalid URLs
            }
          } else if (attr.name === 'style') {
            // Only allow basic styles for style attribute (color, background-color, etc.)
            const safeStyles = attr.value.match(/(color|background-color):\s*[^;]+/gi);
            if (safeStyles) {
              newElement.setAttribute(attr.name, safeStyles.join('; '));
            }
          } else {
            newElement.setAttribute(attr.name, attr.value);
          }
        }
      });
      
      // Recursively sanitize child elements
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
  
  // Sanitize all child nodes
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
  
  // Return sanitized HTML as string
  const resultDiv = document.createElement('div');
  resultDiv.appendChild(fragment);
  return resultDiv.innerHTML;
}

// Extract text only from HTML (for character counting)
function getTextFromHTML(html) {
  if (typeof html !== 'string') return '';
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = html;
  return tempDiv.textContent || tempDiv.innerText || '';
}

// ID generation function
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// Event validation
function validateEvent(event) {
  const errors = [];
  
  // Title can be empty
  if (event.title && event.title.length > 100) {
    errors.push('Title must be 100 characters or less');
  }
  
  if (!event.startTime) {
    errors.push(event.allDay ? 'Please enter start date' : 'Please enter start time');
  }
  
  if (!event.endTime) {
    errors.push(event.allDay ? 'Please enter end date' : 'Please enter end time');
  }
  
  if (event.startTime && event.endTime) {
    const start = new Date(event.startTime);
    const end = new Date(event.endTime);
    
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      errors.push('Invalid date format');
    } else if (end <= start) {
      errors.push(event.allDay ? 'End date must be after start date' : 'End time must be after start time');
    }
  }
  
  if (event.description && event.description.length > 500) {
    errors.push('Description must be 500 characters or less');
  }
  
  // Recurrence validation
  if (event.recurrence && event.recurrence !== 'none') {
    if (event.recurrenceEnd) {
      if (!event.startTime) {
        errors.push('Start time is required to set recurrence');
      } else {
        const start = new Date(event.startTime);
        // recurrenceEnd is a date-only string (YYYY-MM-DD), so we need to parse it correctly
        const recurEndStr = (event.recurrenceEnd && typeof event.recurrenceEnd === 'string' && event.recurrenceEnd.includes('T'))
          ? event.recurrenceEnd 
          : (event.recurrenceEnd || '') + 'T23:59:59';
        const recurEnd = new Date(recurEndStr);
        if (Number.isNaN(start.getTime()) || Number.isNaN(recurEnd.getTime())) {
          errors.push('Recurrence end date format is incorrect');
        } else if (recurEnd < start) {
          errors.push('Recurrence end date must be after start date');
        }
      }
    }
  }
  
  return errors;
}


// Initialization (same logic as combi)
document.addEventListener('DOMContentLoaded', function() {
  
  // Check Firebase connection
  if (!checkFirebase()) {
    showMessage('Cannot connect to Firebase. Please check your settings and reload.', 'error', 6000);
    return;
  }
  
  // Initialize Google sync status indicator (start in unsynced state)
  updateGoogleSyncIndicator('unsynced');
  
  // Add hover/click events to indicator (prevent duplicate registration)
  const indicator = safeGetElementById('googleSyncIndicator');
  if (indicator && !indicator.dataset.tooltipBound) {
    indicator.dataset.tooltipBound = 'true';
    indicator.addEventListener('mouseenter', showGoogleSyncStatusTooltip);
    indicator.addEventListener('mouseleave', hideGoogleSyncStatusTooltip);
    indicator.addEventListener('click', (e) => {
      e.stopPropagation();
      showGoogleSyncStatusTooltip(e);
      setTimeout(() => {
        hideGoogleSyncStatusTooltip();
      }, 3000);
    });
  }
  
  // Initialize CRUD operation status indicator (start in idle state)
  updateCrudStatusIndicator('idle');
  
  // Unified indicator already has tooltip handlers from Google sync indicator setup
  
  // Ensure currentDate is properly initialized
  if (!(currentDate instanceof Date) || Number.isNaN(currentDate.getTime())) {
    currentDate = new Date();
  }
  
  // Initialize date display
  updateDateDisplay();
  
  // Restore saved view
  try {
    const savedView = localStorage.getItem('scheduleView');
    if (savedView === 'day' || savedView === 'week' || savedView === 'month') {
      currentView = savedView;
      switchView(savedView);
    }
  } catch (error) {
    // Keep default (day) if localStorage is not available
  }
  
  // Load events
  loadEvents();
  
  // Register event listeners
  setupEventListeners();

  // Enable click-to-add on day grid
  enableDayGridClickToCreate();
  // Enable click-to-add on week grid
  enableWeekGridClickToCreate();
  
  startAutomaticGoogleSync();
  startCurrentTimeIndicator();
});

window.addEventListener('beforeunload', () => {
  // Cleanup Firebase listeners
  if (typeof unsubscribeEvents === 'function') {
    unsubscribeEvents();
    unsubscribeEvents = null;
  }
  // Cleanup all event listeners
  eventListeners.removeAll();
  clearScheduledNotifications();
  stopAutomaticGoogleSync();
  
  // Cleanup tooltip timers
  if (googleSyncTooltipTimerId) {
    clearInterval(googleSyncTooltipTimerId);
    googleSyncTooltipTimerId = null;
  }
});

// Event listener setup
function setupEventListeners() {
  // Clean up existing listeners (on re-initialization)
  eventListeners.removeAll();
  
  // Date navigation (for day/week/month views)
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
        showMessage('Failed to navigate date.', 'error', 3000);
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
        showMessage('Failed to navigate date.', 'error', 3000);
      }
    };
    eventListeners.add(nextDayBtn, 'click', handler);
  }
  
  // Monthly navigation (uses header arrows)
  // prevDay/nextDay already implemented to work as previous/next month in month view
  
  const todayBtn = safeGetElementById('todayBtn');
  if (todayBtn) {
    const handler = () => {
      try {
      currentDate = new Date();
      updateViews();
      } catch (error) {
        showMessage('Failed to navigate to today.', 'error', 3000);
      }
    };
    eventListeners.add(todayBtn, 'click', handler);
  }
  
  // View switching
  const dayViewBtn = safeGetElementById('dayViewBtn');
  if (dayViewBtn) {
    const handler = () => {
      try {
      currentView = 'day';
      switchView('day');
      updateViews();
      } catch (error) {
        showMessage('Failed to switch view.', 'error', 3000);
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
        showMessage('Failed to switch view.', 'error', 3000);
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
        showMessage('Failed to switch view.', 'error', 3000);
      }
    };
    eventListeners.add(monthViewBtn, 'click', handler);
  }
  
  const startDateInput = safeGetElementById('eventStartDate');
  const startHourInput = safeGetElementById('eventStartHour');
  const startMinuteInput = safeGetElementById('eventStartMinute');
  const endDateInput = safeGetElementById('eventEndDate');
  const endHourInput = safeGetElementById('eventEndHour');
  const endMinuteInput = safeGetElementById('eventEndMinute');
  const allDayCheckbox = safeGetElementById('eventAllDay');
  const allDayRow = safeGetElementById('allDayDateRow');
  const allDayStartInput = safeGetElementById('eventAllDayStart');
  const allDayEndInput = safeGetElementById('eventAllDayEnd');

  if (allDayCheckbox) {
    const handler = () => {
      try {
      if (allDayCheckbox.disabled) return;
      const isAllDay = allDayCheckbox.checked;
      applyAllDayMode(isAllDay, { 
        startInput: startDateInput, 
        endInput: endDateInput, 
        allDayRow,
        startHourInput,
        startMinuteInput,
        endHourInput,
        endMinuteInput
      });
      if (isAllDay) {
        if (allDayStartInput && !allDayStartInput.value) {
          const startISO = getDateTimeAsISO(startDateInput, startHourInput, startMinuteInput);
          if (startISO) {
            allDayStartInput.value = formatDateOnly(startISO);
          } else {
            allDayStartInput.value = formatDateOnly(new Date());
          }
        }
        if (allDayEndInput && !allDayEndInput.value) {
          allDayEndInput.value = allDayStartInput.value;
        }
      }
      } catch (error) {
        showMessage('Failed to configure all-day event.', 'error', 3000);
      }
    };
    eventListeners.add(allDayCheckbox, 'change', handler);
  }
  
  // Auto-sync end time when start time changes
  if (startDateInput && startHourInput && startMinuteInput && endDateInput && endHourInput && endMinuteInput) {
    let isUpdating = false;
    let userEditingEndTime = false;
    
    // Validate and round minute inputs to 15-minute increments
    const validateMinuteInput = (input) => {
      if (!input || !input.value) return;
      const value = parseInt(input.value, 10);
      if (!Number.isNaN(value)) {
        // Round to nearest 15 minutes
        const rounded = Math.round(value / 15) * 15;
        if (rounded < 0) input.value = 0;
        else if (rounded > 45) input.value = 45;
        else input.value = rounded;
      }
    };
    
    // Validate hour inputs (0-23)
    const validateHourInput = (input) => {
      if (!input || !input.value) return;
      const value = parseInt(input.value, 10);
      if (!Number.isNaN(value)) {
        if (value < 0) input.value = 0;
        else if (value > 23) input.value = 23;
      }
    };
    
    // Add validation listeners
    eventListeners.add(startMinuteInput, 'blur', () => validateMinuteInput(startMinuteInput));
    eventListeners.add(endMinuteInput, 'blur', () => validateMinuteInput(endMinuteInput));
    eventListeners.add(startHourInput, 'blur', () => validateHourInput(startHourInput));
    eventListeners.add(endHourInput, 'blur', () => validateHourInput(endHourInput));
    
    // Track when user manually edits end time
    const endTimeInputHandler = () => {
      userEditingEndTime = true;
      setTimeout(() => {
        userEditingEndTime = false;
      }, 1000);
    };
    eventListeners.add(endDateInput, 'change', endTimeInputHandler);
    eventListeners.add(endHourInput, 'input', endTimeInputHandler);
    eventListeners.add(endMinuteInput, 'input', endTimeInputHandler);
    
    const syncEndTime = () => {
      if (isUpdating || userEditingEndTime) return;
      
      const startISO = getDateTimeAsISO(startDateInput, startHourInput, startMinuteInput);
      if (!startISO) return;
      
      const startDate = new Date(startISO);
      if (Number.isNaN(startDate.getTime())) return;
      
      // Get current end time to preserve duration
      const endISO = getDateTimeAsISO(endDateInput, endHourInput, endMinuteInput);
      let duration = 60 * 60 * 1000; // Default 1 hour
      if (endISO) {
        const endDate = new Date(endISO);
        if (!Number.isNaN(endDate.getTime()) && endDate > startDate) {
          duration = endDate.getTime() - startDate.getTime();
        }
      }
      
      // Set end time maintaining duration
      const newEnd = new Date(startDate.getTime() + duration);
      setDateTimeFromISO(endDateInput, endHourInput, endMinuteInput, newEnd.toISOString());
    };
    
    eventListeners.add(startDateInput, 'change', syncEndTime);
    eventListeners.add(startHourInput, 'input', syncEndTime);
    eventListeners.add(startMinuteInput, 'input', syncEndTime);
  }
  
  const dayAllDayContainer = safeGetElementById('dayAllDayContainer');
  if (dayAllDayContainer) {
    const handler = () => {
      try {
      openAllDayCreateModal(new Date(currentDate));
      } catch (error) {
        showMessage('Failed to create all-day event.', 'error', 3000);
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
        showMessage('Failed to create all-day event.', 'error', 3000);
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
      showMessage('Failed to select date.', 'error', 3000);
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
  
  // Modal related
  const closeModalBtn = safeGetElementById('closeModal');
  if (closeModalBtn) {
    eventListeners.add(closeModalBtn, 'click', closeEventModal);
  }
  
  // Close modal on outside click
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
  
  // Close modal with ESC key
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
  
  // Form submission
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
      updateCrudStatusIndicator('processing');

      const formData = new FormData(e.target);
      const isAllDay = formData.get('allDay') === 'on';
      
      // Sanitize input values
      const title = sanitizeTextInput(formData.get('title') || '');
      const description = sanitizeTextInput(formData.get('description') || '');
      
      // Get date + time input values and convert to ISO format
      const startDate = formData.get('startDate') || '';
      const startHour = formData.get('startHour') || '';
      const startMinute = formData.get('startMinute') || '';
      const endDate = formData.get('endDate') || '';
      const endHour = formData.get('endHour') || '';
      const endMinute = formData.get('endMinute') || '';
      
      const startDateInput = safeGetElementById('eventStartDate');
      const startHourInput = safeGetElementById('eventStartHour');
      const startMinuteInput = safeGetElementById('eventStartMinute');
      const endDateInput = safeGetElementById('eventEndDate');
      const endHourInput = safeGetElementById('eventEndHour');
      const endMinuteInput = safeGetElementById('eventEndMinute');
      
      const event = {
        title: title,
        description: description,
        startTime: getDateTimeAsISO(startDateInput, startHourInput, startMinuteInput),
        endTime: getDateTimeAsISO(endDateInput, endHourInput, endMinuteInput),
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
    
      // Validation
      const errors = validateEvent(event);
      if (errors.length > 0) {
        updateCrudStatusIndicator('error');
        showMessage(errors.join(' / '), 'error', 6000);
        delete eventForm.dataset.submitting;
        return;
      }
      
      // Save editingEventId before closing (closeEventModal clears it)
      const wasEditing = editingEventId ? true : false;
      const eventIdToProcess = editingEventId;
      
      // Close modal immediately after validation passes (before async operations)
      let modalClosed = false;
      try {
        closeEventModal();
        modalClosed = true;
      } catch (closeError) {
        console.error('Error in closeEventModal:', closeError);
      }
      
      // Fallback: Direct DOM manipulation if closeEventModal didn't work
      if (!modalClosed) {
        try {
          const modal = safeGetElementById('eventModal');
          if (modal) {
            modal.classList.remove('show');
            modal.setAttribute('aria-hidden', 'true');
            document.body.classList.remove('modal-open');
            modalClosed = true;
          }
        } catch (error) {
          console.error('Error in direct modal close:', error);
        }
      }
      
      // Final fallback
      if (!modalClosed) {
        try {
          const modal = document.getElementById('eventModal');
          if (modal) {
            modal.classList.remove('show');
            modal.setAttribute('aria-hidden', 'true');
            document.body.classList.remove('modal-open');
          }
          const eventForm = document.getElementById('eventForm');
          if (eventForm) {
            delete eventForm.dataset.submitting;
          }
          editingEventId = null;
        } catch (error) {
          console.error('Error in fallback modal close:', error);
        }
      }
      
      if (eventIdToProcess && typeof eventIdToProcess === 'string' && eventIdToProcess.startsWith('temp-')) {
        // Convert temporary event to formal event
        if (!Array.isArray(events)) {
          updateCrudStatusIndicator('error');
          showMessage('Failed to save event.', 'error', 6000);
          delete eventForm.dataset.submitting;
          return;
        }
        const tempEventIndex = events.findIndex(e => e.id === eventIdToProcess);
        if (tempEventIndex !== -1) {
          // Delete temporary event
          events.splice(tempEventIndex, 1);
        }
        
        // Create new event
        // Note: addEvent will generate its own ID, so we don't set id here
        // If recurrence is set, create multiple individual events
        if (event.recurrence && event.recurrence !== 'none' && event.recurrenceEnd) {
          const occurrences = generateRecurrenceOccurrences(
            event.startTime,
            event.endTime,
            event.recurrence,
            event.recurrenceEnd
          );
          
          if (occurrences.length > 0) {
            // Generate a unique series ID for this recurring event series
            const recurringSeriesId = generateId();
            
            // Create an event for each occurrence
            let createdCount = 0;
            for (const occurrence of occurrences) {
              const occurrenceEvent = {
                title: event.title,
                description: event.description,
                startTime: formatDateTimeLocal(occurrence.startTime),
                endTime: formatDateTimeLocal(occurrence.endTime),
                allDay: event.allDay === true,
                color: event.color,
                reminderMinutes: event.reminderMinutes,
                recurringSeriesId: recurringSeriesId, // Link all occurrences together
              };
              
              const newId = await addEvent(occurrenceEvent);
              if (newId) {
                createdCount++;
                if (!isFirebaseEnabled) {
                  // Add to local array only if Firebase is disabled
                  const newEvent = { ...occurrenceEvent, id: newId, createdAt: new Date().toISOString() };
                  events.push(newEvent);
                }
              }
            }
            
            if (createdCount === 0) {
              throw new Error('Failed to create recurring events');
            }
          } else {
            // Fallback: create single event if no occurrences generated
            const newEvent = {
              title: event.title,
              description: event.description,
              startTime: event.startTime,
              endTime: event.endTime,
              allDay: event.allDay === true,
              color: event.color,
              reminderMinutes: event.reminderMinutes,
              createdAt: new Date().toISOString()
            };
            
            const newId = await addEvent(newEvent);
            if (!newId) {
              throw new Error('Failed to add event');
            }
            if (!isFirebaseEnabled) {
              newEvent.id = newId;
              events.push(newEvent);
            }
          }
        } else {
          // No recurrence: create single event
          const newEvent = {
            title: event.title,
            description: event.description,
            startTime: event.startTime,
            endTime: event.endTime,
            allDay: event.allDay === true,
            color: event.color,
            reminderMinutes: event.reminderMinutes,
            createdAt: new Date().toISOString()
          };
          
          const newId = await addEvent(newEvent);
          if (!newId) {
            throw new Error('Failed to add event');
          }
          if (!isFirebaseEnabled) {
            newEvent.id = newId;
            events.push(newEvent);
          }
        }
      } else if (eventIdToProcess) {
        // Update existing event
        const existingEvent = Array.isArray(events) ? events.find(e => e.id === eventIdToProcess) : null;
        if (!existingEvent) {
          throw new Error('Event not found');
        }
        
        // Check if bulk operation is requested
        const recurringSeriesOptions = safeGetElementById('recurringSeriesOptions');
        const actionType = recurringSeriesOptions && 
          !recurringSeriesOptions.classList.contains('hidden')
          ? recurringSeriesOptions.querySelector('input[name="recurringSeriesAction"]:checked')?.value || 'single'
          : 'single';
        
        if (existingEvent.recurringSeriesId) {
          if (actionType === 'all') {
            // Bulk update all events in the series
            const result = await updateRecurringSeries(existingEvent.recurringSeriesId, {
              title: event.title,
              description: event.description,
              color: event.color,
              reminderMinutes: event.reminderMinutes,
              // Note: startTime and endTime are not updated in bulk operations
              // as each occurrence has its own time
            });
            
            if (result.updated === 0) {
              throw new Error('Failed to update recurring events');
            }
          } else if (actionType === 'thisAndFuture') {
            // Update this event and all subsequent events
            const result = await updateThisAndSubsequentEvents(eventIdToProcess, existingEvent.recurringSeriesId, {
              title: event.title,
              description: event.description,
              color: event.color,
              reminderMinutes: event.reminderMinutes,
              // Note: startTime and endTime are not updated in bulk operations
              // as each occurrence has its own time
            });
            
            if (result.updated === 0) {
              throw new Error('Failed to update recurring events');
            }
          } else {
            // Update single event
            const updateSuccess = await updateEvent(eventIdToProcess, event);
            if (!updateSuccess) {
              throw new Error('Failed to update event');
            }
            // Also update local array (may be overwritten by Firebase real-time update, but for immediate UI update)
            if (Array.isArray(events)) {
              const eventIndex = events.findIndex(e => e.id === eventIdToProcess);
              if (eventIndex !== -1) {
                events[eventIndex] = {
                  ...events[eventIndex],
                  title: event.title,
                  description: event.description,
                  startTime: event.startTime,
                  endTime: event.endTime,
                  allDay: event.allDay === true,
                  color: event.color,
                  reminderMinutes: event.reminderMinutes,
                  updatedAt: new Date().toISOString()
                };
              }
            }
          }
        } else {
          // Not a recurring event - update single event
          const updateSuccess = await updateEvent(eventIdToProcess, event);
          if (!updateSuccess) {
            throw new Error('Failed to update event');
          }
          // Also update local array (may be overwritten by Firebase real-time update, but for immediate UI update)
          if (Array.isArray(events)) {
            const eventIndex = events.findIndex(e => e.id === eventIdToProcess);
            if (eventIndex !== -1) {
              events[eventIndex] = {
                ...events[eventIndex],
                title: event.title,
                description: event.description,
                startTime: event.startTime,
                endTime: event.endTime,
                allDay: event.allDay === true,
                color: event.color,
                reminderMinutes: event.reminderMinutes,
                updatedAt: new Date().toISOString()
              };
            }
          }
        }
      } else {
        // Create new event
        // If recurrence is set, create multiple individual events
        if (event.recurrence && event.recurrence !== 'none' && event.recurrenceEnd) {
          const occurrences = generateRecurrenceOccurrences(
            event.startTime,
            event.endTime,
            event.recurrence,
            event.recurrenceEnd
          );
          
          if (occurrences.length > 0) {
            // Generate a unique series ID for this recurring event series
            const recurringSeriesId = generateId();
            
            // Create an event for each occurrence
            let createdCount = 0;
            for (const occurrence of occurrences) {
              const occurrenceEvent = {
                title: event.title,
                description: event.description,
                startTime: formatDateTimeLocal(occurrence.startTime),
                endTime: formatDateTimeLocal(occurrence.endTime),
                allDay: event.allDay,
                color: event.color,
                reminderMinutes: event.reminderMinutes,
                recurringSeriesId: recurringSeriesId, // Link all occurrences together
              };
              
              const newId = await addEvent(occurrenceEvent);
              if (newId) {
                createdCount++;
                if (!isFirebaseEnabled) {
                  // Add to local array only if Firebase is disabled
                  const newEvent = { ...occurrenceEvent, id: newId, createdAt: new Date().toISOString() };
                  events.push(newEvent);
                }
              }
            }
            
            if (createdCount === 0) {
              throw new Error('Failed to create recurring events');
            }
          } else {
            // Fallback: create single event if no occurrences generated
            const newId = await addEvent(event);
            if (!newId) {
              throw new Error('Failed to add event');
            }
            if (!isFirebaseEnabled) {
              const newEvent = { ...event, id: newId, createdAt: new Date().toISOString() };
              events.push(newEvent);
            }
          }
        } else {
          // No recurrence: create single event
          const newId = await addEvent(event);
          if (!newId) {
            throw new Error('Failed to add event');
          }
          if (!isFirebaseEnabled) {
            // Add to local array only if Firebase is disabled
            const newEvent = { ...event, id: newId, createdAt: new Date().toISOString() };
            events.push(newEvent);
          }
        }
      }
      
      updateCrudStatusIndicator('success');
      showMessage(wasEditing ? 'Event updated' : 'Event added', 'success', 3000);
    } catch (error) {
      updateCrudStatusIndicator('error');
      showMessage('Failed to save event. Please try again.', 'error', 6000);
    } finally {
      // Reset submission flag
      delete eventForm.dataset.submitting;
    }
  };
  eventListeners.add(eventForm, 'submit', submitHandler);
  
  // Delete button
  const deleteBtn = safeGetElementById('deleteBtn');
  if (deleteBtn) {
    const deleteHandler = async () => {
      if (!editingEventId) return;
      
      // Save the event ID before closing modal (closeEventModal clears editingEventId)
      const eventIdToDelete = editingEventId;
      const eventToDelete = Array.isArray(events) ? events.find(e => e.id === eventIdToDelete) : null;
      
      if (!eventToDelete) return;
      
      // Check if bulk operation is requested
      const recurringSeriesOptions = safeGetElementById('recurringSeriesOptions');
      const actionType = recurringSeriesOptions && 
        !recurringSeriesOptions.classList.contains('hidden')
        ? recurringSeriesOptions.querySelector('input[name="recurringSeriesAction"]:checked')?.value || 'single'
        : 'single';
      
      let confirmMessage = 'Are you sure you want to delete this event?';
      if (eventToDelete.recurringSeriesId) {
        if (actionType === 'all') {
          const seriesEvents = findRecurringSeriesEvents(eventToDelete.recurringSeriesId);
          confirmMessage = `Are you sure you want to delete all ${seriesEvents.length} events in this series?`;
        } else if (actionType === 'thisAndFuture') {
          const targetEvents = findThisAndSubsequentEvents(eventIdToDelete, eventToDelete.recurringSeriesId);
          confirmMessage = `Are you sure you want to delete this event and ${targetEvents.length - 1} subsequent event(s)?`;
        }
      }
      
      const confirmed = await showConfirmModal(confirmMessage, 'Confirm Deletion');
      if (confirmed) {
        // Close event modal immediately after confirmation
        try {
          closeEventModal();
        } catch (closeError) {
          console.error('Error closing modal:', closeError);
          // Force close modal as fallback
          const modal = safeGetElementById('eventModal');
          if (modal) {
            modal.classList.remove('show');
            modal.setAttribute('aria-hidden', 'true');
            document.body.classList.remove('modal-open');
          }
        }
        
        try {
          updateCrudStatusIndicator('processing');
          
          if (eventToDelete.recurringSeriesId) {
            if (actionType === 'all') {
              // Bulk delete all events in the series
              const result = await deleteRecurringSeries(eventToDelete.recurringSeriesId);
              if (result.deleted > 0) {
                updateCrudStatusIndicator('success');
                showMessage(`Deleted ${result.deleted} events.`, 'success', 3000);
              } else {
                updateCrudStatusIndicator('error');
                showMessage('Failed to delete events.', 'error', 6000);
              }
            } else if (actionType === 'thisAndFuture') {
              // Delete this event and all subsequent events
              const result = await deleteThisAndSubsequentEvents(eventIdToDelete, eventToDelete.recurringSeriesId);
              if (result.deleted > 0) {
                updateCrudStatusIndicator('success');
                showMessage(`Deleted ${result.deleted} event(s).`, 'success', 3000);
              } else {
                updateCrudStatusIndicator('error');
                showMessage('Failed to delete events.', 'error', 6000);
              }
            } else {
              // Delete single event
              const deleteSuccess = await deleteEvent(eventIdToDelete);
              if (!deleteSuccess) {
                throw new Error('Failed to delete event');
              }
              updateCrudStatusIndicator('success');
              showMessage('Event deleted', 'success', 3000);
            }
          } else {
            // Not a recurring event - delete single event
            const deleteSuccess = await deleteEvent(eventIdToDelete);
            if (!deleteSuccess) {
              throw new Error('Failed to delete event');
            }
            updateCrudStatusIndicator('success');
            showMessage('Event deleted', 'success', 3000);
          }
        } catch (error) {
          updateCrudStatusIndicator('error');
          showMessage('Failed to delete event.', 'error', 6000);
        }
      }
    };
    eventListeners.add(deleteBtn, 'click', deleteHandler);
  }
  
  // Handle recurrence selection
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

// Click/range selection creation on day grid
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
    // Exclude existing event clicks
    if (e.target.closest('.event-item')) return;
    // Exclude resize handle clicks
    if (e.target.classList.contains('resize-handle')) return;

    e.preventDefault();
    isSelecting = true;
    hasMoved = false;
    container.classList.add('selecting');

    const rect = container.getBoundingClientRect();
    const offsetY = e.clientY - rect.top + container.scrollTop;
    selectionStart = offsetY;
    startTime = Date.now();

    // Create selection preview element
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
    
    // Remove selection preview
    if (selectionPreview && selectionPreview.parentNode) {
      selectionPreview.remove();
    }
    document.removeEventListener('mousemove', onMouseMove);
    selectionPreview = null;

    // Round to 15-minute intervals
    const hourHeight = getHourHeight();
    const quarterHourHeight = hourHeight / 4; // Height of 15 minutes
    const minutesFromTopStart = Math.max(0, Math.round(startY / hourHeight * 60 / 15) * 15);
    const minutesFromTopEnd = Math.max(0, Math.round(endY / hourHeight * 60 / 15) * 15);
    
    const baseDate = new Date(currentDate);
    baseDate.setHours(0, 0, 0, 0);
    const startTotalMinutes = VISIBLE_START_HOUR * 60 + minutesFromTopStart;
    const endTotalMinutes = VISIBLE_START_HOUR * 60 + minutesFromTopEnd;
    const start = new Date(baseDate.getTime() + startTotalMinutes * 60 * 1000);
    
    // Create 2-hour event on click (no movement)
    let end;
    if (!hasMoved || (endY - startY) < quarterHourHeight) { // Movement less than 15 minutes is considered a click
      end = new Date(start.getTime() + 2 * 60 * 60 * 1000); // 2 hours
    } else {
      const clampedEndTotalMinutes = Math.max(startTotalMinutes + 15, Math.min(endTotalMinutes, (VISIBLE_END_HOUR + 1) * 60));
      end = new Date(baseDate.getTime() + clampedEndTotalMinutes * 60 * 1000);
    }

    // Create and display temporary event
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

    // Add temporary event to array
    events.push(tempEvent);
    tempEventId = tempEvent.id;

    // Update views (display temporary event)
    updateViews();

    // Open modal with default values
    showEventModal(tempEventId);
    const startDateInput = safeGetElementById('eventStartDate');
    const startHourInput = safeGetElementById('eventStartHour');
    const startMinuteInput = safeGetElementById('eventStartMinute');
    const endDateInput = safeGetElementById('eventEndDate');
    const endHourInput = safeGetElementById('eventEndHour');
    const endMinuteInput = safeGetElementById('eventEndMinute');
    setDateTimeFromISO(startDateInput, startHourInput, startMinuteInput, start.toISOString());
    setDateTimeFromISO(endDateInput, endHourInput, endMinuteInput, end.toISOString());
  }
}

function openAllDayCreateModal(date) {
  const isoDate = formatDateOnly(date);
  const allDayCheckbox = safeGetElementById('eventAllDay');
  const allDayRow = safeGetElementById('allDayDateRow');
  const allDayStartInput = safeGetElementById('eventAllDayStart');
  const allDayEndInput = safeGetElementById('eventAllDayEnd');
  
  // Open modal in new creation mode (form will be cleared)
  showEventModal();
  
  // Set all-day mode
  if (allDayCheckbox) {
    allDayCheckbox.checked = true;
  }
  const startDateInput = safeGetElementById('eventStartDate');
  const startHourInput = safeGetElementById('eventStartHour');
  const startMinuteInput = safeGetElementById('eventStartMinute');
  const endDateInput = safeGetElementById('eventEndDate');
  const endHourInput = safeGetElementById('eventEndHour');
  const endMinuteInput = safeGetElementById('eventEndMinute');
  applyAllDayMode(true, {
    startInput: startDateInput,
    endInput: endDateInput,
    allDayRow,
    startHourInput,
    startMinuteInput,
    endHourInput,
    endMinuteInput
  });
  
  // Set all-day event date
  if (allDayStartInput) allDayStartInput.value = isoDate;
  if (allDayEndInput) allDayEndInput.value = isoDate;
  
  // Just in case, explicitly clear title and description (so previous values don't remain)
  const titleInput = safeGetElementById('eventTitle');
  const descInput = safeGetElementById('eventDescription');
  if (titleInput) titleInput.value = '';
  if (descInput) descInput.value = '';
}

// Click/range selection creation on week grid
function enableWeekGridClickToCreate() {
  const dayContainers = document.querySelectorAll('.week-day .day-events-container');
  
  dayContainers.forEach((container, dayIndex) => {
    let isSelecting = false;
    let selectionStart = null;
    let selectionPreview = null;
    let hasMoved = false;
    let tempEventId = null;

    container.addEventListener('mousedown', (e) => {
      // Exclude existing event clicks
      if (e.target.closest('.event-item')) return;
      // Exclude resize handle clicks
      if (e.target.classList.contains('resize-handle')) return;

      e.preventDefault();
      isSelecting = true;
      hasMoved = false;
      container.classList.add('selecting');

      const rect = container.getBoundingClientRect();
      const offsetY = e.clientY - rect.top + container.scrollTop;
      selectionStart = offsetY;

      // Create selection preview element
      selectionPreview = document.createElement('div');
      selectionPreview.className = 'selection-preview';
      selectionPreview.style.top = `${offsetY}px`;
      selectionPreview.style.height = '0px';
      container.appendChild(selectionPreview);

      const onMouseMove = (e) => {
        if (!isSelecting || !selectionPreview) return;

        hasMoved = true;

        const rect = container.getBoundingClientRect();
        const offsetY = e.clientY - rect.top + container.scrollTop;
        
        const startY = Math.min(selectionStart, offsetY);
        const endY = Math.max(selectionStart, offsetY);
        
        selectionPreview.style.top = `${startY}px`;
        selectionPreview.style.height = `${endY - startY}px`;
      };

      const onMouseUp = (e) => {
        if (!isSelecting || !selectionPreview) return;

        isSelecting = false;
        container.classList.remove('selecting');
        
        const rect = container.getBoundingClientRect();
        const offsetY = e.clientY - rect.top + container.scrollTop;
        
        const startY = Math.min(selectionStart, offsetY);
        const endY = Math.max(selectionStart, offsetY);
        
        // Remove selection preview
        if (selectionPreview && selectionPreview.parentNode) {
          selectionPreview.remove();
        }
        document.removeEventListener('mousemove', onMouseMove);
        selectionPreview = null;

        // Round to 15-minute intervals
        const hourHeight = getHourHeight();
        const quarterHourHeight = hourHeight / 4; // Height of 15 minutes
        const minutesFromTopStart = Math.max(0, Math.round(startY / hourHeight * 60 / 15) * 15);
        const minutesFromTopEnd = Math.max(0, Math.round(endY / hourHeight * 60 / 15) * 15);
        
        const referenceWeekStart = getWeekStart(currentDate);
        const clickedDate = new Date(referenceWeekStart);
        clickedDate.setDate(referenceWeekStart.getDate() + dayIndex);
        clickedDate.setHours(0, 0, 0, 0);
        
        const startTotalMinutes = VISIBLE_START_HOUR * 60 + minutesFromTopStart;
        const endTotalMinutes = VISIBLE_START_HOUR * 60 + minutesFromTopEnd;
        const start = new Date(clickedDate.getTime() + startTotalMinutes * 60 * 1000);
        
        // Create 2-hour event on click (no movement)
        let end;
        if (!hasMoved || (endY - startY) < quarterHourHeight) { // Movement less than 15 minutes is considered a click
          end = new Date(start.getTime() + 2 * 60 * 60 * 1000); // 2 hours
        } else {
          const clampedEndTotalMinutes = Math.max(startTotalMinutes + 15, Math.min(endTotalMinutes, (VISIBLE_END_HOUR + 1) * 60));
          end = new Date(clickedDate.getTime() + clampedEndTotalMinutes * 60 * 1000);
        }

        // Create and display temporary event
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

        // Add temporary event to array
        events.push(tempEvent);
        tempEventId = tempEvent.id;

        // Update views (display temporary event)
        updateViews();

        // Open modal with default values
        showEventModal(tempEventId);
        const startDateInput = safeGetElementById('eventStartDate');
        const startHourInput = safeGetElementById('eventStartHour');
        const startMinuteInput = safeGetElementById('eventStartMinute');
        const endDateInput = safeGetElementById('eventEndDate');
        const endHourInput = safeGetElementById('eventEndHour');
        const endMinuteInput = safeGetElementById('eventEndMinute');
        setDateTimeFromISO(startDateInput, startHourInput, startMinuteInput, start.toISOString());
        setDateTimeFromISO(endDateInput, endHourInput, endMinuteInput, end.toISOString());
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp, { once: true });
    });
  });
}

// Resize (top/bottom) handling and drag move handling
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
    
    const isMobile = window.innerWidth <= 640; // Execute mobile detection for each item
    
    // Hide resize handles on mobile
    if (isMobile) {
      topHandle.style.display = 'none';
      bottomHandle.style.display = 'none';
    }

    let startY = 0;
    let originalStart = null;
    let originalEnd = null;
    let resizing = null; // 'top' | 'bottom' | 'move'
    let originalTop = 0;

    // Mouse down for resize handles
    function onMouseDown(handle, edge) {
      return (e) => {
        e.stopPropagation();
        const ev = Array.isArray(events) ? events.find(ev => ev.id === id) : null;
        if (!ev || !ev.startTime || !ev.endTime) return;
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

    // Mouse down for event body drag movement
    function onEventMouseDown(e) {
      // Exclude resize handle clicks
      if (e.target.classList.contains('resize-handle')) return;
      
      e.stopPropagation();
      const ev = Array.isArray(events) ? events.find(ev => ev.id === id) : null;
      if (!ev || !ev.startTime || !ev.endTime) return;
      const startDate = new Date(ev.startTime);
      const endDate = new Date(ev.endTime);
      if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return;
      
      
      startY = e.clientY;
      originalStart = startDate;
      originalEnd = endDate;
      originalTop = parseFloat(item.style.top) || 0;
      resizing = 'move';
      item.classList.add('dragging');
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp, { once: true });
    }

    // Function for touch events
    function onEventTouchStart(e) {
      // Exclude resize handle clicks
      if (e.target.classList.contains('resize-handle')) return;
      
      e.preventDefault(); // Prevent scrolling
      e.stopPropagation();
      const ev = Array.isArray(events) ? events.find(ev => ev.id === id) : null;
      if (!ev) return;
      
      
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
      const hourHeight = getHourHeight();
      const dy = e.clientY - startY;
      const minutesDelta = Math.round(dy / hourHeight * 60 / 15) * 15; // Round to 15-minute intervals
      
      if (resizing === 'top') {
        const newStart = new Date(originalStart.getTime() + minutesDelta * 60000);
        if (newStart < originalEnd) {
          // Preview: Update position and height (considering VISIBLE_START_HOUR)
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
          // Preview: Update height (considering VISIBLE_START_HOUR)
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
        // Preview of drag movement
        const newTop = originalTop + dy;
        if (newTop >= 0) {
          item.style.top = `${newTop}px`;
        }
      }
    }

    function onTouchMove(e) {
      e.preventDefault(); // Prevent scrolling
      if (!e.touches || e.touches.length === 0) return;
      const touch = e.touches[0];
      const dy = touch.clientY - startY;
      
      if (resizing === 'move') {
        // Preview of drag movement
        const newTop = originalTop + dy;
        if (newTop >= 0) {
          item.style.top = `${newTop}px`;
        }
      }
    }

    async function onMouseUp(e) {
      // Ensure event listener is removed (using {once: true} but removing just in case)
      document.removeEventListener('mousemove', onMouseMove);
      item.classList.remove('resizing', 'dragging');
      
      // Save state (before reset)
      const currentResizing = resizing;
      const currentStartY = startY;
      
      // Reset state
      resizing = null;
      startY = 0;
      originalStart = null;
      originalEnd = null;
      originalTop = 0;

      const hourHeight = getHourHeight();
      const dy = e.clientY - currentStartY;
      const minutesDelta = Math.round(dy / hourHeight * 60 / 15) * 15; // Round to 15-minute intervals
      const ev = Array.isArray(events) ? events.find(ev => ev.id === id) : null;
      if (!ev) return;


      // Click (no movement) opens detail modal
      if (currentResizing === 'move' && minutesDelta === 0) {
        showEventModal(id);
        return;
      }

      // Calculate new time
      let newStartTime = ev.startTime;
      let newEndTime = ev.endTime;
      
      // Disable resize on mobile
      if (isMobile && (currentResizing === 'top' || currentResizing === 'bottom')) {
        return; // Ignore resize operation
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
        // Handle drag movement
        const newStart = new Date(new Date(ev.startTime).getTime() + minutesDelta * 60000);
        const newEnd = new Date(new Date(ev.endTime).getTime() + minutesDelta * 60000);
        
        // Cannot move before 0:00 (considering VISIBLE_START_HOUR)
        const newStartMinutes = newStart.getHours() * 60 + newStart.getMinutes();
        const minAllowedMinutes = VISIBLE_START_HOUR * 60;
        if (newStartMinutes >= minAllowedMinutes) {
          newStartTime = formatDateTimeLocal(newStart);
          newEndTime = formatDateTimeLocal(newEnd);
        }
      }
      
      // Don't update if time hasn't changed
      if (newStartTime === ev.startTime && newEndTime === ev.endTime) {
        return;
      }
      
      try {
        updateCrudStatusIndicator('processing');
        await updateEvent(id, {
          title: ev.title,
          description: ev.description || '',
          startTime: newStartTime,
          endTime: newEndTime,
          color: ev.color
        });
        updateCrudStatusIndicator('success');
      } catch (error) {
        updateCrudStatusIndicator('error');
        showMessage('Failed to update event.', 'error', 6000);
      }
    }

    async function onTouchEnd(e) {
      // Ensure event listener is removed (using {once: true} but removing just in case)
      document.removeEventListener('touchmove', onTouchMove);
      item.classList.remove('resizing', 'dragging');
      
      // Save state (before reset)
      const currentResizing = resizing;
      const currentStartY = startY;
      
      // Reset state
      resizing = null;
      startY = 0;
      originalStart = null;
      originalEnd = null;
      originalTop = 0;

      if (!e.changedTouches || e.changedTouches.length === 0) return;
      const hourHeight = getHourHeight();
      const touch = e.changedTouches[0];
      const dy = touch.clientY - currentStartY;
      const minutesDelta = Math.round(dy / hourHeight * 60 / 15) * 15; // Round to 15-minute intervals
      const ev = Array.isArray(events) ? events.find(ev => ev.id === id) : null;
      if (!ev) return;


      // Click (no movement) opens detail modal
      if (currentResizing === 'move' && minutesDelta === 0) {
        showEventModal(id);
        return;
      }

      // Calculate new time
      let newStartTime = ev.startTime;
      let newEndTime = ev.endTime;
      
      if (currentResizing === 'move') {
        // Handle drag movement
        const newStart = new Date(new Date(ev.startTime).getTime() + minutesDelta * 60000);
        const newEnd = new Date(new Date(ev.endTime).getTime() + minutesDelta * 60000);
        
        // Cannot move before 0:00 (considering VISIBLE_START_HOUR)
        const newStartMinutes = newStart.getHours() * 60 + newStart.getMinutes();
        const minAllowedMinutes = VISIBLE_START_HOUR * 60;
        if (newStartMinutes >= minAllowedMinutes) {
          newStartTime = formatDateTimeLocal(newStart);
          newEndTime = formatDateTimeLocal(newEnd);
        }
      }
      
      // Don't update if time hasn't changed
      if (newStartTime === ev.startTime && newEndTime === ev.endTime) {
        return;
      }
      
      try {
        updateCrudStatusIndicator('processing');
        await updateEvent(id, {
          title: ev.title,
          description: ev.description || '',
          startTime: newStartTime,
          endTime: newEndTime,
          color: ev.color
        });
        updateCrudStatusIndicator('success');
      } catch (error) {
        updateCrudStatusIndicator('error');
        showMessage('Failed to update event.', 'error', 6000);
      }
    }

    // Remove existing event listeners (prevent duplicate registration)
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
    
    // Save new event listeners
    item._existingMouseDown = onEventMouseDown;
    item._existingTouchStart = onEventTouchStart;

    // Don't add event listeners for resize handles on mobile
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
    
    // Add drag movement event listener to event body
    item.addEventListener('mousedown', onEventMouseDown);
    item.addEventListener('touchstart', onEventTouchStart);
  });
}

