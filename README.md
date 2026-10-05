# Employee Email KPI Analyzer

A local web application that turns **emails you copy out of Outlook** into a **monthly employee email KPI report**.

```
Outlook → filter/select emails → Copy → paste here → Analyze → Review → Monthly report → Export Excel
```

**There is no Outlook connection of any kind** — no Microsoft Graph, no OAuth, no mailbox access, no polling. You paste text; the app parses and analyzes it on your machine. Nothing is sent to external services, and the app works with no AI.

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

## Quick start

Requirements: Node.js 20+ (tested on 22) and npm.

```bash
npm install            # installs deps and generates the Prisma client
cp .env.example .env   # DATABASE_URL="file:./data/app.db"
npm run db:push        # creates the local SQLite database
npm run dev            # http://localhost:3000  (listens on 127.0.0.1 only)
```

Production-style run: `npm run build && npm start`.

Try it without real data: open **Settings → Load synthetic demo data** (fictional people, in `sample-data/`).

Other commands:

```bash
npm test               # unit + integration tests (Vitest, own throw-away SQLite file)
npm run build && npm run test:e2e   # Playwright end-to-end flow (uses its own DB on port 3200)
npm run typecheck && npm run lint
```
If Playwright cannot find a browser, set `PW_CHROMIUM=/path/to/chrome`.

## Daily workflow

