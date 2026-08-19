// DateDrop checks. Run with: node tests/parser.test.mjs
// Loads the exact reader code the page serves (PARSER_SOURCE) and the Worker itself,
// and proves both against the real email the tool was built for.

import assert from 'node:assert/strict';
import worker, { PARSER_SOURCE } from '../src/worker.js';

new Function(PARSER_SOURCE)();
const D = globalThis.DateDrop;
const TODAY = new Date(2026, 7, 19); // 2026-08-19, the day the tool was built

// ---- The real email, word for word ----
const email = [
  'Saturday, August 22nd – 2:00pm to 9pm (extended venue)',
  'Sunday, August 23rd – 4:30pm to 9pm (extended venue)',
  'Thursday, August 27th – Member event, 5pm to 10pm',
  'Saturday, August 29th – 2:30pm to 11:00pm (extended venue)',
  'Friday, September 4th – 4:30pm to 10pm (main venue)',
  'Saturday, September 5th – 2pm to 11pm (main venue)',
  'Friday, Sept 18th - 6pm to 11pm (main venue)',
  'Saturday, Sept 26th - 3pm to 12am - (extended venue)'
].join('\n');

const rows = D.parseLines(email, TODAY);
assert.equal(rows.length, 8, 'all eight lines read');
for (const r of rows) assert.equal(r.ok, true, 'line failed: ' + (r.error || ''));

const expected = [
  [2026, 8, 22, 14, 0, 21, 0, 'extended venue'],
  [2026, 8, 23, 16, 30, 21, 0, 'extended venue'],
  [2026, 8, 27, 17, 0, 22, 0, 'Member event'],
  [2026, 8, 29, 14, 30, 23, 0, 'extended venue'],
  [2026, 9, 4, 16, 30, 22, 0, 'main venue'],
  [2026, 9, 5, 14, 0, 23, 0, 'main venue'],
  [2026, 9, 18, 18, 0, 23, 0, 'main venue'],
  [2026, 9, 26, 15, 0, 23, 59, 'extended venue']
];
rows.forEach((r, i) => {
  assert.deepEqual(
    [r.y, r.m, r.d, r.sh, r.sm, r.eh, r.em, r.note],
    expected[i],
    'line ' + (i + 1) + ' parsed wrong'
  );
});

// Midnight rule: an end of 12:00 AM becomes 11:59 PM on the same day.
assert.equal(rows[7].midnightAdjusted, true);
assert.deepEqual([rows[7].eh, rows[7].em], [23, 59]);

// Weekday safety: a named weekday that does not match the date turns the line red.
const wrongDay = D.parseLine('Friday, August 22nd – 2pm to 9pm', TODAY);
assert.equal(wrongDay.ok, false);
assert.match(wrongDay.error, /Saturday/);

// No am/pm on either time: red, with a plain-words message.
const noMer = D.parseLine('Saturday, August 22nd – 2 to 9', TODAY);
assert.equal(noMer.ok, false);
assert.match(noMer.error, /am/);

// End before start: red.
const backwards = D.parseLine('Saturday, August 22nd – 9pm to 2pm', TODAY);
assert.equal(backwards.ok, false);

// A date that does not exist: red.
const feb30 = D.parseLine('February 30th – 2pm to 9pm', TODAY);
assert.equal(feb30.ok, false);

// No date at all: red.
const noDate = D.parseLine('the big party, 2pm to 9pm someday', TODAY);
assert.equal(noDate.ok, false);

// Year rollover: in December, "August 22nd" means next year.
const december = new Date(2026, 11, 1);
const nextYear = D.parseLine('August 22nd – 2pm to 9pm', december);
assert.equal(nextYear.ok, true);
assert.equal(nextYear.y, 2027);

// A start time with no am/pm borrows it from the end time: "2 to 9pm" is 2 PM.
const borrowed = D.parseLine('August 22nd – 2 to 9pm', TODAY);
assert.equal(borrowed.ok, true);
assert.deepEqual([borrowed.sh, borrowed.eh], [14, 21]);

// Noon and midnight as words.
const words = D.parseLine('August 22nd – noon to midnight', TODAY);
assert.deepEqual([words.sh, words.sm, words.eh, words.em], [12, 0, 23, 59]);

// Numeric dates work too, month first: 9/4 is September 4.
const numeric = D.parseLine('9/4 6pm to 10pm', TODAY);
assert.deepEqual([numeric.y, numeric.m, numeric.d, numeric.sh, numeric.eh], [2026, 9, 4, 18, 22]);

// A stray number before the times (a suite number) is not mistaken for a time.
const suite = D.parseLine('August 22nd Suite 12 - 5pm to 10pm', TODAY);
assert.equal(suite.ok, true);
assert.deepEqual([suite.sh, suite.eh], [17, 22]);

// ---- The links ----
const g = D.buildGoogleLink('Studio Event', rows[0]);
assert.ok(g.includes('calendar.google.com/calendar/render?action=TEMPLATE'));
assert.ok(g.includes('text=Studio%20Event'));
assert.ok(g.includes('dates=20260822T140000/20260822T210000'));
assert.ok(g.includes('details=extended%20venue'));

const a = D.buildAppleLink('https://datedrop.example', 'Studio Event', rows[7]);
assert.ok(a.includes('/ics?t=Studio%20Event'));
assert.ok(a.includes('d=20260926'));
assert.ok(a.includes('s=1500'));
assert.ok(a.includes('e=2359'));

// ---- The Worker itself ----
const page = await worker.fetch(new Request('https://datedrop.example/'));
assert.equal(page.status, 200);
const pageText = await page.text();
assert.ok(pageText.includes('DateDrop'));
assert.ok(pageText.includes('parseLines'), 'reader code is inlined into the page');

const ics = await worker.fetch(new Request(a));
assert.equal(ics.status, 200);
assert.equal(ics.headers.get('content-type'), 'text/calendar; charset=utf-8');
const icsBody = await ics.text();
assert.ok(icsBody.includes('DTSTART:20260926T150000'));
assert.ok(icsBody.includes('DTEND:20260926T235900'));
assert.ok(icsBody.includes('SUMMARY:Studio Event'));
assert.ok(icsBody.includes('DESCRIPTION:extended venue'));

// Commas in a note are escaped the calendar-file way.
const comma = await worker.fetch(new Request(
  'https://datedrop.example/ics?t=Event&d=20260822&s=1400&e=2100&n=' +
  encodeURIComponent('Hall B, upstairs')));
const commaBody = await comma.text();
assert.ok(commaBody.includes('DESCRIPTION:Hall B\\, upstairs'));

// Broken links are refused, not guessed at.
const broken = await worker.fetch(new Request('https://datedrop.example/ics?t=x&d=999&s=1&e=2'));
assert.equal(broken.status, 400);
const backwardsIcs = await worker.fetch(new Request('https://datedrop.example/ics?t=x&d=20260822&s=2100&e=1400'));
assert.equal(backwardsIcs.status, 400);

const missing = await worker.fetch(new Request('https://datedrop.example/nope'));
assert.equal(missing.status, 404);

console.log('All DateDrop checks passed.');
