import { createIcons, Asterisk, LockKeyhole, ArrowUpRight, ArrowRight, ArrowLeft, Check, CheckCheck, Download, Search, ShieldCheck, Clock3, CalendarDays, BadgeCheck, LoaderCircle, LogOut, RefreshCw, Copy, ExternalLink, AlertCircle, Users, FileCheck2, Hourglass, Mail, ChevronRight } from 'lucide';
import { createId, isValidId, request } from './api.js';
import { downloadCertificate, formatDate } from './pdf.js';

window.CERTIFICATE_CONFIG.apiUrl = import.meta.env.VITE_GAS_URL || window.CERTIFICATE_CONFIG.apiUrl;

const icons = { Asterisk, LockKeyhole, ArrowUpRight, ArrowRight, ArrowLeft, Check, CheckCheck, Download, Search, ShieldCheck, Clock3, CalendarDays, BadgeCheck, LoaderCircle, LogOut, RefreshCw, Copy, ExternalLink, AlertCircle, Users, FileCheck2, Hourglass, Mail, ChevronRight };
const app = document.querySelector('#app');
const params = new URLSearchParams(location.search);
const pathRoute = location.pathname.replace(/\/$/, '').split('/').pop();
const route = params.get('route') || (['verify', 'download', 'admin'].includes(pathRoute) ? pathRoute : 'register');
let events = [];
let submissions = [];
let session = '';
let pendingSubmission = null;

function icon(name, extra = '') { return `<i data-lucide="${name}" ${extra}></i>`; }
function paintIcons() { createIcons({ icons }); }
function escape(value) { return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]); }
function status(message, error = false, target = '#status') {
  const element = document.querySelector(target);
  if (!element) return;
  element.textContent = message;
  element.classList.toggle('error', error);
  element.hidden = !message;
}
function busy(button, value, label) {
  button.disabled = value;
  button.innerHTML = `${icon(value ? 'loader-circle' : 'arrow-right', value ? 'class="spin"' : '')}<span>${label}</span>`;
  paintIcons();
}
function notice() {
  if (!window.CERTIFICATE_CONFIG.apiUrl) return `<div class="setup-notice">${icon('alert-circle')}<span>Service not connected. Registration opens when the organizer connects the certificate registry.</span></div>`;
  return '';
}
function heading(kicker, title, description) { return `<div class="page-heading"><div class="eyebrow">${kicker}</div><h1>${title}</h1><p>${description}</p></div>`; }
function copyButton(id) {
  return `<button type="button" class="icon-button" data-copy="${escape(id)}" title="Copy certificate ID" aria-label="Copy certificate ID">${icon('copy')}</button>`;
}
function attachCopy() {
  document.querySelectorAll('[data-copy]').forEach(button => button.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(button.dataset.copy); document.querySelector('#announcement').textContent = 'Certificate ID copied.'; button.innerHTML = icon('check'); paintIcons(); }
    catch { status('Copy is unavailable. Select and copy the ID below.', true); }
  }));
}

