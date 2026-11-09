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
| `ADMIN_USERNAME` | Username for the admin sign-in form |
| `ADMIN_PASSWORD` | Strong, unique password of at least 16 characters, kept only in GAS |
| `ADMIN_SECRET` | Optional legacy access-key login: a cryptographically random secret with at least 32 characters |
| `SHEET_NAME` | Optional; defaults to `Submissions` |

4. Edit the server-owned `EVENTS` array in `Code.gs` with your programs, dates, issuers, and `Instant` / `Review` categories. The frontend fetches this catalog; it cannot choose its own approval flag.
5. Run `setup()` once from the Apps Script editor as the owner. Authorize Sheets, email sending, and trigger management. It creates headers and two **installable triggers**: `onEdit` and a ten-minute email retry job. Do not reorder or rename the columns. Use a new empty submissions tab, not a tab containing unrelated data.
6. Deploy **New deployment > Web app**, execute as **Me**, access **Anyone**. Copy the `/exec` URL, not `/dev`. Your Workspace administrator must allow public web apps. Never share spreadsheet edit access with submitters.
7. After GAS changes, update the deployment to a **new version**. Running `setup()` again does not duplicate its triggers.

Columns: `id`, `created_at`, `name`, `email`, `event_id`, `event_title`, `event_date`, `flag`, `approved_at`, `notification_status`, `notified_at`, `last_error`.

## 2. Connect and publish the frontend

Set `apiUrl` in `public/config.js` to the deployed GAS URL, or set the public build variable `VITE_GAS_URL` (which takes precedence). This configuration is public: **never put `ADMIN_SECRET`, passwords, or GitHub tokens in it, or in any `VITE_` variable**. Update the brand, text, and photo as appropriate for your organization.

```sh
npm ci
npm run dev
```

The dev URL is printed by Vite. Production:

```sh
npm run build
```

`npm run build` only generates deployment files; it does not start a web server or open the app. A successful build ends with `built in ...` and exit code 0. The large-chunk message is a performance advisory from the PDF/font dependencies, not a build failure. To inspect the built site locally, run:

```sh
npm run preview
```

Open the printed URL, normally `http://localhost:4173`. Do not open `dist/index.html` directly with a `file://` URL: module loading, configuration, and asset fetching need HTTP(S). An empty `VITE_GAS_URL` / `apiUrl` intentionally leaves registration disabled; building alone does not connect Google Sheets.

Publish only `dist/` to GitHub Pages, Cloudflare Pages, Netlify, or another static host. No API proxy or traditional backend is needed. The relative build base supports repository subdirectories. Keep `config.js`, the bundled scripts, and assets together. Rebuild after changing configuration.

Canonical links use `/?route=verify`, `/?route=admin`, and `/?route=download&id=...`. This works on GitHub Pages without rewrite rules. Clean `/verify`, `/admin`, and `/download` paths also work **when your static host rewrites them to `index.html`**; query routes are recommended for subdirectory hosting. Approval emails use the portable query route.

### Netlify Deployment

The included `netlify.toml` sets the build command to `npm run build`, publish directory to `dist`, Node.js to 22 for build tooling, and rewrites `/verify`, `/admin`, and `/download` to the static app. No Netlify Functions are used.

1. Import this repository into Netlify.
2. Add **`VITE_GAS_URL`** in Netlify's environment variables, available to **Builds**, with your deployed `https://script.google.com/macros/s/DEPLOYMENT_ID/exec` URL. This endpoint is public, not a credential. Set it for each deploy context that should use the service.
3. Configure Apps Script's Script Properties separately as shown below. Netlify environment variables are **not automatically forwarded to Google Apps Script**.
4. Deploy the site, then set Apps Script's `FRONTEND_URL` to your canonical Netlify/custom-domain HTTPS URL, without a trailing path, query, or hash. Email links will use this URL; preview deployments do not change it automatically.
5. Redeploy after changing `VITE_GAS_URL`; it is compiled into the public frontend at build time.

Mapping from the existing Netlify variables:

