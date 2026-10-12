# GlycoGuard

GlycoGuard is a static educational dashboard served by a small Express API. The API stores approved evidence sources, screening programmes, and epidemiology estimates in SQLite. It contains no patient records.

## Requirements

- Node.js 22.13 or newer (`node:sqlite` is used)
- npm

## Run locally

```powershell
npm.cmd install
npm.cmd start
```

Open <http://127.0.0.1:3000>. The SQLite database is created at `data/glycoguard.sqlite` and seeded with the evidence supplied for the dashboard on first run. It persists between restarts. To use another location, set `DATABASE_PATH` before starting the server.

For development with automatic restarts, use `npm.cmd run dev`. Run tests with `npm.cmd test`.

The dashboard has separate topic routes for `/disease`, `/numbers`, `/screening`, `/clinical`, `/genetics`, and `/references`. The overview links to each topic; the navigation and browser history work across those pages. The disease page includes a dedicated Cause of Mutation section covering inheritance, variant effects, and the featured c.2560C>T example. Topic pages include in-page section links; screening records and references are searchable, estimates can be filtered by measure and keyword, and the visible estimates can be exported as CSV. The genetics page also includes a three-question interactive mutation challenge with feedback, progress, scoring, and a retry option.

## Evidence admin

Open <http://127.0.0.1:3000/admin> to review sources, screening programmes, and estimates. The admin console uses the same `ADMIN_TOKEN` required by the protected API routes. It lists records by type, supports review-status and text filters, shows evidence metadata, and allows an authorized admin to approve, return for review, reject, or archive records. Reject/archive actions require confirmation.

To enable the console, set `ADMIN_TOKEN` before starting the server. The token is kept in the current browser tab's session storage and sent only to this same-origin server for protected API requests. Signing out removes it from the tab. Admin authentication is a single shared token, not individual accounts or a production identity system.

### Deploying the site and admin console on Render (free tier)

The `render.yaml` blueprint deploys the dashboard, `/admin` login, and API together on one HTTPS origin. It keeps `ADMIN_TOKEN` as a private Render environment variable. Create a long random token in Render's environment settings; never commit it or put it in frontend code. The free tier uses temporary SQLite storage: reviewed records may reset when Render restarts, sleeps, or redeploys the service. A persistent disk requires a paid plan. After connecting this repository in Render, open the generated service URL and append `/admin` to sign in.

## API

Public read routes return only approved records whose linked evidence source is also approved:

- `GET /api/health`
- `GET /api/sources`
- `GET /api/screening-programs` — optional `?status=PILOT`
- `GET /api/estimates` — optional `?type=BIRTH_PREVALENCE`, `?country=TWN`, and/or `?pompeType=IOPD`

The dashboard fetches the approved estimates and screening records when served by Express. If the API cannot be reached, the page keeps its included sample data and displays a status message.

### Admin writes

Admin routes require an `ADMIN_TOKEN` environment variable and an `Authorization: Bearer <token>` header. Do not commit the token or put it in browser-side code. Admin routes are intended for trusted local/manual use; this project does not provide an admin login screen or user-management system.

Read drafts and manage/approve records with:

- `GET /api/admin/sources`
- `GET /api/admin/screening-programs`
- `GET /api/admin/estimates`
- `POST /api/sources`; `PATCH /api/sources/:id`
- `POST /api/screening-programs`; `PATCH` or `DELETE /api/screening-programs/:id`
- `POST /api/estimates`; `PATCH` or `DELETE /api/estimates/:id`

New source, screening, and estimate records default to `PENDING_REVIEW` or `DRAFT` and stay out of public responses until an admin explicitly updates `reviewStatus` to `APPROVED`. A quantitative estimate and a screening programme require a valid source ID; public approval also requires that source to be approved. Published estimate text is stored separately from optional numeric fields so the reported wording can remain intact. Missing values are stored as `null`, not zero.

Example PowerShell session (generate a new local token; keep it private):

```powershell
$env:ADMIN_TOKEN = node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
npm.cmd start
```

In another PowerShell window, use `Invoke-RestMethod` and the token to review pending records:

```powershell
$headers = @{ Authorization = "Bearer $env:ADMIN_TOKEN" }
Invoke-RestMethod http://127.0.0.1:3000/api/admin/screening-programs -Headers $headers
```

Admin token configuration is process-local. Public reads are unauthenticated. The server binds to `127.0.0.1` by default for local development; the Render blueprint sets `HOST=0.0.0.0` behind Render's HTTPS edge. Admin routes remain protected by the server-only token and same-origin requests.

## Interactive learning

The Genetics page includes a keyboard-accessible DNA substitution lab. Visitors can compare how changing the first base of the coding-strand codon CGA affects the mRNA codon and amino-acid outcome. The C-to-A and C-to-G examples are hypothetical classroom comparisons, not clinical interpretations. A reading-progress indicator and section-specific color treatments help visitors follow the material.
