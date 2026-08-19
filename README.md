# DateDrop

Paste a list of dates, get "add to calendar" links for Google and Apple, ready to paste
into an email. Built 2026-08-19 as a gift for a non-technical event organizer.

**Live page:** https://datedrop.deven-5f7.workers.dev

## How it is used

1. Open the page (bookmark it — no account, no login, no install).
2. Type the event name if you want one, and paste your dates, one per line, exactly as
   you write them in your email — for example `Saturday, August 22nd – 2:00pm to 9pm (extended venue)`.
3. The page shows every date back so you can see it read them correctly, then one press
   of **Copy for email** puts the whole ready-made block — each date with its
   "Add to Google Calendar" and "Add to Apple Calendar" links — on your clipboard.

A line the page cannot read turns red and says what is wrong in plain words. Red lines
are never copied, so a wrong date cannot go out silently.

## The rules built in

- The event name is optional; a blank name becomes "Event".
- Every link carries the start time and the end time.
- An end time of 12:00 AM is written as 11:59 PM so the event stays on its own day.
- If a line names a weekday that does not match the date ("Friday, August 22nd" when
  August 22 is a Saturday), the line turns red and says so.
- A date with no year means the next time that date occurs.
- Times carry no timezone: each recipient's calendar files the event at that local
  wall-clock time, which is what a local venue event means.
- Nothing typed on the page is saved or sent anywhere. The Google link opens Google
  Calendar pre-filled; the Apple link is served by this same Worker as a standard
  calendar file (.ics) built entirely from details carried inside the link.

## How it works

One Cloudflare Worker, one source file: [src/worker.js](src/worker.js).

- `GET /` serves the page. The date-list reader is one plain script kept as a string
  (`PARSER_SOURCE`) so the identical code runs in the browser and in the tests.
- `GET /ics` serves a calendar file for Apple Calendar and Outlook, built and validated
  from the link's own query values. Broken values get a 400 refusal, never a guess.

## Working on it

- Checks: `node tests/parser.test.mjs` — covers the original eight-line email word for
  word, the midnight rule, weekday mismatches, year rollover, and the Worker's routes.
- Deploy: `npx wrangler deploy` from this folder, signed in to Captain's Cloudflare
  account (the free plan carries it).

Rules live in the DRVI Constitution (repo `drvi-charter`, file `CONSTITUTION.md`).
Build record and discovery pass: [HISTORY.md](HISTORY.md).
