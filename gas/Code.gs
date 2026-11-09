const HEADERS = ['id', 'created_at', 'name', 'email', 'event_id', 'event_title', 'event_date', 'flag', 'approved_at', 'notification_status', 'notified_at', 'last_error'];
const EVENTS = [
  { id: 'design-foundations', title: 'Design Foundations', date: '2026-11-20', category: 'Instant', issuer: 'Open Workshop' },
  { id: 'community-fellowship', title: 'Community Fellowship', date: '2026-11-28', category: 'Review', issuer: 'Open Workshop' }
];

function doGet(e) {
  return respond_(function () {
    const params = e && e.parameter || {};
    if (params.action === 'events') return { events: EVENTS };
    if (params.action === 'verify' || params.action === 'download') {
      const row = findRow_(sheet_(), validId_(params.id));
      if (!row || Number(row.data.flag) !== 1) fail_('NOT_FOUND', 'No approved certificate was found.');
      return { certificate: publicRow_(row.data) };
    }
    if (params.action === 'list') {
      requireSession_(params.session);
      return { submissions: rows_(sheet_()).map(function (row) { return row.data; }) };
    }
    fail_('BAD_REQUEST', 'Unknown action.');
  });
}

function doPost(e) {
  return respond_(function () {
    let body;
    try { body = JSON.parse(e.postData.contents); } catch (error) { fail_('BAD_REQUEST', 'Invalid JSON body.'); }
    if (body.action === 'login') return login_(body.secret);
    if (body.action === 'logout') {
      if (typeof body.session === 'string') CacheService.getScriptCache().remove('session:' + body.session);
      return {};
    }
    if (body.action === 'list') {
      requireSession_(body.session);
      return { submissions: rows_(sheet_()).map(function (row) { return row.data; }) };
    }
    if (body.action === 'approve') {
      requireSession_(body.session);
      if (body.flag !== 0 && body.flag !== 1) fail_('BAD_REQUEST', 'Flag must be 0 or 1.');
      return locked_(function () {
        const sheet = sheet_();
        const row = findRow_(sheet, validId_(body.id));
        if (!row) fail_('NOT_FOUND', 'Submission not found.');
        sheet.getRange(row.index, column_('flag')).setValue(body.flag);
        processApproval_(sheet, row.index);
        return { submission: readRow_(sheet, row.index).data };
      });
    }
    if (body.action !== 'submit') fail_('BAD_REQUEST', 'Unknown action.');
    const id = validId_(body.id);
    const name = text_(body.name, 100, 'Name');
    const email = text_(body.email, 254, 'Email').toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail_('BAD_REQUEST', 'Enter a valid email address.');
    const event = EVENTS.find(function (item) { return item.id === body.eventId; });
    if (!event) fail_('BAD_REQUEST', 'Unknown event.');
    return locked_(function () {
      const sheet = sheet_();
      const existing = findRow_(sheet, id);
      if (existing) {
        if (existing.data.name !== name || existing.data.email !== email || existing.data.event_id !== event.id) {
          fail_('CONFLICT', 'This submission ID is already in use.');
        }
        return submissionResult_(existing.data);
      }
      const now = new Date().toISOString();
      const approved = event.category === 'Instant';
      const data = { id: id, created_at: now, name: name, email: email, event_id: event.id, event_title: event.title,
        event_date: event.date, flag: approved ? 1 : 0, approved_at: approved ? now : '',
        notification_status: approved ? 'not_required' : 'pending', notified_at: '', last_error: '' };
      const next = sheet.getLastRow() + 1;
      const range = sheet.getRange(next, 1, 1, HEADERS.length);
      range.setNumberFormat('@');
      range.setValues([HEADERS.map(function (key) { return typeof data[key] === 'string' ? sheetText_(data[key]) : data[key]; })]);
      SpreadsheetApp.flush();
      return submissionResult_(data);
    });
  });
}

