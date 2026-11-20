import { useEffect, useState } from 'react';

export const FOOD = { before: 'Before food', after: 'After food', any: 'Any time' };

export const fmtTime = (t) => {
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};
export const fmtDate = (d, opts = { weekday: 'short', day: 'numeric', month: 'short' }) =>
  new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', opts);
export const shiftDate = (d, n) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

export function supplyText(s) {
  if (s.level === 'ended') return 'Course finished';
  if (s.coversCourse) return 'Enough for the whole course';
  if (s.daysLeft === 0) return 'Not enough for a full day';
  return `${s.daysLeft} day${s.daysLeft === 1 ? '' : 's'} left`;
}

// Loads data and reloads on demand (and optionally every few seconds).
export function useLoad(fn, deps, pollMs) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    fn().then((data) => alive && setState({ data, error: null, loading: false }))
      .catch((error) => alive && setState((s) => ({ ...s, error: error.message, loading: false })));
    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  useEffect(() => {
    if (!pollMs) return undefined;
    const id = setInterval(() => setTick((t) => t + 1), pollMs);
    return () => clearInterval(id);
  }, [pollMs]);
  return { ...state, reload: () => setTick((t) => t + 1) };
}

export const Spinner = () => <p className="muted center">Loading…</p>;
export const ErrorNote = ({ error }) => (error ? <p className="alert error" role="alert">{error}</p> : null);

export const todayIn = (tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
