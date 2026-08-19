# DateDrop Seed

```yaml
identity:
  seed_name: DateDrop Seed
  repo_name: DateDrop
  plane: project
intent:
  summary: >
    A single web page that turns a pasted list of dates, written in loose plain English,
    into "add to Google Calendar" and "add to Apple Calendar" links ready to paste into
    an email. A gift for a non-technical event organizer: open a bookmark, paste, copy.
  first_deliverable: The page live at datedrop.deven-5f7.workers.dev on Captain's Cloudflare account.
inherit:
  charter_version: main-2026-08-19
  conventions: charter
structure:
  repo_type: project
  gitignore: project
mode: new-repo
merges:
  required: false
planning_done: true
first_tasks:
  - Build the Worker (page at /, calendar files at /ics) and the date-list reader.
  - Write checks covering the original eight-line email word for word plus the failure cases.
  - Deploy to Captain's Cloudflare account and verify the live page and a live calendar file.
decisions_locked:
  - The event title is optional; blank becomes "Event".
  - Every link carries the start time and the end time.
  - An end time of 12:00 AM is written as 11:59 PM so the event stays on its own day (Captain, 2026-08-19).
  - Times carry no timezone; recipients' calendars file events at local wall-clock time.
  - A line the reader cannot understand turns red with a plain-words reason and is never copied.
  - Nothing the user types is stored or sent anywhere; all details travel inside the links.
  - Free Cloudflare plan; no accounts, no storage, no secrets.
gates:
  contract: drvi-four-gate-v1
  gates_ref: charter:CONSTITUTION.md
```

The full payload is in `for-repo/`. Approval record:
`for-repo/docs/approvals/2026-08-19-build-and-deploy.md`. Google Drive (G:) was not
mounted on Lenny at seed time, so this seed lives in the repo it produced instead of
`G:\My Drive\DRVI\DRVI Projects`; the hydrate manual deletes the zip after hydration
either way.
