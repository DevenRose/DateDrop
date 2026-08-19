// DateDrop — one Cloudflare Worker. It serves the page at "/" and calendar files at "/ics".
// No storage, no accounts, no outside services. Everything the page does happens in the
// visitor's own browser; the /ics route builds a calendar file from the details carried
// inside the link itself.

// The date-list reader. It is one plain script, kept as a string so the exact same code
// runs in the browser (inlined into the page below) and in the tests (tests/parser.test.mjs
// loads and runs this string). One copy, no drift.
export const PARSER_SOURCE = String.raw`
(function () {
  'use strict';

  var MONTHS = { jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
    may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
    oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12 };
  var MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
    'September', 'October', 'November', 'December'];
  var WEEKDAYS = { sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3,
    weds: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5,
    sat: 6, saturday: 6 };
  var WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  var WEEKDAY_RE = /\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tues|tue|weds|wed|thurs|thur|thu|fri|sat)\b\.?/i;
  var MONTH_DATE_RE = /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec)\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s*(\d{4}))?/i;
  var NUM_DATE_RE = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/;

  // A clock time. Four capture groups: hour, minutes, am/pm, or the word noon/midnight.
  // The strict form requires am/pm (or noon/midnight); the loose form allows a bare number.
  // The strict form is tried first so a stray number earlier in the line (a suite number,
  // an address) is never mistaken for the start time.
  var TIME_STRICT = '(?:(\\d{1,2})(?::(\\d{2}))?\\s*(a\\.?m\\.?|p\\.?m\\.?)|(noon|midnight))';
  var TIME_LOOSE = '(?:(\\d{1,2})(?::(\\d{2}))?\\s*(a\\.?m\\.?|p\\.?m\\.?)?|(noon|midnight))';
  var SEP = '\\s*(?:to|until|till|through|thru|[-\\u2013\\u2014~])\\s*';
  var RANGE_STRICT_RE = new RegExp(TIME_STRICT + SEP + TIME_STRICT, 'i');
  var RANGE_LOOSE_RE = new RegExp(TIME_LOOSE + SEP + TIME_LOOSE, 'i');

  function cutMatch(str, m) {
    return str.slice(0, m.index) + ' ' + str.slice(m.index + m[0].length);
  }

  function parseSide(h, min, mer, word) {
    if (word) return { word: word.toLowerCase() };
    var hh = parseInt(h, 10);
    var mm = min ? parseInt(min, 10) : 0;
    if (!(hh >= 1 && hh <= 12) || mm > 59) return null;
    var m = null;
    if (mer) m = (mer.charAt(0).toLowerCase() === 'p') ? 'pm' : 'am';
    return { h: hh, min: mm, mer: m };
  }

  function toMin(side, mer) {
    if (side.word) return side.word === 'noon' ? 720 : 0;
    var h = side.h % 12;
    if (mer === 'pm') h += 12;
    return h * 60 + side.min;
  }

  // Turn the two sides into 24-hour start and end. A side with no am/pm tries both and
  // keeps the reading that puts the start before the end, preferring the same half of the
  // day as the side that did say am or pm. An end of exactly midnight becomes 11:59 PM
  // so the event stays on its own day (Captain's rule, 2026-08-19).
  function resolve(a, b) {
    var aOpts = a.word ? [null] : (a.mer ? [a.mer] : ['pm', 'am']);
    var bOpts = b.word ? [null] : (b.mer ? [b.mer] : ['pm', 'am']);
    var known = a.mer || b.mer || null;
    var best = null;
    for (var i = 0; i < aOpts.length; i++) {
      for (var j = 0; j < bOpts.length; j++) {
        var s = toMin(a, aOpts[i]);
        var e0 = toMin(b, bOpts[j]);
        var midnight = (e0 === 0);
        var e = midnight ? 1439 : e0;
        if (e <= s) continue;
        var penalty = 0;
        if (known) {
          if (!a.word && !a.mer && aOpts[i] !== known) penalty++;
          if (!b.word && !b.mer && bOpts[j] !== known) penalty++;
        }
        if (!best || penalty < best.penalty) {
          best = { sh: Math.floor(s / 60), sm: s % 60, eh: Math.floor(e / 60), em: e % 60,
            midnightAdjusted: midnight, penalty: penalty };
        }
      }
    }
    if (!best) return { error: true };
    return best;
  }

  function inferYear(mo, day, today) {
    var y = today.getFullYear();
    var dt = new Date(y, mo - 1, day);
    var cutoff = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 30);
    if (dt < cutoff) y += 1;
    return y;
  }

  function cleanNote(s) {
    s = s.replace(/[\u2013\u2014]/g, '-');
    s = s.replace(/\s+/g, ' ').trim();
    var prev = null;
    while (prev !== s) {
      prev = s;
      s = s.replace(/^[\s,\-~.:;]+/, '').replace(/[\s,\-~.:;]+$/, '');
      var w = /^\((.*)\)$/.exec(s);
      if (w) s = w[1];
      s = s.trim();
    }
    return s;
  }

  function fail(original, msg) {
    return { ok: false, original: original, error: msg };
  }

  function parseLine(line, today) {
    var original = String(line).trim();
    if (original === '') return null;
    var rest = original;

    var weekdayGiven = null;
    var wd = WEEKDAY_RE.exec(rest);
    if (wd) {
      weekdayGiven = WEEKDAYS[wd[1].toLowerCase()];
      rest = cutMatch(rest, wd);
    }

    var y = null, mo = null, day = null;
    var dm = MONTH_DATE_RE.exec(rest);
    if (dm) {
      mo = MONTHS[dm[1].toLowerCase()];
      day = parseInt(dm[2], 10);
      if (dm[3]) y = parseInt(dm[3], 10);
      rest = cutMatch(rest, dm);
    } else {
      var nm = NUM_DATE_RE.exec(rest);
      if (nm) {
        mo = parseInt(nm[1], 10);
        day = parseInt(nm[2], 10);
        if (nm[3]) { y = parseInt(nm[3], 10); if (y < 100) y += 2000; }
        rest = cutMatch(rest, nm);
      } else {
        return fail(original, 'I could not find a date on this line. Write it like "August 22" or "8/22".');
      }
    }
    if (!(mo >= 1 && mo <= 12)) {
      return fail(original, 'There is no month number ' + mo + '. In "8/22" the month comes first.');
    }

    var tm = RANGE_STRICT_RE.exec(rest);
    if (!tm) tm = RANGE_LOOSE_RE.exec(rest);
    if (!tm) {
      return fail(original, 'I could not find the times on this line. Write them like "2pm to 9pm".');
    }
    var a = parseSide(tm[1], tm[2], tm[3], tm[4]);
    var b = parseSide(tm[5], tm[6], tm[7], tm[8]);
    if (!a || !b) return fail(original, 'One of the times on this line is not a real clock time.');
    if (!a.word && !a.mer && !b.word && !b.mer) {
      return fail(original, 'I need "am" or "pm" on at least one of the two times.');
    }
    var t = resolve(a, b);
    if (t.error) {
      return fail(original, 'The end time is not after the start time on this line.');
    }
    rest = cutMatch(rest, tm);

    var assumedYear = false;
    if (y === null) { y = inferYear(mo, day, today); assumedYear = true; }
    var dt = new Date(y, mo - 1, day);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== day) {
      return fail(original, MONTH_NAMES[mo - 1] + ' ' + day + ' is not a real date.');
    }
    if (weekdayGiven !== null && dt.getDay() !== weekdayGiven) {
      return fail(original, 'This line says "' + WEEKDAY_NAMES[weekdayGiven] + '", but ' +
        MONTH_NAMES[mo - 1] + ' ' + day + ', ' + y + ' is a ' + WEEKDAY_NAMES[dt.getDay()] +
        '. Please check the date.');
    }

    return { ok: true, original: original, y: y, m: mo, d: day, dow: dt.getDay(),
      sh: t.sh, sm: t.sm, eh: t.eh, em: t.em,
      midnightAdjusted: !!t.midnightAdjusted, assumedYear: assumedYear,
      note: cleanNote(rest) };
  }

  function parseLines(text, today) {
    var out = [];
    var lines = String(text).split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var r = parseLine(lines[i], today);
      if (r) out.push(r);
    }
    return out;
  }

  function two(n) { return (n < 10 ? '0' : '') + n; }

  function fmtTime(h, m) {
    var mer = h < 12 ? 'AM' : 'PM';
    var hh = h % 12;
    if (hh === 0) hh = 12;
    return hh + ':' + two(m) + ' ' + mer;
  }

  function fmtDateLong(ev) {
    return WEEKDAY_NAMES[ev.dow] + ', ' + MONTH_NAMES[ev.m - 1] + ' ' + ev.d + ', ' + ev.y;
  }

  function stamp(ev, h, m) {
    return '' + ev.y + two(ev.m) + two(ev.d) + 'T' + two(h) + two(m) + '00';
  }

  // The Google link opens Google Calendar with the event already filled in. The times carry
  // no timezone on purpose: each recipient's calendar files the event at that wall-clock
  // time, which is what a local venue event means.
  function buildGoogleLink(title, ev) {
    var u = 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' +
      encodeURIComponent(title) +
      '&dates=' + stamp(ev, ev.sh, ev.sm) + '/' + stamp(ev, ev.eh, ev.em);
    if (ev.note) u += '&details=' + encodeURIComponent(ev.note);
    return u;
  }

  // The Apple link points back at this same Worker's /ics route, which serves a standard
  // calendar file (.ics) that Apple Calendar and Outlook open. All event details travel
  // inside the link; nothing is stored.
  function buildAppleLink(origin, title, ev) {
    var u = origin + '/ics?t=' + encodeURIComponent(title) +
      '&d=' + ev.y + two(ev.m) + two(ev.d) +
      '&s=' + two(ev.sh) + two(ev.sm) + '&e=' + two(ev.eh) + two(ev.em);
    if (ev.note) u += '&n=' + encodeURIComponent(ev.note);
    return u;
  }

  var api = { parseLines: parseLines, parseLine: parseLine, fmtTime: fmtTime,
    fmtDateLong: fmtDateLong, buildGoogleLink: buildGoogleLink, buildAppleLink: buildAppleLink };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else globalThis.DateDrop = api;
})();
`;