| Existing variable | Used by this app? | Required action |
| --- | --- | --- |
| `SPREADSHEET_ID` | In GAS only | Set the same ID in Apps Script Script Properties; Netlify does not need it |
| `SHEET_NAME` | In GAS only | Set `Submissions` in Apps Script Script Properties, or omit to use that default |
| `ADMIN_USERNAME` | In GAS only | Set the username in Apps Script Script Properties; Netlify does not forward it |
| `ADMIN_PASSWORD` | In GAS only | Set a strong password of at least 16 characters in Apps Script Script Properties; never expose it through `VITE_` variables |
| `REPO_OWNER`, `REPO_NAME`, `GIT_API` | No | No GitHub API integration is enabled; these are not needed for this app |

Keep any existing secrets needed by other deployments private; do not rename them with a `VITE_` prefix. Netlify's secret checkbox does not make a value safe once it is compiled into browser JavaScript. Do not copy secret values into the repository or deployment logs.

Before launch, test the deployed Netlify origin against GAS, approve a Review submission in the sheet, confirm the email links back to the canonical site, and verify that revocation blocks downloads.

## 3. Edit the certificate template

The bundled background is your supplied `public/assets/green.jpg`. The supplied JPEG designs contain baked-in placeholder wording such as "Name Surname", dates, signatures, and body copy. These pixels cannot be edited as text or removed by moving a dynamic field. Before issuing real certificates, export a clean design without placeholder names, dates, or body copy from Canva, then upload it in the editor. EPS files are not supported as browser/PDF backgrounds; export PNG or JPEG first. The included Noto Sans font is licensed under the adjacent OFL license.

### Edit In The Admin Portal

1. Update `gas/Code.gs` in Apps Script and deploy a **new version** before using the editor. Existing deployments do not gain API changes automatically.
2. Open `/?route=admin`. Enter your username and password. Existing installations can choose **Access key** instead.
3. Open **Template** from Submissions. Use **Replace artwork** to upload an A4 landscape PNG/JPEG, at most 2 MB. Uploaded artwork automatically switches off the sample headings.
4. Select a text field (name, program, date, ID, or verification URL). Drag it on the canvas or change its position, font size, and maximum width using the number inputs. Coordinates are PDF points, with the origin at the bottom left.
5. Adjust the preview name/program and download a preview PDF to inspect the result. Preview PDFs are marked **PREVIEW - NOT ISSUED** and use a dummy certificate ID; the preview values do not change participant records.
6. Click **Publish template**. New downloads, including email links and instant issuance, fetch the published template. Unsaved changes remain local and are not used for issuance.

The API stores image data and positions in a dedicated `Submissions_Template` tab (or `<SHEET_NAME>_Template`) **inside the same Google spreadsheet**. Artwork is split into chunks below Sheets' 50,000-character cell limit. No Drive bucket, GitHub token, Netlify Function, or additional database is required. The published background and layout are public certificate assets; do not include private data in the design. Replacing the template affects all future downloads, including re-downloads of older certificates; this implementation does not archive a separate layout per event or issuance.

The template tab is created on first publish. Do not edit its chunk data by hand. Publishing requires an authenticated admin session; if it expires, sign in again before editing. The restore button restores the repository's bundled template and layout as an unpublished change; publish it explicitly to make it live. If the background path is missing, the upload control remains available to replace it. The actual Canva artwork and its baked-in lettering cannot be edited as individual objects: export an updated image from Canva when changing that static design.

### Repository Defaults

For the initial fallback before any template is published, you can still configure the bundled artwork:

1. Export your Canva design as PNG or JPEG in A4 landscape (297 x 210 mm; preferably at least 1684 x 1190 px).
2. Replace the configured background asset. Keep the same A4 aspect ratio; the PDF fills an 841.89 x 595.28 point page.
3. In `public/config.js`, set `template.sample` to `false` if your artwork already contains the certificate heading and static labels.
4. Adjust `template.positions` for name, event, date, and ID (and optionally `verify`). Coordinates use PDF points: origin is **bottom left**, `x` is text center, `y` is baseline. `size` is the maximum font size; `maxWidth` controls automatic text fitting. Published settings in Sheets override these repository defaults.
5. Use a legally licensed TTF/OTF with coverage for your participants' languages and update `fontUrl`. Noto Sans covers Latin, Greek, and Cyrillic, not every world script. Unsupported glyphs produce an explicit error instead of a broken certificate. Complex-script shaping must be checked with your chosen font and actual names before launch.