function onEdit(e) {
  if (!e || !e.range || e.authMode !== ScriptApp.AuthMode.FULL) return;
  const range = e.range;
  const sheet = range.getSheet();
  if (sheet.getParent().getId() !== property_('SPREADSHEET_ID') || sheet.getName() !== sheetName_()) return;
  if (range.getColumn() > column_('flag') || range.getLastColumn() < column_('flag')) return;
  locked_(function () {
    for (let index = Math.max(2, range.getRow()); index <= range.getLastRow(); index++) processApproval_(sheet, index);
  });
}

function processApproval_(sheet, index) {
  const data = readRow_(sheet, index).data;
  if (!data.id) return;
  if (Number(data.flag) !== 1) {
    if (Number(data.flag) !== 0) {
      sheet.getRange(index, column_('flag')).setValue(0);
      setCell_(sheet, index, 'last_error', 'Invalid flag reset to 0; use 0 or 1.');
    }
    setCell_(sheet, index, 'approved_at', '');
    setCell_(sheet, index, 'notified_at', '');
    setCell_(sheet, index, 'notification_status', 'pending');
    return;
  }
  if (!data.approved_at) setCell_(sheet, index, 'approved_at', new Date().toISOString());
  if (data.notified_at || data.notification_status === 'not_required') return;
  try {
    const base = property_('FRONTEND_URL').replace(/\/$/, '');
    if (!/^https:\/\//.test(base)) throw new Error('FRONTEND_URL must use HTTPS.');
    const link = base + '/?route=download&id=' + encodeURIComponent(data.id);
    MailApp.sendEmail({ to: data.email, subject: 'Your certificate is ready: ' + data.event_title,
      body: 'Hello ' + data.name + ',\n\nYour certificate has been approved.\nDownload: ' + link + '\n\nCertificate ID: ' + data.id });
    setCell_(sheet, index, 'notified_at', new Date().toISOString());
    setCell_(sheet, index, 'notification_status', 'sent');
    setCell_(sheet, index, 'last_error', '');
  } catch (error) {
    setCell_(sheet, index, 'notification_status', 'failed');
    setCell_(sheet, index, 'last_error', String(error.message).slice(0, 400));
  }
}

function retryNotifications() {
  locked_(function () {
    const sheet = sheet_();
    rows_(sheet).filter(function (row) {
      return Number(row.data.flag) === 1 && !row.data.notified_at && row.data.notification_status !== 'not_required';
    }).slice(0, 25).forEach(function (row) { processApproval_(sheet, row.index); });
  });
}

function setup() {
  const spreadsheet = SpreadsheetApp.openById(property_('SPREADSHEET_ID'));
  let sheet = spreadsheet.getSheetByName(sheetName_());
  if (!sheet) sheet = spreadsheet.insertSheet(sheetName_());
  if (!sheet.getLastRow()) sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  sheet_();
  sheet.setFrozenRows(1);
  sheet.getRange(2, column_('flag'), Math.max(sheet.getMaxRows() - 1, 1), 1)
    .setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['0', '1'], true).setAllowInvalid(false).build());
  const handlers = ScriptApp.getProjectTriggers().map(function (trigger) { return trigger.getHandlerFunction(); });
  if (handlers.indexOf('onEdit') === -1) ScriptApp.newTrigger('onEdit').forSpreadsheet(spreadsheet).onEdit().create();
  if (handlers.indexOf('retryNotifications') === -1) ScriptApp.newTrigger('retryNotifications').timeBased().everyMinutes(10).create();
}