async function registerView() {
  app.innerHTML = `<section class="registration">${heading('YOUR NEXT CHAPTER, RECOGNIZED', 'Good work deserves<br>a little recognition.', 'Bring your learning full circle. Claim a certificate for your Open Workshop experience.')}
    <div class="registration-grid"><section class="form-section"><div class="section-title"><span class="step-number">01</span><h2>Your certificate details</h2></div>
      ${notice()}<form id="registration-form"><fieldset id="registration-fields"><label for="name">Full name</label><input id="name" name="name" autocomplete="name" required maxlength="100" placeholder="As you would like it on your certificate"><p class="field-hint">This is the name that will appear on your certificate.</p>
      <label for="email">Email address</label><input id="email" name="email" autocomplete="email" type="email" required maxlength="254" placeholder="you@example.com">
      <label class="event-label" for="event">Workshop or program</label><select id="event" name="event" required disabled><option value="">Loading events...</option></select>
      <div id="event-detail" class="event-detail" hidden></div>
      <label class="consent"><input type="checkbox" required><span>I confirm that my details are correct and I participated in this program.</span></label>
      <button class="button primary submit-button" id="submit-button" type="submit" disabled><span>Get my certificate</span>${icon('arrow-right')}</button></fieldset></form>
      <div id="status" role="status" class="status" hidden></div><div id="result" aria-live="polite"></div>
      <div class="privacy-line">${icon('lock-keyhole')}<span>Your email is only used for certificate updates.</span></div>
    </section><aside class="workshop-aside"><div class="workshop-photo"><img src="https://images.unsplash.com/photo-1522071820081-009f0129c71c?auto=format&fit=crop&w=1100&q=85" alt="Workshop participants collaborating around a table" width="1100" height="734"><span class="photo-tag">A COMMUNITY OF DOERS</span></div>
      <div class="aside-heading"><span class="small-label">MADE IT. LEARNED IT. EARNED IT.</span><h2>More than a piece of paper.</h2><p>A record of the time you invested, the ideas you explored, and the skills you took home.</p></div>
      <div class="benefit">${icon('badge-check')}<div><h3>Yours to keep</h3><p>A personalized, print-ready certificate.</p></div></div><div class="benefit">${icon('shield-check')}<div><h3>Easy to verify</h3><p>Every certificate has a unique registry ID.</p></div></div>
      <a class="text-link" href="?route=verify">Already have a certificate? Verify it ${icon('arrow-up-right')}</a>
    </aside></div><div class="bottom-note"><span class="mini-stars">${icon('asterisk')}${icon('asterisk')}${icon('asterisk')}</span><span>Small workshops. Lasting possibilities.</span><span class="edition">OPEN WORKSHOP / CERTIFICATE DESK</span></div></section>`;
  paintIcons();
  document.querySelector('#registration-form').addEventListener('submit', submitForm);
  document.querySelector('#event').addEventListener('change', updateEvent);
  if (!window.CERTIFICATE_CONFIG.apiUrl) {
    document.querySelector('#event').innerHTML = '<option value="">Registration is not open yet</option>';
    return;
  }
  try {
    const result = await request('events', {}, 'GET');
    events = result.events;
    if (!Array.isArray(events) || !events.length) throw new Error('No programs are open for registration.');
    document.querySelector('#event').innerHTML = '<option value="">Choose your program</option>' + events.map(event => `<option value="${escape(event.id)}">${escape(event.title)}</option>`).join('');
    document.querySelector('#event').disabled = false;
    document.querySelector('#submit-button').disabled = false;
  } catch (error) {
    document.querySelector('#event').innerHTML = '<option value="">Events unavailable</option>';
    status(error.message, true);
  }
}

function updateEvent() {
  const event = events.find(item => item.id === document.querySelector('#event').value);
  const detail = document.querySelector('#event-detail');
  detail.hidden = !event;
  if (!event) return;
  const instant = event.category === 'Instant';
  detail.innerHTML = `<div>${icon('calendar-days')}<span>${escape(formatDate(event.date))}</span></div><div class="${instant ? 'approved-text' : ''}">${icon(instant ? 'check-check' : 'clock-3')}<span>${instant ? 'Instant certificate' : 'Certificate after organizer approval'}</span></div>`;
  paintIcons();
}

async function submitForm(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const values = { name: data.get('name').trim(), email: data.get('email').trim(), eventId: data.get('event') };
  if (!pendingSubmission) pendingSubmission = { id: createId(), ...values };
  else if (['name', 'email', 'eventId'].some(key => pendingSubmission[key] !== values[key])) {
    status('A submission may already have reached the service. Restore your previous details and retry, or reload to start a new submission.', true);
    return;
  }
  const button = document.querySelector('#submit-button');
  busy(button, true, 'Submitting details');
  status('');
  let result;
  try { result = await request('submit', pendingSubmission); }
  catch (error) {
    status(`${error.message} Tracking ID: ${pendingSubmission.id}`, true);
    if (error.code === 'BAD_REQUEST') pendingSubmission = null;
    busy(button, false, 'Retry submission');
    return;
  }
  document.querySelector('#registration-fields').disabled = true;
  button.hidden = true;
  const container = document.querySelector('#result');
  container.innerHTML = `<div class="result-block"><span class="result-symbol">${icon(result.approved ? 'badge-check' : 'clock-3')}</span><h2>${result.approved ? 'You earned it.' : 'Submission received'}</h2><p>${result.approved ? 'Your certificate is approved and ready.' : 'Pending approval. We will email your download link once the organizer approves your submission.'}</p><div class="id-row"><code>${escape(result.id)}</code>${copyButton(result.id)}</div>${result.approved ? '<button id="download-again" class="button primary" type="button">Download certificate</button>' : ''}<a class="text-link" href="?route=register">Register for another program ${icon('arrow-right')}</a></div>`;
  attachCopy(); paintIcons();
  if (result.approved) {
    const download = document.querySelector('#download-again');
    download.addEventListener('click', () => performDownload(result.certificate, download));
    await performDownload(result.certificate, download);
  }
}