const PAGE_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>DateDrop</title>
<style>
  body { margin: 0; background: #f5f6f8; color: #1c2430; font-family: 'Segoe UI', Arial, sans-serif; }
  main { max-width: 760px; margin: 0 auto; padding: 28px 18px 60px; }
  h1 { font-size: 26px; margin: 0 0 4px; }
  .lead { margin: 0 0 22px; color: #4a5568; font-size: 16px; }
  label { display: block; font-weight: 600; margin: 18px 0 6px; font-size: 15px; }
  input, textarea { width: 100%; box-sizing: border-box; font: inherit; font-size: 16px;
    padding: 10px 12px; border: 1px solid #c3cad4; border-radius: 8px; background: #fff; }
  textarea { min-height: 170px; resize: vertical; }
  #summary { margin: 16px 0 6px; font-weight: 600; }
  .row { background: #fff; border: 1px solid #d8dee6; border-radius: 10px;
    padding: 12px 14px; margin: 10px 0; font-size: 15px; }
  .row.bad { border-color: #e05252; background: #fdf3f3; }
  .err { color: #b02a2a; margin-top: 4px; }
  .note { color: #4a5568; }
  .tiny { color: #6a7686; font-size: 13px; margin-top: 4px; }
  .links { margin-top: 8px; }
  .links a { display: inline-block; margin-right: 16px; color: #155ab6; font-weight: 600;
    text-decoration: none; }
  .links a:hover { text-decoration: underline; }
  #copy { margin-top: 14px; font: inherit; font-size: 17px; font-weight: 600;
    padding: 12px 22px; border: 0; border-radius: 10px; background: #155ab6; color: #fff;
    cursor: pointer; display: none; }
  #copy:hover { background: #124c99; }
  #copied { margin-left: 12px; color: #1c7c3c; font-weight: 600; }
  .privacy { margin-top: 26px; color: #6a7686; font-size: 13px; }
</style>
</head>
<body>
<main>
  <h1>DateDrop</h1>
  <p class="lead">Paste your list of dates and get add-to-calendar links, ready for your email.</p>

  <label for="title">Event name (optional)</label>
  <input id="title" placeholder="Event">

  <label for="dates">Your dates, one per line, just as you write them</label>
  <textarea id="dates" placeholder="Saturday, August 22nd – 2:00pm to 9pm (extended venue)&#10;Sunday, August 23rd – 4:30pm to 9pm"></textarea>

  <div id="summary"></div>
  <div id="results"></div>

  <button id="copy">Copy for email</button><span id="copied"></span>

  <p class="privacy">Nothing you type here is saved or sent anywhere. This page only builds links.</p>
</main>
<script>
${PARSER_SOURCE}
</script>
<script>
(function () {
  'use strict';
  var titleEl = document.getElementById('title');
  var datesEl = document.getElementById('dates');
  var resultsEl = document.getElementById('results');
  var summaryEl = document.getElementById('summary');
  var copyBtn = document.getElementById('copy');
  var copiedEl = document.getElementById('copied');
  var D = DateDrop;
  var current = [];

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function titleText() {
    var t = titleEl.value.trim();
    return t === '' ? 'Event' : t;
  }
  function whenText(r) {
    return D.fmtDateLong(r) + ', ' + D.fmtTime(r.sh, r.sm) + ' to ' + D.fmtTime(r.eh, r.em);
  }

  function render() {
    current = D.parseLines(datesEl.value, new Date());
    var html = '';
    var good = 0, bad = 0;
    for (var i = 0; i < current.length; i++) {
      var r = current[i];
      if (r.ok) {
        good++;
        var g = D.buildGoogleLink(titleText(), r);
        var a = D.buildAppleLink(window.location.origin, titleText(), r);
        html += '<div class="row"><div><strong>' + esc(titleText()) + '</strong> &middot; ' +
          esc(whenText(r)) +
          (r.note ? ' <span class="note">(' + esc(r.note) + ')</span>' : '') + '</div>' +
          (r.midnightAdjusted ? '<div class="tiny">This line ended at 12:00 AM, so it is written as 11:59 PM to keep the event on the same day.</div>' : '') +
          '<div class="links"><a href="' + esc(g) + '" target="_blank" rel="noopener">Google link</a>' +
          '<a href="' + esc(a) + '">Apple link</a></div></div>';
      } else {
        bad++;
        html += '<div class="row bad"><div>' + esc(r.original) + '</div>' +
          '<div class="err">' + esc(r.error) + '</div></div>';
      }
    }
    resultsEl.innerHTML = html;
    if (current.length === 0) {
      summaryEl.textContent = '';
      copyBtn.style.display = 'none';
    } else {
      var msg = good + (good === 1 ? ' date read.' : ' dates read.');
      if (bad > 0) {
        msg += ' ' + bad + (bad === 1 ? ' line is' : ' lines are') +
          ' in red and will not be copied until fixed.';
      }
      summaryEl.textContent = msg;
      copyBtn.style.display = good > 0 ? 'inline-block' : 'none';
    }
    copiedEl.textContent = '';
  }

  function buildEmailHtml() {
    var parts = [];
    for (var i = 0; i < current.length; i++) {
      var r = current[i];
      if (!r.ok) continue;
      var g = D.buildGoogleLink(titleText(), r);
      var a = D.buildAppleLink(window.location.origin, titleText(), r);
      parts.push('<p style="margin:0 0 14px 0;font-family:Arial,sans-serif;font-size:15px;line-height:1.5;">' +
        '<strong>' + esc(titleText()) + '</strong><br>' +
        esc(whenText(r)) + (r.note ? ' (' + esc(r.note) + ')' : '') + '<br>' +
        '<a href="' + esc(g) + '">Add to Google Calendar</a> &nbsp;|&nbsp; ' +
        '<a href="' + esc(a) + '">Add to Apple Calendar</a></p>');
    }
    return parts.join('');
  }

  function buildEmailText() {
    var parts = [];
    for (var i = 0; i < current.length; i++) {
      var r = current[i];
      if (!r.ok) continue;
      parts.push(titleText() + '\n' +
        whenText(r) + (r.note ? ' (' + r.note + ')' : '') + '\n' +
        'Add to Google Calendar: ' + D.buildGoogleLink(titleText(), r) + '\n' +
        'Add to Apple Calendar: ' + D.buildAppleLink(window.location.origin, titleText(), r));
    }
    return parts.join('\n\n');
  }

  copyBtn.addEventListener('click', function () {
    var html = buildEmailHtml();
    var text = buildEmailText();
    function done() { copiedEl.textContent = 'Copied. Paste it into your email.'; }
    function failed() { copiedEl.textContent = 'Copy failed. Select the links above and copy them by hand.'; }
    function plainOnly() { navigator.clipboard.writeText(text).then(done, failed); }
    if (navigator.clipboard && window.ClipboardItem) {
      var item = new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' })
      });
      navigator.clipboard.write([item]).then(done, plainOnly);
    } else if (navigator.clipboard) {
      plainOnly();
    } else {
      failed();
    }
  });

  titleEl.addEventListener('input', render);
  datesEl.addEventListener('input', render);
  render();
})();
</script>
</body>
</html>
`;

// Text inside a calendar file must escape backslash, semicolon, comma, and line breaks.
function icsEscape(s) {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

// The calendar-file standard wants lines at most 75 characters; a continuation line
// starts with one space.
function foldIcsLine(line) {
  if (line.length <= 74) return line;
  let out = line.slice(0, 74);
  let rest = line.slice(74);
  while (rest.length > 0) {
    out += '\r\n ' + rest.slice(0, 73);
    rest = rest.slice(73);
  }
  return out;
}

function icsResponse(params) {
  const t = (params.get('t') || 'Event').slice(0, 200);
  const d = params.get('d') || '';
  const s = params.get('s') || '';
  const e = params.get('e') || '';
  const n = (params.get('n') || '').slice(0, 500);
  if (!/^\d{8}$/.test(d) || !/^\d{4}$/.test(s) || !/^\d{4}$/.test(e)) {
    return new Response('This calendar link is not complete.', { status: 400 });
  }
  const mo = +d.slice(4, 6), day = +d.slice(6, 8);
  const sh = +s.slice(0, 2), sm = +s.slice(2);
  const eh = +e.slice(0, 2), em = +e.slice(2);
  if (mo < 1 || mo > 12 || day < 1 || day > 31 || sh > 23 || sm > 59 || eh > 23 || em > 59 ||
      (eh * 60 + em) <= (sh * 60 + sm)) {
    return new Response('This calendar link has a broken date or time.', { status: 400 });
  }
  const stampNow = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//DateDrop//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    'UID:datedrop-' + d + '-' + s + e + '@datedrop',
    'DTSTAMP:' + stampNow,
    'DTSTART:' + d + 'T' + s + '00',
    'DTEND:' + d + 'T' + e + '00',
    foldIcsLine('SUMMARY:' + icsEscape(t))
  ];
  if (n) lines.push(foldIcsLine('DESCRIPTION:' + icsEscape(n)));
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return new Response(lines.join('\r\n') + '\r\n', {
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': 'attachment; filename="event.ics"',
      'cache-control': 'no-store'
    }
  });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/') {
      return new Response(PAGE_HTML, {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
          'referrer-policy': 'no-referrer',
          'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"
        }
      });
    }
    if (url.pathname === '/ics') return icsResponse(url.searchParams);
    return new Response('Not found.', { status: 404 });
  }
};
