# Scout

A local hackathon MVP for turning a website URL into a prospect database and weekly outreach plan.

## What it does

- Analyzes a submitted website for positioning signals.
- Infers likely customer segments and prospect search queries.
- Discovers public prospect pages with DuckDuckGo HTML search plus shallow crawling.
- Extracts public emails, phone numbers, names, roles, and contact pages.
- Stores companies, leads, campaigns, and outreach drafts in SQLite.
- Runs a weekly scheduler that queues draft email outreach for review.

The app defaults to draft-only outreach. To actually send mail, configure SMTP env vars and explicitly mark drafts approved through the API or database.

## Run

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Vercel preview

For the static product demo, deploy the `public` directory on Vercel. The live Vercel preview will use demo data when the local Node API is not available.

The production Vercel app serves the static UI from `public/` and live mission endpoints from `api/`.

## SMTP env vars

```bash
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM="Your Team <hello@example.com>"
```

## Compliance guardrails

Use this only for public business contact information and legitimate B2B outreach. Review drafts before sending, include an unsubscribe path, honor opt-outs, and respect robots/rate limits for sites you crawl.