async function performDownload(certificate, button) {
  busy(button, true, 'Preparing PDF');
  try {
    const { template } = await request('template', {}, 'GET');
    await downloadCertificate(certificate, template || window.CERTIFICATE_CONFIG.template);
    status('Your PDF is ready. Use the download button if it did not open.');
  }
  catch (error) { status(`Your submission is saved. ${error.message}`, true); }
  finally { busy(button, false, 'Download certificate'); }
}

function certificateMarkup(certificate) {
  return `<div class="certificate-record"><div class="record-heading"><span class="result-symbol">${icon('shield-check')}</span><span class="badge approved">Verified certificate</span></div><h2>${escape(certificate.name)}</h2><p class="record-event">${escape(certificate.eventTitle)}</p><dl><div><dt>Event date</dt><dd>${escape(formatDate(certificate.eventDate))}</dd></div><div><dt>Issued by</dt><dd>${escape(certificate.issuer)}</dd></div><div><dt>Approved</dt><dd>${escape(formatDate(certificate.approvedAt))}</dd></div></dl><div class="id-row"><code>${escape(certificate.id)}</code>${copyButton(certificate.id)}</div></div>`;
}

async function verifyView() {
  app.innerHTML = `<section class="narrow-page">${heading('THE CERTIFICATE REGISTRY', 'Good work. Verified.', 'Check the authenticity of an Open Workshop certificate.')}<section class="lookup-section"><div class="section-title">${icon('shield-check')}<h2>Find a certificate</h2></div>${notice()}<form id="verify-form"><label for="certificate-id">Certificate ID</label><div class="search-row"><input id="certificate-id" name="id" required maxlength="51" placeholder="FORM-..." value="${escape(params.get('id') || '')}"><button class="button primary" type="submit">${icon('search')}<span>Verify</span></button></div></form><div id="status" class="status" role="status" hidden></div><div id="verification-result" aria-live="polite"></div></section><a class="text-link back-link" href="?route=register">${icon('arrow-left')} Back to the certificate desk</a></section>`;
  paintIcons();
  document.querySelector('#verify-form').addEventListener('submit', async event => {
    event.preventDefault();
    const id = document.querySelector('#certificate-id').value.trim().toUpperCase();
    if (!isValidId(id)) { status('Enter a complete certificate ID: FORM, a 13-digit timestamp, and a 32-character key.', true); return; }
    const button = event.currentTarget.querySelector('button');
    busy(button, true, 'Checking'); status('');
    document.querySelector('#verification-result').innerHTML = '';
    try {
      const { certificate } = await request('verify', { id }, 'GET');
      document.querySelector('#verification-result').innerHTML = certificateMarkup(certificate);
      attachCopy(); paintIcons();
    } catch (error) { status(error.message, true); }
    finally { busy(button, false, 'Verify'); }
  });
  if (params.get('id')) document.querySelector('#verify-form').requestSubmit();
}

async function downloadView() {
  app.innerHTML = `<section class="narrow-page">${heading('YOUR CERTIFICATE DESK', 'A well-earned download.', 'Your next chapter has a paper trail.')}<div id="status" class="status" role="status">Checking approval...</div><div id="download-result"></div><a class="text-link back-link" href="?route=register">${icon('arrow-left')} Back to the certificate desk</a></section>`;
  paintIcons();
  const id = params.get('id') || '';
  if (!isValidId(id)) { status('This download link is incomplete or invalid. Please check your approval email.', true); return; }
  try {
    const { certificate } = await request('download', { id }, 'GET');
    document.querySelector('#download-result').innerHTML = certificateMarkup(certificate) + '<button id="download-button" class="button primary" type="button">Download certificate</button>';
    attachCopy(); paintIcons();
    const button = document.querySelector('#download-button');
    button.addEventListener('click', () => performDownload(certificate, button));
    await performDownload(certificate, button);
  } catch (error) { status(error.message, true); }
}