1. **Employees** – add or import your employees once (CSV/Excel: `Employee ID, Employee Name, Email Address, Department, Team, Active`; export any time). The sender **e-mail address** is the matching key (case-insensitive). If Outlook copied only a display name, a *unique exact name* match is accepted as a fallback.
2. **Settings → NMC addresses**: add one or more addresses or `@domains` (add / edit / delete / enable-disable). Messages from these senders are recognised as NMC replies/forwards inside copied conversations. They are kept as **evidence** and never counted as employee emails.
3. **Paste & Analyze**: choose year + month, paste the emails — single emails, many emails, or whole reply/forward chains (include the NMC replies and forwards!) — and click **Analyze Emails**. The import summary shows: imported, exact duplicates ignored, matched employees, unmatched, automatically classified, review required, out-of-month, and evidence-only messages. It stays visible when you navigate away and come back.
4. **Review**: one click per item — **Confirm · Forwarded · Not Useful · Duplicate… · Pending · Other**. *Duplicate…* opens a picker to choose the original email (the system's suggestion is pre-marked). Unmatched senders can be assigned to an employee; out-of-month emails can be included or excluded.
5. **Dashboard / Reports**: totals, per-employee table, KPI. Manual decisions change them immediately. **Reports → Export Excel / CSV** (or *Print / PDF* via the browser).

Every paste is a **batch**; batches are strictly additive and attached to the selected month. Pasting never resets earlier data. Month history is kept.

## Architecture

```
src/
  app/                 Next.js App Router: pages + /api route handlers (thin)
  components/          UI kit (shadcn-style, Tailwind), charts (Recharts), shell
  lib/
    parser/            paste → ParsedEmail[] (boundaries, headers, dates, HTML→text)
    classification/    entities, phrases, EmailClassifier interface + rule-based impl
    duplicate-detection/  DuplicateDetector interface + rule-based impl, similarity
    kpi/               pure KPI engine (counts + config → score) — independent of analysis
    import/            importer (batches, exact-dedupe), analyze (pipeline), emails (queries/actions)
    reports/           aggregation, CSV, Excel (exceljs)
    employees/         matching, CRUD service, CSV/Excel import/export
    settings/          zod-validated settings stored in SQLite
    audit/             audit log
    database/          Prisma client (better-sqlite3 adapter)
prisma/schema.prisma   data model
sample-data/employees.csv  example employee import file (fictional); src/lib/demo = synthetic month generator
tests/  e2e/           Vitest and Playwright
```

Stack: Next.js 16 (React 19, TypeScript), Tailwind CSS 4, Prisma 7 + SQLite (`better-sqlite3`), Zod, Recharts, ExcelJS, Vitest, Playwright.

### Pipeline

`paste → parse → exact-duplicate check → employee match → month check → store (batch) → analyzeMonth → review queue`

`analyzeMonth` re-derives employee match, business duplicates and classification for the month. It runs after each import (so a later batch can supply the original/evidence for earlier emails) and on demand (Settings → Re-analyze). **Manual decisions are never touched** unless you pick *Re-analyze + reset manual decisions*.

### Data model (Prisma)

- **Employee** – employeeId, name, email (unique, lower-case), department, team, active, timestamps.
- **Batch** – number, year/month, totals (parsed, new, exact duplicates, matched, unmatched, auto-classified, needs review), warnings, status.
- **Email** – parsed fields (sender, to, cc, subject, `sentAt`, body, `rawSource`, messageId, uncertain fields), extracted entities (incident/service/circuit IDs, locations), `role` (EMPLOYEE | NMC), month handling (`outsideMonth`, `monthDecision`), employee link (+ `employeeManual`), classification (`autoClass`, `confidence`, `reason`, `finalClass`, `isManual`, `overrideReason`, `overrideAt`), duplicate links (`duplicateOfId`, similarity, `possibleDuplicateOfId`), review (`reviewStatus`, `reviewReasons`), `contentHash` (unique → exact-duplicate prevention).
- **AuditLog**, **Setting** (JSON).

### Key decisions

- **SQLite + Prisma driver adapter**: zero infrastructure; one file you can back up or delete.
- **Dates** are wall-clock values stored as UTC (no time-zone conversion), so the month never shifts. Numeric dates (`03/04/2026`) use the order set in Settings (default day/month/year; unambiguous when a part > 12).
- **Evidence model**: the app never sees Outlook's *Sent Items/forward state*; it classifies from what you paste. Forward/no-action evidence comes from NMC messages in the same conversation (same subject ignoring `RE:`/`FW:`). If you paste only employee emails with no NMC replies, results will correctly be *Pending Review* rather than guessed.
- **Out-of-month emails** are kept, flagged, and *not counted* until you Include them; Exclude keeps them stored but ignored.
- **Unmatched senders** are counted in the totals but in no employee row, and appear in Review.
- **PDF**: via the browser's Print dialog (print stylesheet), Excel/CSV are first-class.

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

- **Local only.** No external calls, no telemetry. The server listens on **127.0.0.1 only** (`npm run dev` / `npm start`), so other computers on your network cannot reach it. Use `http://localhost:3000`.
- **Protection against other websites**: the API rejects requests whose `Host` is not a local name (DNS-rebinding) and state-changing requests from another origin, so a web page you visit cannot reset or delete your data. To deliberately serve another host name, set `ALLOWED_HOSTS=name1,name2` — there is still no login, so do not expose it on a network.
- **Nothing sensitive in Git**: `.env`, `*.db` and `data/` are git-ignored; only synthetic data is committed (`src/lib/demo`, `tests`, `sample-data/employees.csv`). Real emails live only in `data/app.db` on your machine — back it up or delete it like any file.
- **Settings → Data**: delete one month, reset all email data, or reset everything (typed confirmation).
- **Safe rendering**: email text is always displayed as escaped text (no `innerHTML`), HTML pastes are converted to text, a Content-Security-Policy blocks scripts/resources from other origins, framing is denied. Excel cells never contain formulas from email text; CSV cells starting with `= + - @` are neutralised.
- Inputs validated with Zod, parameterised queries (Prisma), uploads limited to `.csv/.xlsx`.

## Future AI support

`EmailClassifier` and `DuplicateDetector` are interfaces (sync or async). A future Claude/OpenAI/local-LLM implementation can be passed to `analyzeMonth({ classifier, detector })` for ambiguous cases while the rule-based ones stay the default and human review stays mandatory. `aiAssisted` is a reserved setting, **off and not implemented**.

## Troubleshooting

| Problem | Fix |
|---|---|
| "Nothing to analyze" | The paste box was empty. |
| Everything is *Unmatched* | Add/import employees whose e-mail equals the sender address, then *Re-analyze month*. |
| Everything is *Pending Review* | No NMC replies/forwards were pasted, or the NMC address isn't in Settings → NMC addresses. |
| Dates land in the wrong month | Check *Numeric date order* in Settings. |
| `Cannot find module generated/prisma` | `npx prisma generate` (runs on `npm install`). |
| Database errors | Ensure `DATABASE_URL` is a `file:` path that is writable; run `npm run db:push`. |
| Start over | Settings → Reset, or delete `data/app.db` and run `npm run db:push`. |

## Testing

```bash
npm test               # 70+ unit/integration tests (parser on Outlook-style text, classifier, duplicates, KPI, import cases, 100+-email month, 2,500-email performance)
npm run build && npm run test:e2e   # Playwright: select month → paste → analyze → classification & employee totals → exact duplicate → multiple batches → review → report → Excel export (+ XSS check, NMC address settings)
npm run typecheck && npm run lint
```
The month simulation (`src/lib/demo/generate.ts`) generates 12 employees and 100+ synthetic emails (forwarded, not useful, duplicates, pending, unmatched, Arabic, mixed, out-of-month, undated, follow-ups) in three batches plus repeated pastes, and compares every result with the ground truth. **Settings → Load synthetic demo data** loads the same month.

## Limitations

- **Validated only against synthetic Outlook-style text.** No real Outlook sample has been tested. Layouts I have not seen (e.g. the Outlook *reading-pane* header with no `From:` label, localized labels other than English/Arabic, signatures with `From:` lines) may need parser tweaks — see below.
- Classification depends on the evidence you paste (NMC replies/forwards) and on the phrase lists; unusual wording shows up as Pending Review rather than a guess.
- Location extraction is heuristic (named places in the subject, “at/in X”, “site X”, Arabic “في X”); shared incident/circuit/service/device/IP evidence is much more reliable.
- A follow-up written by a *different* employee inside someone else's conversation is treated as a follow-up (not counted). NMC/department messages count as evidence for 14 days after the employee's email; when several emails share one subject and the NMC message does not name the employee, the result is sent to Review.
- An employee with a second e-mail address appears as *Unmatched*; assign the email manually or change the address in Employees (one address per employee).
- If NMC replies use a different subject than the employee's email, they are not linked (the email stays Pending Review — never guessed).
- Single-user, no authentication; PDF export uses the browser's print dialog. Old Phase 1 databases should be recreated (`npm run db:push` after deleting `data/app.db`) because the identity key and columns changed.

## Real samples that would help most

Anonymised copies (names/addresses replaced) of: (1) one email copied from the message list and one opened in its own window, (2) a reply chain with an NMC reply and a forward to another team, (3) an Arabic-UI Outlook copy, (4) a thread containing a department reply, (5) how a forwarded-to-group email looks (distribution list names), (6) typical NMC no-action and escalation wording.
