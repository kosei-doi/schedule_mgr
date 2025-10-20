// グローバル変数
let events = [];
let currentDate = new Date();
let currentView = 'day'; // 'day', 'week', or 'month'
let editingEventId = null;
let isFirebaseEnabled = false;
let isGoogleCalendarEnabled = false;
let googleAccessToken = null;

// Firebase接続チェック（combiと同じロジック）
function checkFirebase() {
  try {
    if (typeof window.firebase !== 'undefined' && window.firebase.db) {
      isFirebaseEnabled = true;
      console.log('Firebase v11 Realtime Database が有効です');
      return true;
    }
  } catch (e) {
    console.warn('Firebase が利用できません。ローカルモードで動作します。', e);
  }
  isFirebaseEnabled = false;
  return false;
}

// イベントを読み込む関数（combiと同じロジック）
function loadEvents() {
  if (!isFirebaseEnabled) {
    console.log('Firebaseが無効な場合はローカルストレージから読み込み');
    loadEventsFromLocalStorage();
    return;
  }
  
  const eventsRef = window.firebase.ref(window.firebase.db, "events");
  window.firebase.onValue(eventsRef, (snapshot) => {
    const data = snapshot.val();
    if (data) {
      events = Object.keys(data).map(key => ({
        id: key,
        ...data[key]
      }));
      // 開始時刻でソート
      events.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
      console.log('Firebaseからイベントを読み込み:', events.length, '件');
    } else {
      events = [];
      console.log('イベントデータがありません');
    }
    updateViews();
  });
}

// ローカルストレージから読み込み（フォールバック）
function loadEventsFromLocalStorage() {
  try {
    const stored = localStorage.getItem('schedule_events');
    if (stored) {
      const data = JSON.parse(stored);
      events = data.events || [];
      console.log('ローカルストレージから読み込み:', events.length, '件');
    } else {
      events = [];
      console.log('ローカルストレージにデータがありません');
    }
  } catch (error) {
    console.error('ローカルストレージ読み込みエラー:', error);
    events = [];
  }
  updateViews();
}

// イベントを追加（combiと同じロジック）
function addEvent(event) {
  const newEvent = {
    ...event,
    createdAt: new Date().toISOString()
  };

  if (!isFirebaseEnabled) {
    // ローカルストレージの場合
    newEvent.id = generateId();
    events.push(newEvent);
    saveEventsToLocalStorage();
    updateViews();
    return newEvent.id;
  }

  const eventsRef = window.firebase.ref(window.firebase.db, "events");
  const newEventRef = window.firebase.push(eventsRef);
  window.firebase.set(newEventRef, newEvent);
  console.log('Firebaseにイベントを追加:', newEventRef.key);
  return newEventRef.key;
}

// イベントを更新（combiと同じロジック）
function updateEvent(id, event) {
  const updatedEvent = {
    ...event,
    updatedAt: new Date().toISOString()
  };

  if (!isFirebaseEnabled) {
    // ローカルストレージの場合
    const eventIndex = events.findIndex(e => e.id === id);
    if (eventIndex !== -1) {
      events[eventIndex] = { ...events[eventIndex], ...updatedEvent };
      saveEventsToLocalStorage();
      updateViews();
    }
    return;
  }

  const eventRef = window.firebase.ref(window.firebase.db, `events/${id}`);
  window.firebase.update(eventRef, updatedEvent);
  console.log('Firebaseでイベントを更新:', id);
}

// イベントを削除（combiと同じロジック）
function deleteEvent(id) {
  if (!isFirebaseEnabled) {
    // ローカルストレージの場合
    const eventIndex = events.findIndex(e => e.id === id);
    if (eventIndex !== -1) {
      events.splice(eventIndex, 1);
      saveEventsToLocalStorage();
      updateViews();
    }
    return;
  }

  const eventRef = window.firebase.ref(window.firebase.db, `events/${id}`);
  window.firebase.remove(eventRef);
  console.log('Firebaseからイベントを削除:', id);
}

// ローカルストレージに保存（フォールバック）
function saveEventsToLocalStorage() {
  try {
    const data = {
      version: '1.0',
      events: events
    };
    localStorage.setItem('schedule_events', JSON.stringify(data));
    console.log('ローカルストレージに保存:', events.length, '件');
  } catch (error) {
    console.error('ローカルストレージ保存エラー:', error);
  }
}