function adminLogin(message = '') {
  session = '';
  submissions = [];
  app.innerHTML = `<section class="narrow-page admin-login">${heading('ORGANIZER ACCESS', 'The certificate desk.', 'Sign in to review submissions and manage approvals.')}<section class="lookup-section"><div class="section-title">${icon('lock-keyhole')}<h2>Admin sign in</h2></div>${notice()}<form id="login-form"><label for="login-method">Sign-in method</label><select id="login-method"><option value="password">Username and password</option><option value="key">Access key</option></select><div id="username-field" class="login-field"><label for="admin-username">Username</label><input id="admin-username" autocomplete="username" required maxlength="100"></div><div class="login-field"><label id="password-label" for="admin-secret">Password</label><input id="admin-secret" type="password" required autocomplete="current-password" maxlength="256"></div><button type="submit" class="button primary">Sign in ${icon('arrow-right')}</button></form><div id="status" role="status" class="status" ${message ? '' : 'hidden'}>${escape(message)}</div></section></section>`;
  paintIcons();
  document.querySelector('#login-method').addEventListener('change', event => {
    const useKey = event.target.value === 'key';
    document.querySelector('#username-field').hidden = useKey;
    document.querySelector('#admin-username').required = !useKey;
    document.querySelector('#password-label').textContent = useKey ? 'Admin access key' : 'Password';
    document.querySelector('#admin-secret').value = '';
  });
  document.querySelector('#login-form').addEventListener('submit', async event => {
    event.preventDefault();
    const input = document.querySelector('#admin-secret');
    const secret = input.value;
    const credentials = document.querySelector('#login-method').value === 'key' ? { secret } : {
      username: document.querySelector('#admin-username').value.trim(), password: secret
    };
    input.value = '';
    const button = event.currentTarget.querySelector('button');
    busy(button, true, 'Signing in');
    try {
      const result = await request('login', credentials);
      session = result.session;
      await adminView();
    } catch (error) { status(error.message, true); busy(button, false, 'Sign in'); }
  });
}

async function adminView() {
  app.innerHTML = `<section class="admin-page"><div class="admin-heading">${heading('ORGANIZER WORKSPACE', 'Submissions', 'Review the work. Recognize the learner.')}<div class="admin-actions"><button class="button secondary" id="edit-template">${icon('file-check-2')}<span>Template</span></button><button class="icon-button" id="refresh" title="Refresh submissions" aria-label="Refresh submissions">${icon('refresh-cw')}</button><button class="button secondary" id="logout">${icon('log-out')}<span>Sign out</span></button></div></div><div id="admin-stats" class="stats-strip"></div><div class="table-toolbar"><div class="filter-tabs" role="group" aria-label="Filter submissions"><button data-filter="all" class="active" aria-pressed="true">All submissions</button><button data-filter="pending" aria-pressed="false">Pending</button><button data-filter="approved" aria-pressed="false">Approved</button></div><label class="table-search">${icon('search')}<input id="admin-search" type="search" placeholder="Search name or ID" aria-label="Search submissions"></label></div><div id="status" class="status" role="status">Loading submissions...</div><div class="table-scroll"><table><caption class="sr-only">Certificate submissions</caption><thead><tr><th>Participant</th><th>Program</th><th>Submitted</th><th>Status</th><th>Email</th><th>Approved</th></tr></thead><tbody id="submission-rows"></tbody></table></div><p class="admin-footnote" id="row-count"></p></section>`;
  let filter = 'all';
  const render = () => renderRows(filter, document.querySelector('#admin-search').value);
  document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => {
    filter = button.dataset.filter;
    document.querySelectorAll('[data-filter]').forEach(item => { item.classList.toggle('active', item === button); item.setAttribute('aria-pressed', String(item === button)); });
    render();
  }));
  document.querySelector('#admin-search').addEventListener('input', render);
  document.querySelector('#edit-template').addEventListener('click', async () => {
    try {
      const { mountTemplateEditor } = await import('./template-editor.js');
      await mountTemplateEditor({ app, session, onBack: adminView, onUnauthorized: adminLogin });
    } catch (error) { status(error.message, true); }
  });
  document.querySelector('#refresh').addEventListener('click', () => loadSubmissions(render));
  document.querySelector('#logout').addEventListener('click', () => {
    const previous = session;
    adminLogin();
    request('logout', { session: previous }).catch(() => {});
  });
  document.querySelector('#submission-rows').addEventListener('change', async event => {
    const toggle = event.target.closest('[data-approve]');
    if (!toggle) return;
    const flag = toggle.checked ? 1 : 0;
    toggle.disabled = true;
    try {
      const result = await request('approve', { session, id: toggle.dataset.approve, flag });
      submissions = submissions.map(row => row.id === result.submission.id ? result.submission : row);
      status(result.submission.notification_status === 'failed' ? 'Approval saved. Email delivery failed; automatic retry is scheduled.' : 'Approval status updated.');
      render();
    } catch (error) {
      if (error.code === 'UNAUTHORIZED') { adminLogin(error.message); return; }
      toggle.checked = !flag;
      status(`${error.message} Refresh to confirm the saved status.`, true);
    } finally { toggle.disabled = false; }
  });
  paintIcons();
  await loadSubmissions(render);
}

