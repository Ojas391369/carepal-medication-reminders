import { HttpError } from './errors.js';
import { isDate, isTime } from './dates.js';

export const FOODS = ['before', 'after', 'any'];

const text = (v) => (typeof v === 'string' ? v.trim() : '');
const num = (v, fallback) => (v === undefined || v === null || v === '' ? fallback : Number(v));

// Accepts the shared JSON shape from the brief
//   {name, strength, dose, times[], food, startDate, endDate}
// plus optional stock fields. An empty endDate means "ongoing".
export function validateMedicine(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw new HttpError(400, 'Request body must be a JSON object');
  const errs = [];

  const name = text(b.name);
  if (!name || name.length > 100) errs.push('name is required (max 100 characters)');
  const strength = text(b.strength);
  if (strength.length > 50) errs.push('strength is too long (max 50 characters)');
  const dose = text(b.dose);
  if (!dose || dose.length > 50) errs.push('dose is required, e.g. "1 tablet" (max 50 characters)');

  let times = b.times;
  if (!Array.isArray(times) || times.length < 1 || times.length > 8 || !times.every(isTime)) {
    errs.push('times must contain 1 to 8 values in 24-hour HH:MM format');
    times = [];
  } else {
    times = [...new Set(times)].sort();
  }

  const food = b.food ?? 'any';
  if (!FOODS.includes(food)) errs.push('food must be before, after or any');

  if (!isDate(b.startDate)) errs.push('startDate must be a valid YYYY-MM-DD date');
  const endDate = b.endDate ? b.endDate : null;
  if (endDate !== null && !isDate(endDate)) errs.push('endDate must be a valid YYYY-MM-DD date or empty');
  else if (endDate && isDate(b.startDate) && endDate < b.startDate) errs.push('endDate cannot be before startDate');

  const stock = num(b.stock, 0);
  if (!Number.isFinite(stock) || stock < 0 || stock > 100000) errs.push('stock must be a number from 0 to 100000');
  const unitsPerDose = num(b.unitsPerDose, 1);
  if (!Number.isFinite(unitsPerDose) || unitsPerDose <= 0 || unitsPerDose > 100) errs.push('unitsPerDose must be greater than 0');
  const lowStockDays = num(b.lowStockDays, 5);
  if (!Number.isInteger(lowStockDays) || lowStockDays < 1 || lowStockDays > 90) errs.push('lowStockDays must be a whole number from 1 to 90');

  if (errs.length) throw new HttpError(400, errs.join('; '));
  return { name, strength, dose, times, food, startDate: b.startDate, endDate, stock, unitsPerDose, lowStockDays };
}

export function validateDose(b) {
  if (!b || typeof b !== 'object') throw new HttpError(400, 'Request body must be a JSON object');
  const medicineId = Number(b.medicineId);
  if (!Number.isInteger(medicineId)) throw new HttpError(400, 'medicineId is required');
  if (!isDate(b.date)) throw new HttpError(400, 'date must be YYYY-MM-DD');
  if (!isTime(b.time)) throw new HttpError(400, 'time must be HH:MM');
  if (b.status !== 'given' && b.status !== 'skipped') throw new HttpError(400, 'status must be given or skipped');
  const reason = text(b.reason);
  if (b.status === 'skipped' && !reason) throw new HttpError(400, 'A reason is required when a dose is skipped');
  if (reason.length > 200) throw new HttpError(400, 'Reason is too long (max 200 characters)');
  return { medicineId, date: b.date, time: b.time, status: b.status, reason };
}

export function validateHandover(b) {
  if (!b || typeof b !== 'object') throw new HttpError(400, 'Request body must be a JSON object');
  const note = text(b.note);
  if (!note || note.length > 1000) throw new HttpError(400, 'note is required (max 1000 characters)');
  if (b.shift !== 'day' && b.shift !== 'night') throw new HttpError(400, 'shift must be day or night');
  return { note, shift: b.shift };
}

export function validateEmail(v) {
  const email = text(v);
  if (email === '') return null;
  if (email.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Enter a valid email address');
  return email;
}
