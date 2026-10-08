# Employee Email KPI Analyzer

A web app that turns **emails you copy out of Outlook** into a **monthly employee email KPI report** — and runs **entirely in your browser**.

```
Outlook → filter/select emails → Copy → paste here → Analyze → Review → Monthly report → Export Excel
```

- **Live site (after the one-time GitHub Pages setup below):** https://ahr87.github.io/employee-email-kpi-analyzer/
- **No Outlook connection** of any kind — no Microsoft Graph, no OAuth, no mailbox access. You paste text.
- **No server, no database server, no accounts.** The site is a set of static files on GitHub Pages. Parsing, classification, duplicate detection, KPI and Excel/CSV generation all run in your browser; your employees and emails are stored in **your browser's IndexedDB** and never uploaded anywhere. The only network access is the initial download of the app itself (and after that it also works offline).
- Works with no AI and never calls an AI service.

## What it does

For every email an employee sent to NMC during a selected month, the app decides what happened to it:

| Final classification | Meaning |
|---|---|
| **Forwarded / Escalated** | Useful; NMC forwarded/escalated it to the right team |
| **Not Useful / Replied** | Unnecessary, non-actionable or already known; NMC replied without escalating |
| **Duplicate** | Another employee already reported the same incident |
| **Pending Review** | Not enough evidence — you decide |
| **Other** | Valid case that fits none of the above (manual choice) |

Every automatic result has a **confidence (0–100)** and a **human-readable reason**. Anything below the confidence threshold (default 75) lands in the **Review** queue. You can override any result; the KPI always uses the **final** classification.

Email **volume** and email **quality** are kept separate: the KPI score never rewards sending more emails.

## Using the app (nothing to install)

Open https://ahr87.github.io/employee-email-kpi-analyzer/ → follow the seven steps on the first page: add employees → set NMC addresses → select the month → paste Outlook emails → Analyze → review → report.
Try it first with **Settings → Load synthetic demo data** (fictional people; stored only in your browser).

## Local development

Requirements: Node.js 20+ (tested on 22) and npm. No database, no `.env`, no API keys.

```bash
npm install
npm run dev            # http://localhost:3000   (hot reload, no base path)
npm run build          # static site -> ./out   (base path /employee-email-kpi-analyzer, like GitHub Pages)
npm start              # serves ./out at http://127.0.0.1:4173/employee-email-kpi-analyzer/ — the same layout as GitHub Pages
```

Checks:

```bash
npm run lint && npm run typecheck
npm test               # Vitest: parser, classifier, duplicates, KPI, IndexedDB storage, backup/restore, simulation, performance
npm run test:e2e       # Playwright: builds the site, serves it under the Pages base path, drives the whole workflow
```
If Playwright cannot find a browser, set `PW_CHROMIUM=/path/to/chrome`.

## GitHub Pages deployment

The site is published by `.github/workflows/deploy.yml`:

1. You **push (or merge) to `main`**.
2. **GitHub Actions** checks out the code, runs `npm ci`, lint, typecheck and the tests, then `npm run build` (Next.js static export into `out/`).
3. **GitHub Pages** publishes `out/` at **https://ahr87.github.io/employee-email-kpi-analyzer/**.

**One-time setting** (needed once per repository): GitHub → *Settings* → *Pages* → *Build and deployment* → **Source: GitHub Actions**.

Only `main` is deployed. Other branches run `.github/workflows/ci.yml` (lint, typecheck, tests, build) without deploying. Nothing has to be copied by hand after an update.

How the static build works: `next.config.ts` sets `output: "export"`, `basePath`/`assetPrefix` = `/employee-email-kpi-analyzer` (central place: `src/lib/config.ts` + `next.config.ts`), `trailingSlash: true` (every page is its own `…/index.html`, so refreshing any page works on static hosting) and unoptimized images. Detail pages use query strings (`/email/?id=…`, `/employee/?id=…`) because static hosting has no dynamic routes. `scripts/postbuild.mjs` writes the offline cache list. `public/.nojekyll` is included.

## Local data (important)

Everything you enter — employees, pasted emails, classifications, manual decisions, settings, audit log — is stored **in this browser on this device** (IndexedDB), and is still there when you close the browser and open the site later. It is **not** synchronised between browsers or computers.