async function loadSubmissions(render) {
  const button = document.querySelector('#refresh');
  button.disabled = true;
  status('Loading submissions...');
  try { const result = await request('list', { session }); submissions = result.submissions; status(''); render(); }
  catch (error) { if (error.code === 'UNAUTHORIZED') adminLogin(error.message); else status(error.message, true); }
  finally { button.disabled = false; }
}

function renderRows(filter, query) {
  const approved = submissions.filter(row => Number(row.flag) === 1).length;
  document.querySelector('#admin-stats').innerHTML = [
    ['users', 'Total submissions', submissions.length], ['hourglass', 'Awaiting approval', submissions.length - approved], ['file-check-2', 'Certificates approved', approved]
  ].map(([symbol, label, value]) => `<div class="stat">${icon(symbol)}<div><span>${label}</span><strong>${value}</strong></div></div>`).join('');
  const search = query.trim().toLowerCase();
  const rows = submissions.filter(row => (filter === 'all' || (Number(row.flag) === 1 ? 'approved' : 'pending') === filter) && `${row.name} ${row.id} ${row.email}`.toLowerCase().includes(search));
  document.querySelector('#submission-rows').innerHTML = rows.length ? rows.slice().reverse().map(row => {
    const approved = Number(row.flag) === 1;
    return `<tr><td><strong>${escape(row.name)}</strong><span>${escape(row.email)}</span><code class="table-id">${escape(row.id)}</code></td><td>${escape(row.event_title)}</td><td>${escape(formatDate(row.created_at))}</td><td><span class="badge ${approved ? 'approved' : 'pending'}">${approved ? 'Approved' : 'Pending'}</span></td><td><span class="mail-state ${row.notification_status === 'failed' ? 'error' : ''}" title="${escape(row.last_error || '')}">${escape(row.notification_status.replaceAll('_', ' '))}</span></td><td><label class="switch" title="${approved ? 'Revoke' : 'Approve'} certificate for ${escape(row.name)}"><input type="checkbox" role="switch" aria-label="Approve certificate for ${escape(row.name)}" data-approve="${escape(row.id)}" ${approved ? 'checked' : ''}><span></span></label></td></tr>`;
  }).join('') : '<tr><td colspan="6" class="empty-state">No submissions found.</td></tr>';
  document.querySelector('#row-count').textContent = `${rows.length} of ${submissions.length} submissions`;
  paintIcons();
}

document.querySelectorAll('[data-route]').forEach(link => {
  if (link.dataset.route === route || (route === 'download' && link.dataset.route === 'register')) link.setAttribute('aria-current', 'page');
});
if (route === 'admin') adminLogin();
else if (route === 'verify') verifyView();
else if (route === 'download') downloadView();
else registerView();