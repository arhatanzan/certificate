import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';

const source = readFileSync(new URL('../gas/Code.gs', import.meta.url), 'utf8');
function fixture() {
  const cells = [['id', 'created_at', 'name', 'email', 'event_id', 'event_title', 'event_date', 'flag', 'approved_at', 'notification_status', 'notified_at', 'last_error']];
  const cache = new Map();
  const emails = [];
  const properties = { SPREADSHEET_ID: 'sheet', FRONTEND_URL: 'https://certificates.example', ADMIN_SECRET: 'a'.repeat(48) };
  const sheet = {
    getLastRow: () => cells.length,
    getName: () => 'Submissions',
    getParent: () => ({ getId: () => 'sheet' }),
    getRange(row, column, height = 1, width = 1) {
      return {
        getValues: () => Array.from({ length: height }, (_, offset) => Array.from({ length: width }, (_, index) => cells[row - 1 + offset]?.[column - 1 + index] ?? '')),
        setNumberFormat() { return this; },
        setValues(values) { values.forEach((items, offset) => items.forEach((value, index) => { (cells[row - 1 + offset] ||= [])[column - 1 + index] = value; })); return this; },
        setValue(value) { return this.setValues([[value]]); },
        getSheet: () => sheet, getColumn: () => column, getLastColumn: () => column + width - 1,
        getRow: () => row, getLastRow: () => row + height - 1
      };
    }
  };
  const context = vm.createContext({ console, PropertiesService: { getScriptProperties: () => ({ getProperty: key => properties[key] }) },
    SpreadsheetApp: { openById: () => ({ getSheetByName: () => sheet }), flush() {} },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: text => ({ setMimeType: () => JSON.parse(text) }) },
    CacheService: { getScriptCache: () => ({ get: key => cache.get(key), put: (key, value) => cache.set(key, value), remove: key => cache.delete(key) }) },
    Utilities: { DigestAlgorithm: { SHA_256: 'sha256' }, computeDigest: (_, value) => [...createHash('sha256').update(value).digest()], getUuid: randomUUID },
    MailApp: { sendEmail: email => emails.push(email) }, ScriptApp: { AuthMode: { FULL: 'FULL' } }
  });
  vm.runInContext(source, context);
  const post = body => context.doPost({ postData: { contents: JSON.stringify(body) } });
  const get = parameter => context.doGet({ parameter });
  const submit = (overrides = {}) => post({ action: 'submit', id: 'FORM-1794220000000-' + 'A'.repeat(32), name: 'Alex Morgan', email: 'alex@example.com', eventId: 'design-foundations', ...overrides });
  const login = () => post({ action: 'login', secret: properties.ADMIN_SECRET }).session;
  return { cells, sheet, context, post, get, submit, login, emails };
}

test('instant approval is server-controlled, idempotent and publicly verifiable without email', () => {
  const api = fixture();
  const result = api.submit({ flag: 0 });
  assert.equal(result.approved, true);
  assert.equal(api.submit().id, result.id);
  assert.equal(api.cells.length, 2);
  const verified = api.get({ action: 'verify', id: result.id });
  assert.equal(verified.certificate.name, 'Alex Morgan');
  assert.equal('email' in verified.certificate, false);
  assert.equal(api.submit({ name: 'Someone Else' }).error.code, 'CONFLICT');
});

test('review ignores forged flag; authenticated API approval emails once and revocation blocks downloads', () => {
  const api = fixture();
  const result = api.submit({ eventId: 'community-fellowship', flag: 1 });
  assert.equal(result.approved, false);
  assert.equal(api.get({ action: 'download', id: result.id }).error.code, 'NOT_FOUND');
  assert.equal(api.post({ action: 'approve', id: result.id, flag: 1 }).error.code, 'UNAUTHORIZED');
  const session = api.login();
  assert.equal(api.post({ action: 'approve', session, id: result.id, flag: 1 }).ok, true);
  api.post({ action: 'approve', session, id: result.id, flag: 1 });
  assert.equal(api.emails.length, 1);
  assert.match(api.emails[0].body, /route=download&id=FORM-/);
  assert.equal(api.get({ action: 'list' }).error.code, 'UNAUTHORIZED');
  assert.equal(api.get({ action: 'list', session }).submissions.length, 1);
  api.post({ action: 'approve', session, id: result.id, flag: 0 });
  assert.equal(api.get({ action: 'download', id: result.id }).error.code, 'NOT_FOUND');
});

test('installable edit supports multirow edits and retries failed mail', () => {
  const api = fixture();
  api.submit({ eventId: 'community-fellowship' });
  api.cells[1][7] = 1;
  api.context.MailApp.sendEmail = () => { throw new Error('Quota exceeded'); };
  api.context.onEdit({ range: api.sheet.getRange(2, 7, 1, 2), authMode: 'FULL' });
  assert.equal(api.cells[1][9], 'failed');
  api.context.MailApp.sendEmail = email => api.emails.push(email);
  api.context.retryNotifications();
  api.context.retryNotifications();
  assert.equal(api.emails.length, 1);
  assert.equal(api.cells[1][9], 'sent');
});

test('invalid inputs and sessions are rejected and logout invalidates access', () => {
  const api = fixture();
  assert.equal(api.submit({ id: 'predictable' }).error.code, 'BAD_REQUEST');
  assert.equal(api.submit({ eventId: 'forged' }).error.code, 'BAD_REQUEST');
  assert.equal(api.submit({ email: 'bad' }).error.code, 'BAD_REQUEST');
  assert.equal(api.post({ action: 'login', secret: 'wrong' }).error.code, 'UNAUTHORIZED');
  const session = api.login();
  api.post({ action: 'logout', session });
  assert.equal(api.post({ action: 'list', session }).error.code, 'UNAUTHORIZED');
});