- **Settings → Local data** shows what is stored (and the storage used), and offers **Export backup**, **Restore backup…** and **Clear all local data**.
- If you clear the browser's site data, use a different browser/profile/computer, or open a private window, **the data will not be there** unless you restored a backup. Export a backup regularly — it is one JSON file.
- The app asks the browser to keep its data persistently; browsers may still evict data under extreme storage pressure.
- Several tabs: when one tab changes the data, other open tabs re-read it and show a "Reload" notice, so a stale tab never overwrites newer data.

### Backup and restore

- **Export backup** downloads `employee-email-kpi-backup-YYYY-MM-DD.json` with employees, batches, emails (including the exact pasted source), classifications, manual overrides, settings (KPI, NMC addresses, phrases, thresholds) and the audit log. No temporary UI state. **It contains your pasted emails — keep it private; never commit it** (`.gitignore` blocks `employee-email-kpi-backup-*.json`).
- **Restore backup…** validates the file completely first (format, version, field types, links between records). A file that fails validation is rejected with the reasons and **nothing is changed**. A valid file is shown with a summary and only replaces the current data after you confirm.
- **Clear all local data** requires typing `DELETE` and states clearly: *this deletes all employee, email, KPI and analysis data stored in this browser*.

### Offline

After the first visit a service worker caches the app (pages and scripts), so it opens and works without internet: analyze pasted emails, review, KPI, search, filter, Excel/CSV export and backups all run locally. A new deployment is picked up the next time you are online.

## Importing an Outlook Desktop export (JSON)

Besides **Paste & Analyze**, **Import Outlook Export** reads the JSON file written by the Outlook VBA exporter (`KPI_Outlook_Export_YYYYMMDD_HHMMSS.json`). Everything happens in the browser; the file is never uploaded.

```json
{ "exportedAt": "…", "source": "Outlook Desktop",
  "emails": [ { "entryId": "…", "conversationId": "…", "subject": "…", "from": "…", "fromEmail": "…",
                "to": "…", "cc": "…", "receivedAt": "…", "body": "…", "htmlBody": "…" } ] }
```

**Workflow.** Choose file → *preview* (messages, valid/invalid, date range, senders, conversations, employees matched/unmatched, potential duplicates, quoted/signature/HTML counts; invalid messages are listed and never block the rest) → **Import & Analyze** (chunked, with progress and cancel). Clearly invalid files (not JSON, wrong `source`, no `emails`) are rejected with a message. Every import creates a batch (source *Outlook Desktop*, file name, date range, message/sender/conversation counts) shown on the Import page, the Emails list and the Dashboard.

**Normalization.** The original message (plain + HTML) is stored untouched in a separate `raw` table (HTML gzip-compressed, loaded lazily). Analysis uses a *normalized copy*: plain body (or the HTML converted to safe text when the plain body is empty/much shorter — script/style/head dropped, tables become tab-separated rows, unsafe links removed, HTML is never rendered) → quoted history removed → signature/disclaimer removed. Ticket numbers, host names, IPs, circuits and locations are extracted from the normalized text, including HTML tables (`DeviceName / Problem / ZbxProStart / TicketNO`).

**Quoted/previous messages.** A reusable detector (`src/lib/outlook/quoted.ts`) cuts at separator lines + `From/Sent/To/Cc/Subject` header blocks (English, Arabic, French, German, Spanish), `On … wrote:`, `-----Original Message-----`, *Begin forwarded message* and `>` runs. Quoted history is not counted as new emails or KPI activity. The top-level `fromEmail` is always the sender — an embedded `From:` in a forwarded body is quoted content.

**Duplicate prevention.** Priority: `entryId` → `conversationId + received minute + sender + subject` → content hash → quoted-copy/Message-ID checks → the existing semantic duplicate detection. The same file twice, or the same message in two files, imports nothing new.

**Employee matching.** By `fromEmail` only (display-name fallback is disabled for Outlook messages). Senders that are neither employees nor configured NMC addresses are kept as *evidence only* (kind `EXTERNAL`, listed under *Other senders*); they are not counted in any employee KPI and do not flood Review. NMC messages are evidence, linked by `conversationId` (strongest key, stored as `externalConversationId`, falling back to subject), subject, timestamp order and the NMC addresses in Settings.

**Months.** `receivedAt` is authoritative. Default mode: each message goes to the month it was received (a multi-month export fills several months). Alternative: only the selected month counts; others are stored and listed in Review ("outside selected month"). Offsets in ISO timestamps are converted to your local time; naive timestamps are used as written.