// 特定日のイベントを取得
function getEventsByDate(date) {
  const dateStr = formatDate(date, 'YYYY-MM-DD');
  return events.filter(event => {
    const eventDate = event.startTime.split('T')[0];
    return eventDate === dateStr;
  });
}

// 特定週のイベントを取得
function getEventsByWeek(startDate) {
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 6);
  endDate.setHours(23, 59, 59, 999);
  
  return events.filter(event => {
    const eventDate = new Date(event.startTime);
    return eventDate >= startDate && eventDate <= endDate;
  });
}

// 日次ビューの描画
function renderDayView() {
  const container = document.getElementById('dayEventContainer');
  container.innerHTML = '';

  const dayEvents = getEventsByDate(currentDate);
  
  dayEvents.forEach(event => {
    const eventElement = createEventElement(event);
    positionEventInDayView(eventElement, event);
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
    
    // 日付表示（曜日なし）
    const dayNumber = dayDate.getDate();
    if (dateHeaderElement) {
      dateHeaderElement.textContent = dayNumber;
    }
    
    // イベント表示
    if (!eventsContainer) continue;
    eventsContainer.innerHTML = '';
    const dayEvents = getEventsByDate(dayDate);
    
    // 重なり検出とグループ化
    const groups = calculateEventGroups(dayEvents);
    
    dayEvents.forEach((event, index) => {
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
    const start = new Date(ev.startTime);
    const end = new Date(ev.endTime);
    const overlappingIndexes = [];
    for (let j = 0; j < n; j++) {
      const other = dayEvents[j];
      const os = new Date(other.startTime);
      const oe = new Date(other.endTime);
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
function createEventElement(event) {
  const div = document.createElement('div');
  div.className = 'event-item';
  div.style.backgroundColor = event.color;
  div.dataset.eventId = event.id;
  div.tabIndex = 0;
  div.setAttribute('role', 'button');
  div.setAttribute('aria-label', `${event.title}, ${formatTime(event.startTime)}から${formatTime(event.endTime)}`);
  
  div.innerHTML = `
    <div class="resize-handle top"></div>
    <div class="event-title">${escapeHtml(event.title)}</div>
    <div class="event-time">${formatTime(event.startTime)} - ${formatTime(event.endTime)}</div>
    <div class="resize-handle bottom"></div>
  `;
  
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

// イベント要素を作成（週次ビュー用）
function createWeekEventElement(event) {
  const div = document.createElement('div');
  div.className = 'week-event-item';
  div.style.backgroundColor = event.color;
  div.dataset.eventId = event.id;
  div.tabIndex = 0;
  div.setAttribute('role', 'button');
  div.setAttribute('aria-label', `${event.title}, ${formatTime(event.startTime)}`);
  
  div.innerHTML = `
    <div class="week-event-title">${escapeHtml(event.title)}</div>
    <div class="week-event-time">${formatTime(event.startTime)}</div>
  `;
  
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
  const startTime = new Date(event.startTime);
  const endTime = new Date(event.endTime);
  
  const startHour = startTime.getHours();
  const startMinute = startTime.getMinutes();
  const endHour = endTime.getHours();
  const endMinute = endTime.getMinutes();
  
  // 位置計算（1時間 = 25px）
  const top = (startHour * 25) + (startMinute * 25 / 60);
  const height = ((endHour * 25) + (endMinute * 25 / 60)) - top;
  
  element.style.top = `${top}px`;
  element.style.height = `${Math.max(height, 15)}px`; // 最小高さ15px
}

// モーダル表示
function showEventModal(eventId = null) {
  const modal = document.getElementById('eventModal');
  const modalTitle = document.getElementById('modalTitle');
  const form = document.getElementById('eventForm');
  const deleteBtn = document.getElementById('deleteBtn');
  
  editingEventId = eventId;
  
  if (eventId && !eventId.startsWith('temp-')) {
    // 編集モード（一時的でないイベント）
    const event = events.find(e => e.id === eventId);
    if (!event) return;
    
    modalTitle.textContent = '予定を編集';
    deleteBtn.style.display = 'block';
    
    // フォームに値を設定
    document.getElementById('eventTitle').value = event.title;
    document.getElementById('eventDescription').value = event.description || '';
    document.getElementById('eventStartTime').value = event.startTime.slice(0, 16);
    document.getElementById('eventEndTime').value = event.endTime.slice(0, 16);
    
    // 色を設定
    const colorRadio = document.querySelector(`input[name="color"][value="${event.color}"]`);
    if (colorRadio) colorRadio.checked = true;
  } else {
    // 新規作成モード（一時的イベントまたは新規）
    modalTitle.textContent = '新しい予定';
    deleteBtn.style.display = 'none';
    
    // 一時的イベントの場合は既存の値を保持
    if (eventId && eventId.startsWith('temp-')) {
      const event = events.find(e => e.id === eventId);
      if (event) {
        document.getElementById('eventTitle').value = '';
        document.getElementById('eventDescription').value = event.description || '';
        document.getElementById('eventStartTime').value = event.startTime.slice(0, 16);
        document.getElementById('eventEndTime').value = event.endTime.slice(0, 16);
        
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
      
      document.getElementById('eventStartTime').value = formatDateTimeLocal(startTime);
      document.getElementById('eventEndTime').value = formatDateTimeLocal(endTime);
    }
  }
  
  modal.classList.add('show');
  modal.setAttribute('aria-hidden', 'false');
  document.getElementById('eventTitle').focus();
}

// モーダルを閉じる
function closeEventModal() {
  const modal = document.getElementById('eventModal');
  modal.classList.remove('show');
  modal.setAttribute('aria-hidden', 'true');
  
  // 一時的イベントの場合は削除
  if (editingEventId && editingEventId.startsWith('temp-')) {
    const tempEventIndex = events.findIndex(e => e.id === editingEventId);
    if (tempEventIndex !== -1) {
      events.splice(tempEventIndex, 1);
      updateViews();
    }
  }
  
  editingEventId = null;
}

// 日付表示を更新
function updateDateDisplay() {
  const currentDateElement = document.getElementById('currentDate');
  
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
  const monthGrid = document.getElementById('monthGrid');
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
  
  // その日のイベント
  const dayEvents = getEventsByDate(date);
  if (dayEvents.length > 0) {
    div.classList.add('has-events');
    
    const eventsContainer = document.createElement('div');
    eventsContainer.className = 'month-day-events';
    
    // 最大3件まで表示
    dayEvents.slice(0, 3).forEach(event => {
      const eventElement = document.createElement('div');
      eventElement.className = 'month-event-item';
      eventElement.style.backgroundColor = event.color;
      eventElement.textContent = event.title;
      eventElement.title = `${event.title} (${formatTime(event.startTime)})`;
      eventElement.addEventListener('click', (e) => {
        e.stopPropagation();
        showEventModal(event.id);
      });
      eventsContainer.appendChild(eventElement);
    });
    
    // 3件を超える場合は「+N」を表示
    if (dayEvents.length > 3) {
      const moreElement = document.createElement('div');
      moreElement.className = 'month-event-item';
      moreElement.style.backgroundColor = '#6b7280';
      moreElement.textContent = `+${dayEvents.length - 3}`;
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
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

// datetime-local用のフォーマット
function formatDateTimeLocal(date) {
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  
  return `${year}-${month}-${day}T${hours}:${minutes}`;
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
  document.getElementById('dayView').classList.remove('active');
  document.getElementById('weekView').classList.remove('active');
  document.getElementById('monthView').classList.remove('active');
  document.getElementById('dayViewBtn').classList.remove('active');
  document.getElementById('weekViewBtn').classList.remove('active');
  document.getElementById('monthViewBtn').classList.remove('active');
  
  // ヘッダーのクラスをリセット
  document.querySelector('.header').classList.remove('month-view-active');
  
  // 選択されたビューをアクティブに
  if (view === 'day') {
    document.getElementById('dayView').classList.add('active');
    document.getElementById('dayViewBtn').classList.add('active');
  } else if (view === 'week') {
    document.getElementById('weekView').classList.add('active');
    document.getElementById('weekViewBtn').classList.add('active');
  } else if (view === 'month') {
    document.getElementById('monthView').classList.add('active');
    document.getElementById('monthViewBtn').classList.add('active');
    // 月次ビュー時はヘッダーにクラスを追加（矢印を非表示にしない）
    // document.querySelector('.header').classList.add('month-view-active');
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
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ID生成関数
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// イベントバリデーション
function validateEvent(event) {
  const errors = [];
  
  // タイトルは空でも許可
  if (event.title && event.title.length > 100) {
    errors.push('タイトルは100文字以内で入力してください');
  }
  
  if (!event.startTime) {
    errors.push('開始時刻を入力してください');
  }
  
  if (!event.endTime) {
    errors.push('終了時刻を入力してください');
  }
  
  if (event.startTime && event.endTime) {
    const start = new Date(event.startTime);
    const end = new Date(event.endTime);
    
    if (end <= start) {
      errors.push('終了時刻は開始時刻より後にしてください');
    }
  }
  
  if (event.description && event.description.length > 500) {
    errors.push('説明は500文字以内で入力してください');
  }
  
  return errors;
}

// Google Calendar API初期化
function initGoogleCalendar() {
  return new Promise((resolve) => {
    if (typeof gapi === 'undefined') {
      console.log('Google API not loaded');
      resolve(false);
      return;
    }
    
    gapi.load('client', () => {
      gapi.client.init({
        apiKey: 'AIzaSyCd9Hq0u7ZwXd7YRaWzXn1NMsIc9arddLQ',
        discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest']
      }).then(() => {
        console.log('Google Calendar API initialized');
        resolve(true);
      }).catch((error) => {
        console.error('Google Calendar API initialization failed:', error);
        resolve(false);
      });
    });
  });
}

// Google認証
function authenticateGoogle() {
  return new Promise((resolve) => {
    if (typeof google === 'undefined') {
      console.log('Google Identity Services not loaded');
      resolve(false);
      return;
    }
    
    google.accounts.oauth2.initTokenClient({
      client_id: '799555062025-42lgg51dh6t7glkgcvkq2dpr15h9mttt.apps.googleusercontent.com',
      scope: 'https://www.googleapis.com/auth/calendar',
      callback: (response) => {
        googleAccessToken = response.access_token;
        isGoogleCalendarEnabled = true;
        document.getElementById('googleSyncBtn').textContent = '📅 Google同期中';
        document.getElementById('googleSyncBtn').style.backgroundColor = '#34a853';
        console.log('Google認証成功');
        resolve(true);
      }
    }).requestAccessToken();
  });
}

// Google Calendarからイベントを取得
async function loadGoogleEvents() {
  if (!isGoogleCalendarEnabled || !googleAccessToken) return;
  
  try {
    const response = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
      headers: {
        'Authorization': `Bearer ${googleAccessToken}`
      }
    });
    
    const data = await response.json();
    console.log('Google Calendar events loaded:', data.items?.length || 0);
    
    // Google Calendarのイベントをローカルイベントに変換
    if (data.items) {
      const googleEvents = data.items.map(item => ({
        id: `google_${item.id}`,
        title: item.summary || '無題',
        description: item.description || '',
        startTime: item.start.dateTime || item.start.date,
        endTime: item.end.dateTime || item.end.date,
        color: '#4285f4',
        source: 'google'
      }));
      
      // 重複を避けてマージ
      googleEvents.forEach(googleEvent => {
        if (!events.find(e => e.id === googleEvent.id)) {
          events.push(googleEvent);
        }
      });
      
      updateViews();
    }
  } catch (error) {
    console.error('Google Calendar events loading failed:', error);
  }
}

// Google Calendarにイベントを同期
async function syncToGoogleCalendar(event) {
  if (!isGoogleCalendarEnabled || !googleAccessToken) return;
  
  try {
    const googleEvent = {
      summary: event.title,
      description: event.description,
      start: {
        dateTime: event.startTime,
        timeZone: 'Asia/Tokyo'
      },
      end: {
        dateTime: event.endTime,
        timeZone: 'Asia/Tokyo'
      }
    };
    
    const response = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${googleAccessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(googleEvent)
    });
    
    const result = await response.json();
    console.log('Event synced to Google Calendar:', result.id);
    
    // Google CalendarのIDを保存
    event.googleId = result.id;
    
  } catch (error) {
    console.error('Google Calendar sync failed:', error);
  }
}

// 初期化（combiと同じロジック）
document.addEventListener('DOMContentLoaded', async function() {
  console.log('アプリケーションを初期化中...');
  
  // Firebase接続チェック
  checkFirebase();
  
  // Google Calendar API初期化
  await initGoogleCalendar();
  
  // イベントを読み込み
  loadEvents();
  
  // イベントリスナーを登録
  setupEventListeners();

  // 日次グリッドでのクリック追加を有効化
  enableDayGridClickToCreate();
  // 週次グリッドでのクリック追加を有効化
  enableWeekGridClickToCreate();
  
  console.log('アプリケーション初期化完了');
});

// イベントリスナーの設定
function setupEventListeners() {
  // 日付ナビゲーション（日次・週次・月次用）
  document.getElementById('prevDay').addEventListener('click', () => {
    if (currentView === 'day') {
      currentDate = addDays(currentDate, -1);
    } else if (currentView === 'week') {
      currentDate = addDays(currentDate, -7);
    } else if (currentView === 'month') {
      currentDate = addMonths(currentDate, -1);
    }
    updateViews();
  });
  
  document.getElementById('nextDay').addEventListener('click', () => {
    if (currentView === 'day') {
      currentDate = addDays(currentDate, 1);
    } else if (currentView === 'week') {
      currentDate = addDays(currentDate, 7);
    } else if (currentView === 'month') {
      currentDate = addMonths(currentDate, 1);
    }
    updateViews();
  });
  
  // 月次ナビゲーション（ヘッダーの矢印を使用）
  // prevDay/nextDay が月次ビュー時は前月/翌月に動作するように既に実装済み
  
  document.getElementById('todayBtn').addEventListener('click', () => {
    currentDate = new Date();
    updateViews();
  });
  
  // ビュー切り替え
  document.getElementById('dayViewBtn').addEventListener('click', () => {
    currentView = 'day';
    switchView('day');
    updateViews();
  });
  
  document.getElementById('weekViewBtn').addEventListener('click', () => {
    currentView = 'week';
    switchView('week');
    updateViews();
  });
  
  document.getElementById('monthViewBtn').addEventListener('click', () => {
    currentView = 'month';
    switchView('month');
    updateViews();
  });
  
  // 予定追加ボタン
  document.getElementById('addEventBtn').addEventListener('click', () => {
    showEventModal();
  });
  
  // Google連携ボタン
  document.getElementById('googleSyncBtn').addEventListener('click', async () => {
    if (!isGoogleCalendarEnabled) {
      await authenticateGoogle();
      if (isGoogleCalendarEnabled) {
        await loadGoogleEvents();
      }
    } else {
      await loadGoogleEvents();
    }
  });
  
  // モーダル関連
  document.getElementById('closeModal').addEventListener('click', closeEventModal);
  document.getElementById('cancelBtn').addEventListener('click', closeEventModal);
  
  // モーダル外クリックで閉じる
  document.getElementById('eventModal').addEventListener('click', (e) => {
    if (e.target.id === 'eventModal') {
      closeEventModal();
    }
  });
  
  // ESCキーでモーダルを閉じる
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const modal = document.getElementById('eventModal');
      if (modal.classList.contains('show')) {
        closeEventModal();
      }
    }
  });
  
  // フォーム送信
  document.getElementById('eventForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const formData = new FormData(e.target);
    const event = {
      title: formData.get('title').trim(),
      description: formData.get('description').trim(),
      startTime: formData.get('startTime'),
      endTime: formData.get('endTime'),
      color: formData.get('color')
    };
    
    // バリデーション
    const errors = validateEvent(event);
    if (errors.length > 0) {
      alert(errors.join('\n'));
      return;
    }
    
    try {
      if (editingEventId && editingEventId.startsWith('temp-')) {
        // 一時的イベントを正式なイベントに変換
        const tempEventIndex = events.findIndex(e => e.id === editingEventId);
        if (tempEventIndex !== -1) {
          // 一時的イベントを削除
          events.splice(tempEventIndex, 1);
        }
        
        // 新しいイベントを作成
        const newEvent = {
          id: generateId(),
          title: event.title,
          description: event.description,
          startTime: event.startTime,
          endTime: event.endTime,
          color: event.color,
          createdAt: new Date().toISOString()
        };
        
        events.push(newEvent);
        addEvent(newEvent);
        
        // Google Calendarに同期
        if (isGoogleCalendarEnabled) {
          await syncToGoogleCalendar(newEvent);
        }
      } else if (editingEventId) {
        // 既存イベントを更新
        const eventIndex = events.findIndex(e => e.id === editingEventId);
        if (eventIndex !== -1) {
          events[eventIndex] = {
            ...events[eventIndex],
            title: event.title,
            description: event.description,
            startTime: event.startTime,
            endTime: event.endTime,
            color: event.color
          };
        }
        updateEvent(editingEventId, event);
        
        // Google Calendarに同期
        if (isGoogleCalendarEnabled) {
          await syncToGoogleCalendar(events[eventIndex]);
        }
      } else {
        // 新規イベントを作成
        addEvent(event);
        
        // Google Calendarに同期
        if (isGoogleCalendarEnabled) {
          await syncToGoogleCalendar(event);
        }
      }
      
      closeEventModal();
    } catch (error) {
      console.error('イベント保存エラー:', error);
    }
  });
  
  // 削除ボタン
  document.getElementById('deleteBtn').addEventListener('click', () => {
    if (!editingEventId) return;
    
    if (confirm('この予定を削除してもよろしいですか？')) {
      try {
        deleteEvent(editingEventId);
        closeEventModal();
      } catch (error) {
        console.error('イベント削除エラー:', error);
      }
    }
  });
}

// 日次グリッドでのクリック/範囲選択作成
function enableDayGridClickToCreate() {
  const container = document.getElementById('dayEventContainer');
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
    selectionPreview.remove();
    document.removeEventListener('mousemove', onMouseMove);

    // 15分単位に丸める
    const startMinutes = Math.max(0, Math.round(startY / 25 * 60 / 15) * 15);
    const endMinutes = Math.max(0, Math.round(endY / 25 * 60 / 15) * 15);
    
    const baseDate = new Date(currentDate);
    baseDate.setHours(0, 0, 0, 0);
    const start = new Date(baseDate.getTime() + startMinutes * 60 * 1000);
    
    // クリック（移動なし）の場合は2時間の予定を作成
    let end;
    if (!hasMoved || (endY - startY) < 6.25) { // 6.25px = 15分
      end = new Date(start.getTime() + 2 * 60 * 60 * 1000); // 2時間
    } else {
      end = new Date(baseDate.getTime() + endMinutes * 60 * 1000);
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
    document.getElementById('eventStartTime').value = formatDateTimeLocal(start);
    document.getElementById('eventEndTime').value = formatDateTimeLocal(end);
    document.getElementById('eventTitle').focus();
  }
}

// 週次グリッドでのクリック作成（クリック位置の時間で1時間の予定をモーダルで作成）
function enableWeekGridClickToCreate() {
  const dayContainers = document.querySelectorAll('.week-day .day-events-container');
  const weekStart = getWeekStart(currentDate);
  dayContainers.forEach((container, dayIndex) => {
    container.addEventListener('click', (e) => {
      // 既存イベントクリックは除外
      if (e.target.closest('.event-item')) return;
      
      const rect = container.getBoundingClientRect();
      const offsetY = e.clientY - rect.top + container.scrollTop;
      
      // 15分単位に丸める（1時間=25px）
      const minutes = Math.max(0, Math.round(offsetY / 25 * 60 / 15) * 15);
      
      // クリックした日付を計算
      const clickedDate = new Date(getWeekStart(currentDate));
      clickedDate.setDate(weekStart.getDate() + dayIndex);
      clickedDate.setHours(0, 0, 0, 0);
      
      const start = new Date(clickedDate.getTime() + minutes * 60000);
      const end = new Date(start.getTime() + 60 * 60 * 1000); // 1時間
      
      // モーダルを開く（既定値セット）
      showEventModal();
      document.getElementById('eventStartTime').value = formatDateTimeLocal(start);
      document.getElementById('eventEndTime').value = formatDateTimeLocal(end);
      document.getElementById('eventTitle').focus();
    });
  });
}

// リサイズ（上下）処理とドラッグ移動処理
function attachResizeHandlers() {
  const items = document.querySelectorAll('.event-item');
  items.forEach((item) => {
    const id = item.dataset.eventId;
    const topHandle = item.querySelector('.resize-handle.top');
    const bottomHandle = item.querySelector('.resize-handle.bottom');
    if (!topHandle || !bottomHandle) return;

    let startY = 0;
    let originalStart = null;
    let originalEnd = null;
    let resizing = null; // 'top' | 'bottom' | 'move'
    let originalTop = 0;

    // リサイズハンドル用のマウスダウン
    function onMouseDown(handle, edge) {
      return (e) => {
        e.stopPropagation();
        const ev = events.find(ev => ev.id === id);
        if (!ev) return;
        startY = e.clientY;
        originalStart = new Date(ev.startTime);
        originalEnd = new Date(ev.endTime);
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
      const ev = events.find(ev => ev.id === id);
      if (!ev) return;
      
      startY = e.clientY;
      originalStart = new Date(ev.startTime);
      originalEnd = new Date(ev.endTime);
      originalTop = parseFloat(item.style.top) || 0;
      resizing = 'move';
      item.classList.add('dragging');
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp, { once: true });
    }

    function onMouseMove(e) {
      const dy = e.clientY - startY;
      const minutesDelta = Math.round(dy / 25 * 60 / 15) * 15; // 25px=1h, 15分単位に丸める
      
      if (resizing === 'top') {
        const newStart = new Date(originalStart.getTime() + minutesDelta * 60000);
        if (newStart < originalEnd) {
          // プレビュー: 位置と高さを更新
          const top = (newStart.getHours() * 25) + (newStart.getMinutes() * 25 / 60);
          const endTop = (originalEnd.getHours() * 25) + (originalEnd.getMinutes() * 25 / 60);
          item.style.top = `${top}px`;
          item.style.height = `${Math.max(endTop - top, 15)}px`;
        }
      } else if (resizing === 'bottom') {
        const newEnd = new Date(originalEnd.getTime() + minutesDelta * 60000);
        if (newEnd > originalStart) {
          // プレビュー: 高さ更新
          const startTop = (originalStart.getHours() * 25) + (originalStart.getMinutes() * 25 / 60);
          const endTop = (newEnd.getHours() * 25) + (newEnd.getMinutes() * 25 / 60);
          item.style.height = `${Math.max(endTop - startTop, 15)}px`;
        }
      } else if (resizing === 'move') {
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
      const ev = events.find(ev => ev.id === id);
      if (!ev) return;

      // クリック（移動なし）は詳細モーダルを開く
      if (resizing === 'move' && minutesDelta === 0) {
        showEventModal(id);
        return;
      }

      if (resizing === 'top') {
        const newStart = new Date(new Date(ev.startTime).getTime() + minutesDelta * 60000);
        if (newStart < new Date(ev.endTime)) {
          ev.startTime = formatDateTimeLocal(newStart);
        }
      } else if (resizing === 'bottom') {
        const newEnd = new Date(new Date(ev.endTime).getTime() + minutesDelta * 60000);
        if (newEnd > new Date(ev.startTime)) {
          ev.endTime = formatDateTimeLocal(newEnd);
        }
      } else if (resizing === 'move') {
        // ドラッグ移動の処理
        const newStart = new Date(new Date(ev.startTime).getTime() + minutesDelta * 60000);
        const newEnd = new Date(new Date(ev.endTime).getTime() + minutesDelta * 60000);
        
        // 0時より前には移動できない
        if (newStart.getHours() >= 0) {
          ev.startTime = formatDateTimeLocal(newStart);
          ev.endTime = formatDateTimeLocal(newEnd);
        }
      }
      
      // 永続化
      updateEvent(id, {
        title: ev.title,
        description: ev.description || '',
        startTime: ev.startTime,
        endTime: ev.endTime,
        color: ev.color
      });
      updateViews();
    }

    topHandle.addEventListener('mousedown', onMouseDown(topHandle, 'top'));
    bottomHandle.addEventListener('mousedown', onMouseDown(bottomHandle, 'bottom'));
    
    // イベント本体のドラッグ移動イベントリスナーを追加
    item.addEventListener('mousedown', onEventMouseDown);
  });
}