function login_(secret) {
  if (typeof secret !== 'string' || secret.length > 256) fail_('UNAUTHORIZED', 'Invalid admin credentials.');
  const expected = property_('ADMIN_SECRET');
  if (expected.length < 32) fail_('CONFIGURATION', 'ADMIN_SECRET must have at least 32 characters.');
  const digest = function (value) { return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value); };
  const actualBytes = digest(secret);
  const expectedBytes = digest(expected);
  let difference = 0;
  for (let index = 0; index < expectedBytes.length; index++) difference |= actualBytes[index] ^ expectedBytes[index];
  if (difference !== 0) fail_('UNAUTHORIZED', 'Invalid admin credentials.');
  const session = Utilities.getUuid() + Utilities.getUuid();
  CacheService.getScriptCache().put('session:' + session, 'admin', 1800);
  return { session: session, expiresIn: 1800 };
}

function requireSession_(session) {
  if (typeof session !== 'string' || !/^[a-f0-9-]{72}$/.test(session) || !CacheService.getScriptCache().get('session:' + session)) {
    fail_('UNAUTHORIZED', 'Admin session expired. Sign in again.');
  }
}

function respond_(callback) {
  let result;
  try { result = Object.assign({ ok: true }, callback()); }
  catch (error) {
    if (!error.code) console.error(error);
    result = { ok: false, error: { code: error.code || 'INTERNAL', message: error.code ? error.message : 'Service unavailable. Please try again.' } };
  }
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}

function locked_(callback) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) fail_('BUSY', 'Service busy. Please retry with the same submission ID.');
  try { return callback(); } finally { lock.releaseLock(); }
}

function property_(key) {
  const value = PropertiesService.getScriptProperties().getProperty(key);
  if (!value) fail_('CONFIGURATION', 'Missing script property: ' + key);
  return value;
}
function sheetName_() { return PropertiesService.getScriptProperties().getProperty('SHEET_NAME') || 'Submissions'; }
function sheet_() {
  const sheet = SpreadsheetApp.openById(property_('SPREADSHEET_ID')).getSheetByName(sheetName_());
  if (!sheet || JSON.stringify(sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0]) !== JSON.stringify(HEADERS)) {
    fail_('CONFIGURATION', 'Sheet headers do not match. Run setup() on an empty submissions sheet.');
  }
  return sheet;
}
function rows_(sheet) {
  if (sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS.length).getValues().map(function (values, offset) {
    return { index: offset + 2, data: object_(values) };
  }).filter(function (row) { return !!row.data.id; });
}
function readRow_(sheet, index) { return { index: index, data: object_(sheet.getRange(index, 1, 1, HEADERS.length).getValues()[0]) }; }
function object_(values) {
  const data = {};
  HEADERS.forEach(function (key, index) { data[key] = values[index] instanceof Date ? values[index].toISOString() : values[index]; });
  return data;
}
function findRow_(sheet, id) { return rows_(sheet).find(function (row) { return row.data.id === id; }); }
function column_(key) { return HEADERS.indexOf(key) + 1; }
function setCell_(sheet, index, key, value) { sheet.getRange(index, column_(key)).setValue(value); }
function sheetText_(value) { return /^[=+\-@\t\r]/.test(value) ? "'" + value : value; }
function text_(value, max, label) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max || /[\u0000-\u001f]/.test(value)) {
    fail_('BAD_REQUEST', label + ' is required and must be at most ' + max + ' characters.');
  }
  return value.trim();
}
function validId_(id) {
  if (typeof id !== 'string' || !/^FORM-\d{13}-[A-F0-9]{32}$/.test(id)) fail_('BAD_REQUEST', 'Invalid certificate ID.');
  return id;
}
function publicRow_(data) {
  const event = EVENTS.find(function (item) { return item.id === data.event_id; });
  return { id: data.id, name: data.name, eventId: data.event_id, eventTitle: data.event_title,
    eventDate: data.event_date, approvedAt: data.approved_at, issuer: event ? event.issuer : 'Open Workshop', flag: 1 };
}
function submissionResult_(data) {
  return { id: data.id, approved: Number(data.flag) === 1, certificate: Number(data.flag) === 1 ? publicRow_(data) : null };
}
function fail_(code, message) { const error = new Error(message); error.code = code; throw error; }