**Large files.** The file is streamed in chunks and handled one message at a time (two passes: preview, then import); 5,000 synthetic messages are covered by an automated test.

**Backup.** Backups include the original Outlook plain bodies/headers; the original HTML is added only if you tick *Include original Outlook HTML*.

> **Compatibility.** The reader is written against the documented structure above and tested with *anonymized synthetic* files that mimic it (BOM, CRLF, raw control characters, Arabic UTF-8, HTML tables, signatures, quoted history). It has **not** been tested with a real Outlook export file in this repository — verify with your own file's preview first.

## Daily workflow

1. **Employees** – add or import your employees once (CSV/Excel: `Employee ID, Employee Name, Email Address, Department, Team, Active`; export any time). The sender **e-mail address** is the matching key (case-insensitive). If Outlook copied only a display name, a *unique exact name* match is accepted as a fallback.
2. **Settings → NMC addresses**: add one or more addresses or `@domains` (add / edit / delete / enable-disable). Messages from these senders are recognised as NMC replies/forwards inside copied conversations. They are kept as **evidence** and never counted as employee emails.
3. **Paste & Analyze**: choose year + month, paste the emails — single emails, many emails, or whole reply/forward chains (include the NMC replies and forwards!) — and click **Analyze Emails**. The import summary shows: imported, exact duplicates ignored, matched employees, unmatched, automatically classified, review required, out-of-month, and evidence-only messages. It stays visible when you navigate away and come back.
4. **Review**: one click per item — **Confirm · Forwarded · Not Useful · Duplicate… · Pending · Other**. *Duplicate…* opens a picker to choose the original email (the system's suggestion is pre-marked). Unmatched senders can be assigned to an employee; out-of-month emails can be included or excluded.
5. **Dashboard / Reports**: totals, per-employee table, KPI. Manual decisions change them immediately. **Reports → Export Excel / CSV** (or *Print / PDF* via the browser).

Every paste is a **batch**; batches are strictly additive and attached to the selected month. Pasting never resets earlier data. Month history is kept.

## Architecture

```
Browser ── static files from GitHub Pages (HTML/JS/CSS) ──► React UI (Next.js static export)
   │
   ├─ UI (src/app, src/components)           pages, tables, charts, dialogs
   ├─ Business logic (src/lib/…, no I/O)     parser · classification · duplicate-detection · kpi · employees/matching
   ├─ Import & analysis (src/lib/import)     batches, exact-duplicate prevention, conversation model, review reasons
   ├─ Reports (src/lib/reports)              aggregation, CSV, Excel (ExcelJS, loaded on demand)
   ├─ Backup (src/lib/backup)                export / validate / restore
   └─ Storage (src/lib/storage, src/lib/db)  StorageAdapter  →  IndexedDbAdapter (production)  /  MemoryAdapter (tests, fallback)
```

```
src/
  app/            Next.js pages (static export): dashboard, import, emails, email/?id=, review, employees, employee/?id=, reports, settings
  components/     UI kit, charts, review actions, local-data card, shell
  lib/
    storage/      storage.ts (StorageAdapter interface, MemoryAdapter) · indexeddb.ts (IndexedDbAdapter) · types.ts (record shapes)
    db/           in-memory working copy of the stored tables, atomic write-through, cross-tab refresh
    parser/ classification/ duplicate-detection/ kpi/ employees/   the engines (unchanged by the move to the browser)
    import/       importer, analyze (conversation model + classification), emails (queries/manual actions), batches
    reports/      aggregate, excel, csv, export (download)
    backup/ data-management/ settings/ audit/ demo/ utils/ config.ts
  scripts/        serve-static.mjs (Pages-like local server), postbuild.mjs (offline manifest)
tests/ e2e/       Vitest and Playwright
```

**Business logic never touches IndexedDB directly** — it talks to `getDb()`; swapping the storage means writing another `StorageAdapter`. All writes go to storage first, in one transaction per operation (e.g. a batch and its emails are stored together or not at all), and only then to the in-memory copy that queries run on.

### Data model

Tables (object stores): `employees`, `batches`, `emails`, `audit`, `settings` — fields are listed in `src/lib/storage/types.ts`. Each email stores the parsed fields, the exact pasted source (`rawSource`), extracted entities, classification (`autoClass`, `confidence`, `reason`, `finalClass`, `isManual`, `overrideReason`), duplicate links, review status/reasons, and identity hashes (`contentHash`, `looseHash`) used for exact-duplicate prevention.

### Key decisions

- **IndexedDB + in-memory working set**: thousands of emails fit comfortably in memory (2,000 emails import, analyze and back up in about a second in tests); queries are plain functions over arrays.
- **Dates** are wall-clock values stored as UTC (no time-zone conversion), so the month never shifts.
- **Static export** (no SSR, no API routes, no server actions): every former `/api/...` call is now a direct function call into the local data layer.
- **PDF**: via the browser's Print dialog (print stylesheet), Excel/CSV are generated in the browser.

## Parsing (copy/paste from Outlook)

The parser is a separate module (`src/lib/parser`) tested with strings shaped like real Outlook clipboard text (`tests/helpers.ts` builds several styles). It handles:

- **Header blocks** `From / Sent / To / Cc / Subject` (also `Date`, `Received`, `Sender`, …) in English **and Arabic** (`من / تم الإرسال / إلى / نسخة / الموضوع`). Values may be on the same line or on the **next line** (`From:⏎Ahmed Ali [mailto:…]`), blank lines between header lines are tolerated, `Importance:`/`Attachments:` lines are skipped, wrapped recipient lists are joined.
- **Addresses**: `Name <a@b>`, `Name [a@b]`, `Name [mailto:a@b]`, markdown-style `Name [a@b](mailto:a@b)`, bare addresses, name-only (→ uncertain, never invented).
- **Dates**: `Monday, September 14, 2026 10:32 AM`, `14 September 2026`, `September 14, 2026`, `14/09/2026 10:32`, `09/14/2026`, `2026-09-14`, `14-Sep-2026`, 2-digit years, Arabic month names/digits and Arabic AM/PM. **Ambiguous** numeric dates (`03/04/2026`) follow the Settings order, the alternative reading is kept, and the email is flagged **only if the other reading would change its month**. If a pasted date proves the order (e.g. `25/04`), that order is used, saved to Settings and ambiguity flags stop; mixed evidence produces a warning.
- **Reply / forward chains**: every header block becomes its own message, so an NMC reply and a forward that sit *below* each other are separated into original / reply / forward (messages found inside a chain are marked *quoted*). `-----Original Message-----`, `________`, `Begin forwarded message`, `On … wrote:` and `>` quoting are recognised and removed from bodies.
- **Arabic / mixed text and RTL marks**: header detection runs on a normalised *view* (bidi marks, Arabic-Indic digits, letter variants); **stored bodies and `rawSource` keep the exact pasted characters**. Normalised text is used only for analysis (phrase matching, similarity, entity extraction).
- **HTML**: a plain-text paste is kept verbatim. Only if no headers are found and the text looks like HTML source is it converted to text (scripts/styles/comments removed, tags stripped, entities decoded). Email content is **always displayed as escaped text** and a Content-Security-Policy blocks inline remote loading.
- Anything that cannot be determined is marked **uncertain** (missing sender → Unmatched, missing date → Review). A paste without any headers becomes one email with uncertain fields and a warning.

## Conversation model

Messages with the same normalised subject (ignoring `RE:`/`FW:`/`رد:`/`إعادة توجيه:`) form a conversation. Per conversation:

| Kind | Rule | Counted in KPI |
|---|---|---|
| **NMC** | sender matches an enabled NMC address | no — evidence |
| **Follow-up** | later message with a reply/forward prefix, or a repeat from a sender who already wrote in the conversation (employee "thanks", department replies) | no — evidence |
| **Report** | everything else (the employee's original email) | **yes** |

Messages found twice (e.g. an original that is also quoted inside a later chain) are the same email: the identity key is *sender + minute + conversation subject*, so quoted copies are never imported again.

## Classification logic

Deterministic and explainable; **keywords are evidence, not truth**. A phrase only counts if it appears in an **NMC message after the employee's email** (never in the employee's own text), and negated uses (“not forwarded”, “لم يتم”) are skipped. Without evidence the answer is **Pending Review** — an escalation or reply is never invented.

1. **Business duplicate** (below) → `DUPLICATE`.
2. **Forward score**: NMC `FW:` (+55), NMC added recipients outside the conversation (+15–20, +10 if it looks like a team), escalation phrase (+30…), a ticket/incident number raised by NMC (+15), a reply from another party after the forward (+15), acknowledgement phrases only *reinforce* existing evidence. **No-action score**: no-action phrase (+45…), plain NMC reply without escalation (+15). **Duplicate wording** from NMC (“already reported”) → `DUPLICATE` for review if the original is unknown.
3. Decision: strong forward → `FORWARDED`; strong no-action → `NOT_USEFUL`; both strong and close → `PENDING_REVIEW` (contradictory); otherwise `PENDING_REVIEW`. Confidence grows with evidence; below the threshold (default 75) → Review.

Phrase lists (**escalation / not useful / duplicate / useful-action**) are editable in Settings (English + Arabic; letter variants and diacritics are ignored) and *Reset to defaults* is available. Saving settings can re-analyze all months (manual decisions protected).

Review reasons: unmatched employee, missing date, ambiguous date, outside month, low confidence, possible duplicate, contradictory evidence, no evidence.

## Duplicate detection

- **Exact duplicate** – the same email pasted again (also as a quoted copy in a chain; also by `Message-ID` when present). Not imported again; reported in the summary.
- **Business duplicate** – *different employees* about the same underlying incident. Evidence tiers: **very strong** = same incident/ticket number, same circuit ID (score ≥ 93); **strong** = same service ID (+location), same device name or IP address (≥ 84–90); **medium** = same specific place + same type of issue (outage/slow/unstable…, English/Arabic/dialect) within 2 h, plus weighted subject/body/technology similarity; **weak** = similar wording only — capped below the threshold unless a place or identifier is shared. Different places reduce the score. Signatures/disclaimers are ignored when extracting places.
- **Original selection**: the **earliest by timestamp** (never by paste order); on equal timestamps the email carrying an incident/ticket number; chains resolve to the root. The reason reads like “Same service ID (svc-90017) and same location (karrada); Ahmed Ali reported the issue 11 minutes earlier. Similarity 94%.” Near-misses become *possible duplicate* review items.
- In Review you can pick any email as the original manually.

## KPI settings

`Settings → KPI` (applies instantly to all reports, no re-analysis): per-class weights (default Forwarded 1, Other 0.5, others 0), pending handling (exclude or weighted), penalties per Duplicate/Not-Useful email, minimum emails to score, target, rating bands. Score = `Σ weight × count / scored emails × 100 − penalties`, clamped 0–100. The engine (`src/lib/kpi/engine.ts`) is a pure function over final counts, so you can change or replace the formula without touching classification.

## Reports & export

*Reports → Export Excel* produces six sheets with frozen headers, filters and readable widths: **Summary** (management view: month totals + employee table with KPI/rating, no email text), **Employee Details** (shares, avoidable %, volume vs. quality), **Email Details** (no bodies), **Classification Summary**, **Review Required**, **Employees**. CSV exports the employee summary. CSV cells starting with `= + - @` are neutralised against spreadsheet formula injection.

## Privacy & security

- **Your data stays on your device.** There is no backend. The app makes no network requests other than loading its own static files; the Content-Security-Policy (set as a `<meta>` tag, since static hosting cannot send headers) allows only same-origin resources. The end-to-end test asserts that no request other than the app's own files is ever made.
- **Nothing sensitive in Git**: `.env`, `*.db`, `data/` and `employee-email-kpi-backup-*.json` are git-ignored; only synthetic data is committed (`src/lib/demo`, `tests`, `sample-data/employees.csv`).
- **Safe rendering**: email text is always displayed as escaped text (no `innerHTML`), HTML pastes are converted to text first, scripts are never executed, no remote resources are loaded. Excel cells never contain formulas from email text; CSV cells starting with `= + - @` are neutralised.
- **Validation**: pasted emails are parsed defensively; employee imports (CSV/Excel, ≤ 10 MB) and backup files are validated field by field before anything is stored.
- Data is not encrypted at rest (like any browser data): anyone who can use your browser profile can read it. Use a private computer/profile.

## Future AI support

`EmailClassifier` and `DuplicateDetector` are interfaces (sync or async). A future Claude/OpenAI/local-LLM implementation can be passed to `analyzeMonth({ classifier, detector })` for ambiguous cases while the rule-based ones stay the default and human review stays mandatory. `aiAssisted` is a reserved setting, **off and not implemented**.

## Troubleshooting

| Problem | Fix |
|---|---|
| The page is empty / "Welcome" screen again | The browser data was cleared or you are in another browser/profile — use **Settings → Restore backup…** |
| Red banner "Local storage could not be opened" | The browser blocks IndexedDB (private window?). Use a normal window; until then data is kept only in memory — export a backup before closing |
| "Nothing to analyze" | The paste box was empty |
| Everything is *Unmatched* | Add/import employees whose e-mail equals the sender address, then Settings → *Re-analyze month* |
| Everything is *Pending Review* | No NMC replies/forwards were pasted, or the NMC address is not in Settings → NMC addresses |
| Dates land in the wrong month | Check *Numeric date order* in Settings |
| "The browser storage is full" | Export a backup, delete old months in Settings, or free disk space |
| 404 on GitHub Pages | Settings → Pages → Source must be **GitHub Actions**, and the workflow must have run on `main` |
| Old version after an update | Reload once while online (the service worker refreshes on the next visit) |

## Testing

```bash
npm test               # 110+ tests: Outlook-style parsing, classifier, duplicates, KPI, IndexedDB persistence & atomicity,
                       # backup/restore/validation, data reset, 100+-email month simulation, 2,500-email performance,
                       # "no server code" architecture guard
npm run test:e2e       # Playwright against the static build served under /employee-email-kpi-analyzer/
```
The e2e test covers: first-run page → add employees → NMC address → select September 2026 → paste Outlook-style text → analyze → classifications and employee totals → exact duplicate ignored → second batch accumulates → manual override changes the KPI → Excel/CSV export (sheet names verified) → backup export → clear all data → restore → data and override are back → reopen/refresh a deep link → offline use. The month simulation (`src/lib/demo/generate.ts`) compares every result with ground truth.

## Feature parity: server version → static version

| Feature | Static (GitHub Pages) version |
|---|---|
| Paste & Analyze, batches, month selection, import summary | ✅ same (local functions instead of API) |
| Parser (Outlook headers, chains, Arabic, HTML sanitising) | ✅ unchanged |
| Employee matching, NMC addresses (add/edit/delete/enable) | ✅ unchanged |
| Conversation model, evidence-based classification, editable phrases | ✅ unchanged |
| Duplicate detection (tiers, original by timestamp), exact-duplicate prevention | ✅ unchanged (SHA-256 now computed in the browser) |
| Review queue, one-click classification, duplicate original picker, manual overrides protected from re-analysis | ✅ unchanged |
| Dashboard, employee page, emails list (search/filter/sort/paginate), email detail | ✅ unchanged (detail pages use `?id=`) |
| KPI engine & settings, trends/charts | ✅ unchanged |
| Reports, Excel (6 sheets) & CSV export, Print/PDF | ✅ generated in the browser |
| Employee CSV/Excel import & export | ✅ in the browser |
| Settings, audit log, re-analysis, delete month, delete emails | ✅ unchanged |
| Synthetic demo data | ✅ loads into IndexedDB |
| SQLite database file on disk | ➜ replaced by IndexedDB in the browser (+ **new**: backup / restore JSON, storage usage, clear all local data) |
| Server-side Host/Origin request guard, `127.0.0.1` binding | ➖ not needed: there is no server or API; the CSP meta tag replaces the security headers |
| **New**: first-run guide, offline use (service worker), cross-tab refresh | ✅ |

## Limitations

- **Validated only against synthetic Outlook-style text.** No real Outlook sample has been tested. Layouts I have not seen (e.g. the Outlook *reading-pane* header with no `From:` label, other display languages) may need parser tweaks.
- Data lives in one browser on one device: no sync, no multi-user use, no login. Back up regularly.
- Classification depends on the evidence you paste (NMC replies/forwards) and on the phrase lists; unusual wording shows up as Pending Review rather than a guess. If NMC replies use a different subject than the employee's email they are not linked.
- One e-mail address per employee; location extraction is heuristic (shared incident/circuit/service/device/IP evidence is far more reliable).
- A follow-up written by a different employee inside someone else's conversation is not counted.
- PDF export uses the browser's print dialog. Very large amounts of data (hundreds of thousands of emails) are not a target — the working set is held in memory.

## Real samples that would help most

Anonymised copies (names/addresses replaced) of: (1) one email copied from the message list and one opened in its own window, (2) a reply chain with an NMC reply and a forward to another team, (3) an Arabic-UI Outlook copy, (4) a thread containing a department reply, (5) how a forwarded-to-group email looks (distribution list names), (6) typical NMC no-action and escalation wording.