`npm run assets` optionally generates a blank sample PNG at `public/assets/certificate-background.png`; it is not the selected background. To use it as the repository default, set that path in `public/config.js` and set `template.sample` to `true`. Do not run the generator after placing your own design at its output path because it overwrites that file. Template/font URLs must be same-origin or allow CORS. A public verification URL is also printed at the bottom of the PDF.

## API Contract

GET actions:

| Action | Parameters | Result |
| --- | --- | --- |
| `events` | none | Public event catalog |
| `template` | none | Published background/layout, or `null` to use repository defaults |
| `verify`, `download` | `id` | Approved certificate metadata, without email |
| `list` | `session` | Admin-only submissions; prefer POST to avoid putting sessions in URLs |

POST a JSON string using **`Content-Type: text/plain;charset=utf-8`** so browsers do not require a CORS preflight. Do not use `mode: no-cors`: its opaque response cannot confirm that a submission was accepted. Apps Script follows redirects to `script.googleusercontent.com`; use `redirect: follow`. Test cross-origin requests on the final deployed domain. CSP policies must allow both Google script domains.

| Action | Body fields |
| --- | --- |
| `submit` | `id`, `name`, `email`, `eventId` |
| `login` | `username`, `password`; or `secret` for legacy access-key login |
| `list`, `logout` | `session` |
| `approve` | `session`, `id`, `flag` (numeric 0 or 1) |
| `saveTemplate` | `session`, `template` (`url`, `fontUrl`, `sample`, `positions`) |

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

The admin route is public HTML; **every admin data access and mutation is authenticated by GAS**. Username/password credentials and optional access keys are checked using constant-time digest comparisons. Credential fields are editable but are never prefilled with server secrets. The frontend keeps the 30-minute session only in memory (not local storage); reloads require signing in again. Cache eviction may expire it sooner. Use HTTPS, strong unique credentials, and restrict spreadsheet and Apps Script editor access. Rotating credentials does not invalidate existing cached sessions until expiry; rotate the deployment if emergency immediate isolation is needed.

Public verification intentionally returns only name, program, issuer, dates, and ID. Treat IDs/download links as shareable bearer references, not private records. Obtain participant consent for this public disclosure and publish your organization's privacy/retention policy before production use. Email is only exposed to authenticated administrators. Sheet formula injection and frontend HTML injection are escaped.

The public submit and login endpoints have no CAPTCHA or robust per-user rate limit. For an open, high-traffic deployment, add server-validated anti-abuse controls and monitoring before launch. Shared admin credentials are suitable for a small trusted organizer team; use Workspace identity-based authorization for individual accounts, auditing, and stronger enterprise controls. Browser-side PDF generation is not a digital signature and cannot make downloaded PDFs tamper-proof.

The spreadsheet lookup is linear and admin listing loads all rows; this design targets small workshops within Apps Script quotas. Do not publish the spreadsheet itself. The optional GitHub `data.json` registry is **not enabled**, avoiding a second source of truth and stale revocations; Google Sheets is the sole registry.

## Checks

```sh
npm test
npx playwright install chromium
npm run test:browser
npm run build
npm audit
```

API tests execute `Code.gs` with mocked Google services. Browser tests intercept GAS requests and exercise instant PDFs, pending submissions, verification, download links, username/password admin login, approval, artwork upload, layout persistence, preview PDFs, desktop/mobile layout, and images. They do **not** substitute for deployment checks against Google: test anonymous submission, authenticated admin actions, a manual sheet approval, actual email receipt, cross-origin fetch behavior, template publication, revocation, and your real Canva layout before launch.