const HEADERS = ['id', 'created_at', 'name', 'email', 'event_id', 'event_title', 'event_date', 'flag', 'approved_at', 'notification_status', 'notified_at', 'last_error'];
const EVENTS = [
  { id: 'design-foundations', title: 'Design Foundations', date: '2026-11-20', category: 'Instant', issuer: 'Open Workshop' },
  { id: 'community-fellowship', title: 'Community Fellowship', date: '2026-11-28', category: 'Review', issuer: 'Open Workshop' }
];

function doGet(e) {
  return respond_(function () {
    const params = e && e.parameter || {};
    if (params.action === 'events') return { events: EVENTS };
    if (params.action === 'template') return locked_(function () { return { template: readTemplate_() }; });
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
    if (body.action === 'login') return login_(body);
    if (body.action === 'saveTemplate') {
      requireSession_(body.session);
      const template = validateTemplate_(body.template);
      return locked_(function () {
        const spreadsheet = SpreadsheetApp.openById(property_('SPREADSHEET_ID'));
        const name = sheetName_() + '_Template';
        let sheet = spreadsheet.getSheetByName(name);
        if (!sheet) sheet = spreadsheet.insertSheet(name);
        if (sheet.getLastRow() && sheet.getRange(1, 1).getValues()[0][0] !== 'certificate-template-v1') {
          fail_('CONFIGURATION', 'Template tab already contains unrelated data. Choose a different SHEET_NAME.');
        }
        const serialized = JSON.stringify(template);
        const chunks = [];
        for (let offset = 0; offset < serialized.length; offset += 40000) chunks.push(serialized.slice(offset, offset + 40000));
        const values = [['certificate-template-v1', chunks.length]].concat(chunks.map(function (chunk) { return ['part', 'chunk:' + chunk]; }));
        sheet.getRange(1, 1, values.length, 2).setValues(values);
        SpreadsheetApp.flush();
        return { saved: true };
      });
    }
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

function login_(body) {
  if (body.secret !== undefined) {
    if (typeof body.secret !== 'string' || body.secret.length > 256) fail_('UNAUTHORIZED', 'Invalid admin credentials.');
    const expected = property_('ADMIN_SECRET');
    if (expected.length < 32) fail_('CONFIGURATION', 'ADMIN_SECRET must have at least 32 characters.');
    if (!sameSecret_(body.secret, expected)) fail_('UNAUTHORIZED', 'Invalid admin credentials.');
  } else {
    if (typeof body.username !== 'string' || !body.username.trim() || body.username.length > 100 ||
        typeof body.password !== 'string' || body.password.length > 256) fail_('UNAUTHORIZED', 'Invalid admin credentials.');
    const username = property_('ADMIN_USERNAME');
    const password = property_('ADMIN_PASSWORD');
    if (password.length < 16) fail_('CONFIGURATION', 'ADMIN_PASSWORD must have at least 16 characters.');
    const validUsername = sameSecret_(body.username.trim(), username);
    const validPassword = sameSecret_(body.password, password);
    if (!validUsername || !validPassword) fail_('UNAUTHORIZED', 'Invalid admin credentials.');
  }
  const session = Utilities.getUuid() + Utilities.getUuid();
  CacheService.getScriptCache().put('session:' + session, 'admin', 1800);
  return { session: session, expiresIn: 1800 };
}

function sameSecret_(actual, expected) {
  const digest = function (value) { return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value); };
  const actualBytes = digest(actual);
  const expectedBytes = digest(expected);
  let difference = 0;
  for (let index = 0; index < expectedBytes.length; index++) difference |= actualBytes[index] ^ expectedBytes[index];
  return difference === 0;
}

function readTemplate_() {
  const sheet = SpreadsheetApp.openById(property_('SPREADSHEET_ID')).getSheetByName(sheetName_() + '_Template');
  if (!sheet || !sheet.getLastRow()) return null;
  const header = sheet.getRange(1, 1, 1, 2).getValues()[0];
  const count = Number(header[1]);
  if (header[0] !== 'certificate-template-v1' || !Number.isInteger(count) || count < 1 || count > 75) {
    fail_('CONFIGURATION', 'Stored certificate template is invalid.');
  }
  const parts = sheet.getRange(2, 2, count, 1).getValues().map(function (row) {
    if (typeof row[0] !== 'string' || row[0].indexOf('chunk:') !== 0) fail_('CONFIGURATION', 'Stored certificate template is incomplete.');
    return row[0].slice(6);
  });
  try { return JSON.parse(parts.join('')); }
  catch (error) { fail_('CONFIGURATION', 'Stored certificate template is unreadable.'); }
}

function validateTemplate_(input) {
  if (!input || typeof input !== 'object' || typeof input.url !== 'string' || input.url.length > 2800000) {
    fail_('BAD_REQUEST', 'Choose a PNG or JPEG background of at most 2 MB.');
  }
  if (/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(input.url)) {
    const bytes = Utilities.base64Decode(input.url.split(',')[1]);
    const png = bytes.length >= 8 && (bytes[0] & 255) === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71;
    const jpeg = bytes.length >= 3 && (bytes[0] & 255) === 255 && (bytes[1] & 255) === 216 && (bytes[2] & 255) === 255;
    if (!bytes.length || bytes.length > 2097152 || (input.url.indexOf('data:image/png;') === 0 ? !png : !jpeg)) {
      fail_('BAD_REQUEST', 'The background must be a valid PNG or JPEG of at most 2 MB.');
    }
  } else if (!/^assets\/[A-Za-z0-9_-][A-Za-z0-9_.-]*\.(png|jpe?g)$/.test(input.url)) {
    fail_('BAD_REQUEST', 'Upload a PNG or JPEG background.');
  }
  if (typeof input.fontUrl !== 'string' || !/^assets\/[A-Za-z0-9_-][A-Za-z0-9_.-]*\.(ttf|otf)$/.test(input.fontUrl)) {
    fail_('BAD_REQUEST', 'Use a bundled certificate font.');
  }
  const positions = {};
  ['name', 'event', 'date', 'id', 'verify'].forEach(function (key) {
    const position = input.positions && input.positions[key] || (key === 'verify' ? { x: 421, y: 67, size: 7, maxWidth: 700 } : null);
    if (!position || !Number.isFinite(position.x) || position.x < 0 || position.x > 841.89 ||
        !Number.isFinite(position.y) || position.y < 0 || position.y > 595.28 ||
        !Number.isFinite(position.size) || position.size < 6 || position.size > 80 ||
        !Number.isFinite(position.maxWidth) || position.maxWidth < 10 || position.maxWidth > 800 ||
        position.x - position.maxWidth / 2 < 0 || position.x + position.maxWidth / 2 > 841.89) {
      fail_('BAD_REQUEST', 'Text positions and widths must fit on the A4 landscape page.');
    }
    positions[key] = { x: position.x, y: position.y, size: position.size, maxWidth: position.maxWidth };
  });
  return { url: input.url, fontUrl: input.fontUrl, sample: input.sample === true, positions: positions };
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