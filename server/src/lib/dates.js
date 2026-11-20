// All dates are 'YYYY-MM-DD' strings and times 'HH:MM' strings in the app's time zone (default Asia/Kolkata).
// Working with strings avoids the classic off-by-one bugs from mixing local time and UTC.

export function nowInTz(tz, d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t).value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}

export function isDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export const isTime = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

export function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const minutesOf = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

// absolute minute index, used to compare (date, time) pairs
export const absMinutes = (date, time) => Math.floor(Date.parse(`${date}T00:00:00Z`) / 60000) + minutesOf(time);
