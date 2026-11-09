import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

async function asset(url) {
  const response = await fetch(new URL(url, document.baseURI));
  if (!response.ok) throw new Error('Certificate artwork or font could not be loaded. Contact the organizer.');
  if ((response.headers.get('content-type') || '').includes('text/html')) throw new Error('The configured certificate asset is missing. Update the artwork or font path.');
  return new Uint8Array(await response.arrayBuffer());
}

function centered(page, font, value, position, color = rgb(0.10, 0.27, 0.23)) {
  let size = position.size;
  const text = String(value);
  const supported = new Set(font.getCharacterSet());
  if ([...text].some(character => !supported.has(character.codePointAt(0)))) {
    throw new Error('The certificate font does not support a character in your details. Ask the organizer to configure a compatible font.');
  }
  while (font.widthOfTextAtSize(text, size) > position.maxWidth && size > 6) size -= 0.5;
  if (font.widthOfTextAtSize(text, size) > position.maxWidth) throw new Error('Certificate text is too long for this template.');
  page.drawText(text, { x: position.x - font.widthOfTextAtSize(text, size) / 2, y: position.y, size, font, color });
}

export async function generateCertificate(certificate, config = window.CERTIFICATE_CONFIG.template) {
  if (Number(certificate.flag) !== 1) throw new Error('This certificate has not been approved.');
  const [background, fontBytes] = await Promise.all([asset(config.url), asset(config.fontUrl)]);
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(fontBytes, { subset: true });
  const isPng = background[0] === 0x89 && background[1] === 0x50 && background[2] === 0x4e && background[3] === 0x47;
  const isJpeg = background[0] === 0xff && background[1] === 0xd8 && background[2] === 0xff;
  if (!isPng && !isJpeg) throw new Error('The configured artwork is not a PNG or JPEG image. Upload a supported background in the admin template editor.');
  const image = isPng ? await pdf.embedPng(background) : await pdf.embedJpg(background);
  const page = pdf.addPage([841.89, 595.28]);
  page.drawImage(image, { x: 0, y: 0, width: 841.89, height: 595.28 });
  if (config.sample) {
    centered(page, font, certificate.issuer, { x: 421, y: 484, size: 13, maxWidth: 650 });
    centered(page, font, 'CERTIFICATE OF PARTICIPATION', { x: 421, y: 413, size: 26, maxWidth: 700 });
    centered(page, font, 'Presented to', { x: 421, y: 365, size: 12, maxWidth: 500 });
    centered(page, font, 'for completing', { x: 421, y: 272, size: 12, maxWidth: 500 });
  }
  centered(page, font, certificate.name, config.positions.name);
  centered(page, font, certificate.eventTitle, config.positions.event);
  centered(page, font, formatDate(certificate.eventDate), config.positions.date);
  centered(page, font, certificate.id, config.positions.id);
  const verifyUrl = new URL('./', document.baseURI);
  verifyUrl.search = new URLSearchParams({ route: 'verify', id: certificate.id });
  centered(page, font, verifyUrl.href, config.positions.verify || { x: 421, y: 67, size: 7, maxWidth: 700 });
  if (certificate.preview) centered(page, font, 'PREVIEW - NOT ISSUED', { x: 421, y: 22, size: 9, maxWidth: 500 }, rgb(0.65, 0.16, 0.12));
  pdf.setTitle(`${certificate.eventTitle} - ${certificate.name}`);
  pdf.setAuthor(certificate.issuer);
  pdf.setSubject(`Certificate ${certificate.id}`);
  return pdf.save();
}

export async function downloadCertificate(certificate, config) {
  const bytes = await generateCertificate(certificate, config);
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${certificate.id}.pdf`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export function formatDate(value) {
  if (!value) return 'Not recorded';
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00Z` : value);
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' }).format(date);
}