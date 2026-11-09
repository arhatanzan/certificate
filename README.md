# Open Workshop Certificate Desk

A static frontend with Google Apps Script as its only API and one Google spreadsheet as its database. PDFs are generated in the recipient's browser using `pdf-lib`; there is no Node.js or Python application backend. Vite and Node are local build/test tools only.

## 1. Deploy the Apps Script API first

1. Create a Google spreadsheet. Create a bound Apps Script project from **Extensions > Apps Script** (a standalone project also works).
2. Paste `gas/Code.gs` into `Code.gs`. In Project Settings, enable the manifest editor and replace its contents with `gas/appsscript.json`.
3. In **Project Settings > Script properties**, set:

| Property | Value |
| --- | --- |
| `SPREADSHEET_ID` | ID from the spreadsheet URL, not the entire URL |
| `FRONTEND_URL` | HTTPS deployment base URL, e.g. `https://example.com` or `https://name.github.io/certificate` (no query or hash) |
| `ADMIN_SECRET` | Cryptographically random secret with at least 32 characters; generate locally with `openssl rand -hex 32` |
| `SHEET_NAME` | Optional; defaults to `Submissions` |

4. Edit the server-owned `EVENTS` array in `Code.gs` with your programs, dates, issuers, and `Instant` / `Review` categories. The frontend fetches this catalog; it cannot choose its own approval flag.
5. Run `setup()` once from the Apps Script editor as the owner. Authorize Sheets, email sending, and trigger management. It creates headers and two **installable triggers**: `onEdit` and a ten-minute email retry job. Do not reorder or rename the columns. Use a new empty submissions tab, not a tab containing unrelated data.
6. Deploy **New deployment > Web app**, execute as **Me**, access **Anyone**. Copy the `/exec` URL, not `/dev`. Your Workspace administrator must allow public web apps. Never share spreadsheet edit access with submitters.
7. After GAS changes, update the deployment to a **new version**. Running `setup()` again does not duplicate its triggers.

Columns: `id`, `created_at`, `name`, `email`, `event_id`, `event_title`, `event_date`, `flag`, `approved_at`, `notification_status`, `notified_at`, `last_error`.

## 2. Connect and publish the frontend

Set `apiUrl` in `public/config.js` to the deployed GAS URL. This file is public: **never put `ADMIN_SECRET` in it**. Update the brand, text, and photo as appropriate for your organization.

```sh
npm ci
npm run dev
```

The dev URL is printed by Vite. Production:

```sh
npm run build
```

Publish only `dist/` to GitHub Pages, Cloudflare Pages, Netlify, or another static host. No API proxy or traditional backend is needed. The relative build base supports repository subdirectories. Keep `config.js`, the bundled scripts, and assets together. Rebuild after changing configuration.

Canonical links use `/?route=verify`, `/?route=admin`, and `/?route=download&id=...`. This works on GitHub Pages without rewrite rules. Clean `/verify`, `/admin`, and `/download` paths also work **when your static host rewrites them to `index.html`**; query routes are recommended for subdirectory hosting. Approval emails use the portable query route.

## 3. Replace the sample certificate

No Canva export was supplied. `public/assets/certificate-background.png` is a generated sample, not the final Canva artwork. The included Noto Sans font is licensed under the adjacent OFL license.

1. Export your Canva design as PNG or JPEG in A4 landscape (297 x 210 mm; preferably at least 1684 x 1190 px).
2. Replace the configured background asset. Keep the same A4 aspect ratio; the PDF fills an 841.89 x 595.28 point page.
3. In `public/config.js`, set `template.sample` to `false` if your artwork already contains the certificate heading and static labels.
4. Adjust `template.positions` for name, event, date, and ID. Coordinates use PDF points: origin is **bottom left**, `x` is text center, `y` is baseline. `size` is the maximum font size; `maxWidth` controls automatic text fitting.
5. Use a legally licensed TTF/OTF with coverage for your participants' languages and update `fontUrl`. Noto Sans covers Latin, Greek, and Cyrillic, not every world script. Unsupported glyphs produce an explicit error instead of a broken certificate. Complex-script shaping must be checked with your chosen font and actual names before launch.

`npm run assets` regenerates only the sample PNG and overwrites that file. Do not run it after replacing the sample with your real design. Template/font URLs must be same-origin or allow CORS. A public verification URL is also printed at the bottom of the PDF.

## API Contract

GET actions:

| Action | Parameters | Result |
| --- | --- | --- |
| `events` | none | Public event catalog |
| `verify`, `download` | `id` | Approved certificate metadata, without email |
| `list` | `session` | Admin-only submissions; prefer POST to avoid putting sessions in URLs |

POST a JSON string using **`Content-Type: text/plain;charset=utf-8`** so browsers do not require a CORS preflight. Do not use `mode: no-cors`: its opaque response cannot confirm that a submission was accepted. Apps Script follows redirects to `script.googleusercontent.com`; use `redirect: follow`. Test cross-origin requests on the final deployed domain. CSP policies must allow both Google script domains.

| Action | Body fields |
| --- | --- |
| `submit` | `id`, `name`, `email`, `eventId` |
| `login` | `secret` |
| `list`, `logout` | `session` |
| `approve` | `session`, `id`, `flag` (numeric 0 or 1) |

GAS ContentService does not support arbitrary HTTP response status codes. Expected application errors use HTTP 200 with `{ok:false,error:{code,message}}`; **both HTTP status and `ok` must be checked**. The client generates a timestamp plus 128 cryptographically random bits, and reuses the same ID when retrying an uncertain request. A script lock prevents duplicate row creation and concurrent approval operations. Reusing an ID with different details returns `CONFLICT`.

## Approval And Email Behavior

- Instant submissions are written with `flag=1` by GAS and immediately downloaded only after a successful API response. Their initial email state is `not_required`.
- Review submissions are written with `flag=0`. The form returns a tracking ID and does not issue a PDF.
- Admin API approval explicitly calls the mail handler. **API changes and `setValue()` never fire Sheets `onEdit` triggers.** Manual flag edits invoke the same handler through the installable trigger; the simple trigger invocation is ignored because it cannot send mail.
- Pasting a range that includes flag cells processes all affected rows. Set `0` to revoke, `1` to approve. Invalid flags are reset to `0`. Treat other columns as application-owned; this implementation does not support inventing incomplete submission rows by hand.
- Approval sends a unique download link, not an attachment. Clicking it rechecks the approved state and generates the PDF in the browser. The approval timestamp is preserved on repeated approval. Revocation clears notification markers, so later reapproval sends a fresh email.
- Mail failures leave the approval saved, record `failed` plus `last_error`, and are retried every ten minutes in batches of 25. Check Apps Script executions and MailApp quotas. Delivery is best effort, not exactly once: a crash between sending email and recording the timestamp can cause a duplicate. There is no email delivery receipt.
- Revocation blocks future verification and downloads but cannot remove an already downloaded PDF. The live registry is the authority.

## Security And Operational Limits

The admin route is public HTML; **every data access and mutation is authenticated by GAS**. The access key is checked using constant-time digest comparison. The frontend keeps the 30-minute session only in memory (not local storage); reloads require signing in again. Cache eviction may expire it sooner. Use HTTPS, a high-entropy secret, and restrict spreadsheet and Apps Script editor access. Rotating the secret does not invalidate existing cached sessions until expiry; rotate the deployment if emergency immediate isolation is needed.

Public verification intentionally returns only name, program, issuer, dates, and ID. Treat IDs/download links as shareable bearer references, not private records. Obtain participant consent for this public disclosure and publish your organization's privacy/retention policy before production use. Email is only exposed to authenticated administrators. Sheet formula injection and frontend HTML injection are escaped.

The public submit endpoint has no CAPTCHA or robust per-user rate limit. For an open, high-traffic deployment, add server-validated anti-abuse controls and monitoring before launch. The shared admin access key is suitable for a small trusted organizer team; use Workspace identity-based authorization for individual accounts, auditing, and stronger enterprise controls. Browser-side PDF generation is not a digital signature and cannot make downloaded PDFs tamper-proof.

The spreadsheet lookup is linear and admin listing loads all rows; this design targets small workshops within Apps Script quotas. Do not publish the spreadsheet itself. The optional GitHub `data.json` registry is **not enabled**, avoiding a second source of truth and stale revocations; Google Sheets is the sole registry.

## Checks

```sh
npm test
npx playwright install chromium
npm run test:browser
npm run build
npm audit
```

API tests execute `Code.gs` with mocked Google services. Browser tests intercept GAS requests and exercise instant PDFs, pending submissions, verification, download links, admin approval, desktop/mobile layout, and images. They do **not** substitute for deployment checks against Google: test anonymous submission, authenticated admin actions, a manual sheet approval, actual email receipt, cross-origin fetch behavior, revocation, and your real Canva layout before launch.