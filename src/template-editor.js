import { createIcons, Save, Upload, RotateCcw, Download, ArrowLeft, LoaderCircle, X, Eye, EyeOff, Trash2, Palette, Type } from 'lucide';
import { request } from './api.js';
import { downloadCertificate, formatDate } from './pdf.js';
import QRCode from 'qrcode';

const PAGE = { width: 841.89, height: 595.28 };
const fields = { name: 'Participant name', event: 'Program title', date: 'Event date', id: 'Certificate ID', verify: 'Verification URL', qr: 'QR Code' };
const symbols = { Save, Upload, RotateCcw, Download, ArrowLeft, LoaderCircle, X, Eye, EyeOff, Trash2, Palette, Type };
const defaultVerify = { x: 421, y: 67, size: 7, maxWidth: 700, color: '#1a453b', hidden: false };
const defaultQR = { x: 100, y: 100, size: 40, maxWidth: 100, color: '#000000', hidden: false };

function decorate() { createIcons({ icons: symbols }); }
function copy(value) { return structuredClone(value); }
function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The certificate background could not be loaded.'));
    image.src = new URL(url, document.baseURI).href;
  });
}
function fileUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('The artwork file could not be read.'));
    reader.readAsDataURL(file);
  });
}

export async function mountTemplateEditor({ app, session, onBack, onUnauthorized }) {
  const defaults = copy(window.CERTIFICATE_CONFIG.template);
  defaults.positions.verify ||= copy(defaultVerify);
  defaults.positions.qr ||= copy(defaultQR);
  // Ensure all positions have color and formatting attributes
  Object.values(defaults.positions).forEach(pos => {
    if (!pos.color) pos.color = '#1a453b';
    if (pos.bold === undefined) pos.bold = false;
    if (pos.italic === undefined) pos.italic = false;
    if (pos.hidden === undefined) pos.hidden = false;
  });
  let template = copy(defaults);
  let image;
  let changed = false;
  let saving = false;
  let selected = 'name';
  let dragging = false;
  let revision = 0;
  let loaded = false;
  let canReplace = false;
  const certificate = { id: 'FORM-0000000000000-' + '0'.repeat(32), name: 'Sample Participant', eventTitle: 'Sample Workshop', eventDate: '2026-11-20', issuer: 'Open Workshop', flag: 1, preview: true };

  app.innerHTML = `<section class="admin-page template-page"><div class="admin-heading"><div class="page-heading"><div class="eyebrow">ORGANIZER WORKSPACE</div><h1>Certificate template</h1></div><button id="template-back" class="button secondary"><i data-lucide="arrow-left"></i><span>Submissions</span></button></div><div class="template-toolbar"><div class="artwork-actions"><label class="button secondary upload-button" for="template-artwork"><i data-lucide="upload"></i><span>Replace artwork</span><input id="template-artwork" class="sr-only" type="file" accept="image/png,image/jpeg" disabled></label><span class="small-label">A4 LANDSCAPE / PNG OR JPEG / MAX 2 MB</span></div><div class="template-commands"><button id="template-preview" class="icon-button" title="Download preview PDF" aria-label="Download preview PDF" disabled><i data-lucide="download"></i></button><button id="template-reset" class="icon-button" title="Restore sample template" aria-label="Restore sample template" disabled><i data-lucide="rotate-ccw"></i></button><button id="template-save" class="button primary" disabled><i data-lucide="save"></i><span>Publish template</span></button></div></div><div id="template-status" class="status" role="status">Loading published template...</div><div class="template-workspace"><div class="template-preview-area"><canvas id="template-canvas" width="1684" height="1191" aria-label="Certificate layout preview"></canvas><span id="template-state" class="small-label">PUBLISHED TEMPLATE</span></div><form id="template-controls" class="template-controls"><fieldset id="template-fields" disabled><h2>Text placement</h2><div class="field-selection"><label for="template-field">Selected field</label><select id="template-field">${Object.entries(fields).map(([key, label]) => `<option value="${key}">${label}</option>`).join('')}</select><p class="small-label">Tip: Click text on the preview to select it</p></div><div class="coordinate-grid"><div><label for="template-x">Horizontal position (pt)</label><input id="template-x" type="number" min="0" max="841.89" step="0.01" required></div><div><label for="template-y">Vertical position (pt)</label><input id="template-y" type="number" min="0" max="595.28" step="0.01" required></div><div><label for="template-size">Font size (pt)</label><input id="template-size" type="number" min="6" max="80" step="0.5" required></div><div><label for="template-maxWidth">Maximum width (pt)</label><input id="template-maxWidth" type="number" min="10" max="800" step="0.5" required></div></div><div class="field-actions"><button type="button" id="template-toggle-visibility" class="icon-button action-btn" title="Toggle visibility"><i data-lucide="eye"></i><span>Show/Hide</span></button><button type="button" id="template-delete-field" class="icon-button action-btn danger" title="Delete text from certificate"><i data-lucide="trash-2"></i><span>Delete</span></button></div><div class="color-section"><label for="template-color"><i data-lucide="palette"></i> Text color</label><input id="template-color" type="color"></div><div class="formatting-section"><h3>Text formatting</h3><label class="consent"><input id="template-bold" type="checkbox"><span>Bold text</span></label><label class="consent"><input id="template-italic" type="checkbox"><span>Italic text</span></label></div><label class="consent"><input id="template-sample" type="checkbox"><span>Include sample headings</span></label><div class="preview-values"><h2>Preview values</h2><label for="preview-name">Preview name</label><input id="preview-name" maxlength="100" value="Sample Participant"><label for="preview-program">Preview program</label><input id="preview-program" maxlength="100" value="Sample Workshop"></div></fieldset></form></div></section>`;
  const element = selector => app.querySelector(selector);
  const canvas = element('#template-canvas');
  const context = canvas.getContext('2d');
  const save = element('#template-save');
  const report = (message, error = false) => {
    const status = element('#template-status');
    if (!status) return;
    status.textContent = message;
    status.hidden = !message;
    status.classList.toggle('error', error);
  };
  const markChanged = () => {
    changed = true;
    revision++;
    element('#template-state').textContent = 'UNPUBLISHED CHANGES';
  };
  const reflect = () => {
    const position = template.positions[selected];
    ['x', 'y', 'size', 'maxWidth'].forEach(key => { element(`#template-${key}`).value = position[key]; });
    element('#template-color').value = position.color || '#1a453b';
    element('#template-bold').checked = position.bold || false;
    element('#template-italic').checked = position.italic || false;
    element('#template-sample').checked = template.sample;
  };
  const drawText = (text, position) => {
    if (position.hidden) return;
    let size = position.size;
    let fontStyle = '';
    if (position.bold) fontStyle += 'bold ';
    if (position.italic) fontStyle += 'italic ';
    context.font = `${fontStyle}${size}px CertificatePreview`;
    while (context.measureText(text).width > position.maxWidth && size > 6) {
      size -= 0.5;
      context.font = `${fontStyle}${size}px CertificatePreview`;
    }
    context.fillStyle = position.color || '#1a453b';
    context.fillText(text, position.x, PAGE.height - position.y);
  };
  const drawQRCode = () => {
    const position = template.positions.qr;
    if (!position || position.hidden) return;
    try {
      const verification = new URL('./', document.baseURI);
      verification.search = new URLSearchParams({ route: 'verify', id: certificate.id });
      const canvas2d = document.createElement('canvas');
      QRCode.toCanvas(canvas2d, verification.href, { width: 200, margin: 0 }, (error) => {
        if (error) {
          console.error('QR code generation error:', error);
          return;
        }
        context.drawImage(canvas2d, position.x - position.size / 2, PAGE.height - position.y - position.size, position.size, position.size);
      });
    } catch (e) {
      console.error('QR code generation error:', e);
    }
  };
  const draw = () => {
    if (!image) return;
    context.setTransform(canvas.width / PAGE.width, 0, 0, canvas.height / PAGE.height, 0, 0);
    context.clearRect(0, 0, PAGE.width, PAGE.height);
    context.drawImage(image, 0, 0, PAGE.width, PAGE.height);
    context.textAlign = 'center';
    context.textBaseline = 'alphabetic';
    if (template.sample) {
      [[certificate.issuer, 484, 13], ['CERTIFICATE OF PARTICIPATION', 413, 26], ['Presented to', 365, 12], ['for completing', 272, 12]]
        .forEach(([text, y, size]) => drawText(text, { x: 421, y, size, maxWidth: 700, color: '#1a453b' }));
    }
    const verification = new URL('./', document.baseURI);
    verification.search = new URLSearchParams({ route: 'verify', id: certificate.id });
    const values = { name: certificate.name, event: certificate.eventTitle, date: formatDate(certificate.eventDate), id: certificate.id, verify: verification.href };
    Object.entries(values).forEach(([key, text]) => {
      if (template.positions[key]) drawText(text, template.positions[key]);
    });
    if (template.positions.qr) drawQRCode();
    const position = template.positions[selected];
    context.strokeStyle = '#cf9a23';
    context.lineWidth = 0.8;
    context.setLineDash([4, 3]);
    context.strokeRect(position.x - position.maxWidth / 2, PAGE.height - position.y - position.size, position.maxWidth, position.size + 5);
    context.setLineDash([]);
  };
  const enable = value => {
    element('#template-fields').disabled = !value;
    element('#template-artwork').disabled = !value;
    save.disabled = !value;
    element('#template-preview').disabled = !value;
    element('#template-reset').disabled = !value;
  };
  const unload = event => { if (changed) { event.preventDefault(); event.returnValue = ''; } };
  const cleanup = () => window.removeEventListener('beforeunload', unload);
  window.addEventListener('beforeunload', unload);
  element('#template-back').addEventListener('click', () => {
    if (saving || (changed && !window.confirm('Discard unpublished template changes?'))) return;
    cleanup();
    onBack();
  });
  element('#template-controls').addEventListener('submit', event => event.preventDefault());
  element('#template-field').addEventListener('change', event => { selected = event.target.value; reflect(); draw(); });
  ['x', 'y', 'size', 'maxWidth'].forEach(key => element(`#template-${key}`).addEventListener('input', event => {
    if (!event.target.validity.valid) return;
    template.positions[selected][key] = event.target.valueAsNumber;
    markChanged(); draw();
  }));
  element('#template-color').addEventListener('input', event => {
    template.positions[selected].color = event.target.value;
    markChanged(); draw();
  });
  element('#template-bold').addEventListener('change', event => {
    template.positions[selected].bold = event.target.checked;
    markChanged(); draw();
  });
  element('#template-italic').addEventListener('change', event => {
    template.positions[selected].italic = event.target.checked;
    markChanged(); draw();
  });
  element('#template-toggle-visibility').addEventListener('click', () => {
    template.positions[selected].hidden = !template.positions[selected].hidden;
    element('#template-toggle-visibility').innerHTML = template.positions[selected].hidden ? '<i data-lucide="eye-off"></i><span>Show</span>' : '<i data-lucide="eye"></i><span>Hide</span>';
    decorate();
    markChanged(); draw();
  });
  element('#template-delete-field').addEventListener('click', () => {
    if (confirm(`Delete the ${fields[selected]} field from the certificate?`)) {
      template.positions[selected].hidden = true;
      markChanged(); draw();
    }
  });
  element('#template-sample').addEventListener('change', event => { template.sample = event.target.checked; markChanged(); draw(); });
  element('#preview-name').addEventListener('input', event => { certificate.name = event.target.value; draw(); });
  element('#preview-program').addEventListener('input', event => { certificate.eventTitle = event.target.value; draw(); });
  const move = event => {
    const rect = canvas.getBoundingClientRect();
    const position = template.positions[selected];
    position.x = Math.round(Math.max(position.maxWidth / 2, Math.min(PAGE.width - position.maxWidth / 2, (event.clientX - rect.left) / rect.width * PAGE.width)) * 100) / 100;
    position.y = Math.round(Math.max(0, Math.min(PAGE.height, PAGE.height - (event.clientY - rect.top) / rect.height * PAGE.height)) * 100) / 100;
    markChanged(); reflect(); draw();
  };
  const getFieldAtPoint = (x, y) => {
    const clickThreshold = 40;
    for (const [key, pos] of Object.entries(template.positions)) {
      if (pos.hidden) continue;
      const distance = Math.sqrt((pos.x - x) ** 2 + (pos.y - y) ** 2);
      if (distance < clickThreshold) return key;
    }
    return null;
  };
  canvas.addEventListener('click', event => {
    if (!loaded || dragging || saving) return;
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width * PAGE.width;
    const y = PAGE.height - (event.clientY - rect.top) / rect.height * PAGE.height;
    const fieldKey = getFieldAtPoint(x, y);
    if (fieldKey) {
      selected = fieldKey;
      element('#template-field').value = fieldKey;
      reflect(); draw();
    }
  });
  canvas.addEventListener('pointerdown', event => { if (!loaded || saving) return; dragging = true; canvas.setPointerCapture(event.pointerId); move(event); });
  canvas.addEventListener('pointermove', event => { if (dragging) move(event); });
  canvas.addEventListener('pointerup', () => { dragging = false; });
  canvas.addEventListener('pointercancel', () => { dragging = false; });
  element('#template-artwork').addEventListener('change', async event => {
    const file = event.target.files[0];
    if (!file) return;
    enable(false);
    try {
      if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 2097152) throw new Error('Choose a PNG or JPEG background of at most 2 MB.');
      const url = await fileUrl(file);
      const replacement = await loadImage(url);
      if (Math.abs(replacement.naturalWidth / replacement.naturalHeight - PAGE.width / PAGE.height) > 0.04) throw new Error('Export the artwork as A4 landscape (297 x 210 mm).');
      if (replacement.naturalWidth > 10000 || replacement.naturalHeight > 10000) throw new Error('Artwork dimensions must not exceed 10,000 pixels.');
      template.url = url;
      template.sample = false;
      image = replacement;
      loaded = true;
      markChanged(); reflect(); draw(); report('Artwork loaded. Changes are not published yet.');
    } catch (error) { report(error.message, true); }
    finally { event.target.value = ''; enable(loaded); element('#template-artwork').disabled = false; }
  });
  element('#template-reset').addEventListener('click', async () => {
    enable(false);
    try { const replacement = await loadImage(defaults.url); template = copy(defaults); image = replacement; markChanged(); reflect(); draw(); report('Sample restored. Changes are not published yet.'); }
    catch (error) { report(error.message, true); }
    finally { enable(true); }
  });
  element('#template-preview').addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try { await downloadCertificate(certificate, copy(template)); report('Preview PDF downloaded.'); }
    catch (error) { report(error.message, true); }
    finally { button.disabled = false; }
  });
  save.addEventListener('click', async () => {
    if (!element('#template-controls').reportValidity()) return;
    saving = true;
    const publishedRevision = revision;
    enable(false);
    save.innerHTML = '<i data-lucide="loader-circle" class="spin"></i><span>Publishing</span>';
    decorate();
    try {
      await request('saveTemplate', { session, template: copy(template) });
      changed = revision !== publishedRevision;
      element('#template-state').textContent = changed ? 'UNPUBLISHED CHANGES' : 'PUBLISHED TEMPLATE';
      report('Template published. New certificate downloads will use this layout.');
    } catch (error) {
      if (error.code === 'UNAUTHORIZED') { cleanup(); onUnauthorized(error.message); return; }
      report(error.message, true);
    } finally {
      saving = false;
      if (app.contains(save)) { save.innerHTML = '<i data-lucide="save"></i><span>Publish template</span>'; enable(true); decorate(); }
    }
  });
  decorate();
  try {
    const result = await request('template', {}, 'GET');
    template = copy(result.template || defaults);
    template.positions.verify ||= copy(defaultVerify);
    const font = new FontFace('CertificatePreview', `url("${new URL(template.fontUrl, document.baseURI).href}")`);
    document.fonts.add(await font.load());
    canReplace = true;
    image = await loadImage(template.url);
    loaded = true;
    reflect(); draw(); enable(true); report('');
  } catch (error) { report(error.message, true); if (canReplace) element('#template-artwork').disabled = false; }
}