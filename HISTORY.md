# DateDrop — build record

## 2026-08-19 — Discovery pass (Constitution 5.13, "Analyze Trace before build")

**(a) The outcome, in one sentence.** Captain, describing the gift: a tool for "the low
tech secretary who wrote the email with those dates" that "would make it super easy for
her to just list the dates and then the tool would produce for her recipients a calendar
link for google or apple."

**(b) The absolute constraints, from Captain in this session.**
- "Will she have to engage with cloudfare? Or just go to the page, enter the dates, and
  copy her links?" — she never touches Cloudflare; open, paste, copy is the whole tool.
- "It also has to show start and end times, and when an end time is 12:00AM it gets
  converted to 11:59pm."
- "Also include an optional title or event name."
- Hosted on his Cloudflare account, free plan.

**(c) The trace — how the systems being extended already do it.**
- Google Calendar accepts a pre-filled event link of the form
  `calendar.google.com/calendar/render?action=TEMPLATE&text=...&dates=START/END&details=...`.
  This is the same link format Google's own "add to calendar" buttons produce. Times
  written without a timezone letter are filed at the recipient's local wall-clock time.
- Apple Calendar has no pre-filled link format. It opens standard calendar files (.ics,
  the iCalendar format, RFC 5545), as do Outlook and Google. An earlier step in this same
  session proved the format: an eight-event .ics built by hand was imported into Captain's
  Google Calendar successfully ("Great. done." — Captain, 2026-08-19).
- Cloudflare Workers on this account already serve other DRVI pages the same way, and
  `wrangler whoami` on Lenny showed the signed-in account with Workers write permission
  before any build step ran.

**(d) The candidates, and the proof.**
1. **Google render link + this Worker serving .ics (chosen).** Works with one bookmark
   and no storage; every detail travels inside the link. Disqualifier would have been a
   link-length limit; the longest real link here is far under any browser or email limit.
2. One hosted page per event with both buttons. Rejected: needs storage and creates a
   growing pile of event pages nobody deletes.
3. `webcal://` subscription feeds. Rejected: subscriptions are for calendars that keep
   changing, not one-time invitations.
4. .ics files as email attachments. Rejected: puts file handling back on the secretary,
   which is the work the gift removes.

## 2026-08-19 — Hydration and build

- Repo created and hydrated per `drvi-charter:seed-and-hydrate.md` in the same session
  that planned it; the seed's manifest and payload are archived in
  [docs/seed-manifest.md](docs/seed-manifest.md).
- Google Drive (G:) was not mounted on Lenny at hydrate time, so the seed zip could not
  be parked in `G:\My Drive\DRVI\DRVI Projects` first; the seed is archived in this repo
  instead and the zip deleted after hydration, which is the manual's own end state.
- The `first_tasks` (build, test, deploy, verify) were executed directly in the hydrate
  session rather than opened as issues, since the same agent completed them immediately.
- Checks: `node tests/parser.test.mjs` — the original eight-line email word for word,
  plus the midnight rule, weekday mismatch, year rollover, missing am/pm, backwards
  times, impossible dates, and the Worker's routes and refusals.
- The @claude responder workflow is installed but dormant until Captain sets the
  `CLAUDE_CODE_OAUTH_TOKEN` secret on the repo (Gate G2 — his act, optional).
