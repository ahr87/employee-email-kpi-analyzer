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
npm run dev            # http://localhost:3000
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

1. **Employees** – add or import your employees once (CSV/Excel with `Employee ID, Employee Name, Email Address, Department, Team, Active`; export to CSV/Excel any time). The sender **e-mail address** is the matching key (case-insensitive). If Outlook copied only a display name, a *unique exact name* match is accepted as a fallback.
2. **Settings → Classification → NMC addresses**: list the address(es)/domain(s) NMC replies from (e.g. `nmc@company.com` or `@company.com`). Replies/forwards from these senders are the *evidence* used to classify employee emails; they are stored but never counted as employee emails.
3. **Paste & Analyze**: choose year + month, paste the emails (you may paste employee emails *and* NMC replies/forwards together, as many as you like), click **Analyze Emails**. You get a summary: parsed, matched, unmatched, exact duplicates ignored, auto-classified, needing review.
4. **Review**: approve, change classification, assign unmatched senders to an employee, and decide on out-of-month emails (Include / Exclude).
5. **Dashboard / Reports**: numbers update immediately. **Reports → Export Excel / CSV** (or *Print / PDF* via the browser).

Every paste is a **batch** (Batch 001, 002 …). Batches are strictly additive: pasting never resets or overwrites earlier data. History for every month is kept; switch months in the header.

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
sample-data/           synthetic employees + emails
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

## Parsing

Tolerates common Outlook shapes: header blocks (`From/Sent/To/Cc/Subject`, also `Date/Received`, English and Arabic labels), `Name <addr>`, `Name [addr]`, `Name (addr)`, bare addresses, multi-line recipient lists, many date formats (including Arabic month names/digits), tab-separated message-list rows, and HTML. Rules:

- A `From:` header block starts a new email, **unless** it follows a quote marker (`-----Original Message-----`, `________`, `On … wrote:`, `>`), in which case it is part of the previous body. A line like `==========` forces a boundary.
- Anything the parser can't determine is marked **uncertain**, never invented (e.g. missing sender → *Unmatched*, missing date → *Date invalid* review reason). The pasted text of every email is stored verbatim (`rawSource`) and shown on the email page.
- Pasted HTML is reduced to plain text (scripts/styles/comments stripped, entities decoded). Email content is **always rendered as escaped text** — never as HTML.

## Classification logic

Deterministic, explainable, multi-signal (never a single keyword). In priority order:

1. **Business duplicate** (see below) → `DUPLICATE`.
2. Evidence in later **NMC messages of the same conversation**: `FW:` forwards (+55), department/team recipients (+20), escalation wording such as "escalated to / kindly check / ticket created" (+30…), a newly raised ticket/incident number (+15) → *forward score*. "No action required / known issue / not applicable / FYI…" wording (+45…) and a plain `RE:` reply (+20) → *no-action score* (English and Arabic phrase lists in `classification/phrases.ts`).
3. Decision: strong forward score → `FORWARDED`; strong no-action score → `NOT_USEFUL`; both strong and close → `PENDING_REVIEW` (ambiguous); otherwise `PENDING_REVIEW` (no evidence). Confidence grows with evidence.

Review reasons: low confidence, unmatched employee, invalid date, outside month, uncertain duplicate, ambiguous or missing evidence.

## Duplicate detection

Two different concepts:

- **Exact duplicate** – the same email pasted again. Detected by `Message-ID` (if present) or a SHA-256 of sender + date/minute + subject + body; ignored on import and reported ("Duplicate email already exists"). Works across batches and months.
- **Business duplicate** – *different employees* reporting the same incident. A weighted score from subject similarity, body similarity, shared locations, technology terms, issue concept (outage ≈ down ≈ offline…), time proximity, and shared incident / circuit / service IDs (near-decisive). ≥ similarity threshold (default 80) → `DUPLICATE`, linked to the earliest original (chains resolve to the root). Within 15 points below the threshold → "possible duplicate" in Review. The same employee re-sending is not a business duplicate.

## KPI settings

`Settings → KPI` (applies instantly to all reports, no re-analysis): per-class weights (default Forwarded 1, Other 0.5, others 0), pending handling (exclude or weighted), penalties per Duplicate/Not-Useful email, minimum emails to score, target, rating bands. Score = `Σ weight × count / scored emails × 100 − penalties`, clamped 0–100. The engine (`src/lib/kpi/engine.ts`) is a pure function over final counts, so you can change or replace the formula without touching classification.

## Reports & export

*Reports → Export Excel* produces sheets **Summary** (per employee + totals + KPI), **Email Details**, **Classification Summary**, **Review Required**, **Employees**. CSV exports the summary. CSV cells starting with `= + - @` are neutralised against spreadsheet formula injection.

## Privacy & security

- Local only; no external calls. No telemetry; no secrets in the repo (`.env`, `*.db`, `data/` are git-ignored). Only synthetic data is committed (`sample-data/`).
- **Settings → Data** provides month deletion, "reset all email data" and "reset everything" (typed confirmation).
- Inputs validated with Zod; Prisma parameterised queries; HTML never rendered; file uploads limited to `.csv/.xlsx`.
- The app has no login: it is intended to run on your own machine (`localhost`). Don't expose it on a network.

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

## Limitations

- Classification quality depends on the evidence you paste (NMC replies/forwards); wording lists are English/Arabic and tunable in code/Settings.
- Location extraction is heuristic (capitalised words / "at X"); shared IDs are much more reliable.
- Single-user, no authentication; PDF export uses the browser's print dialog.
