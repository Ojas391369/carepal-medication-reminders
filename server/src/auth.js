import crypto from 'node:crypto';
import { HttpError } from './lib/errors.js';

const SESSION_MS = 12 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 10 * 60 * 1000;

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

// Simple access-code login with two roles. Sessions live in memory (fine for a demo;
// a real deployment would use Firebase Auth or similar, see README).
export function createAuth(config) {
  const sessions = new Map();
  const attempts = new Map();

  function login(ip, { role, code, name }) {
    const a = attempts.get(ip);
    if (a && Date.now() - a.first < WINDOW_MS && a.count >= MAX_ATTEMPTS) {
      throw new HttpError(429, 'Too many attempts. Try again in a few minutes.');
    }
    const expected = role === 'caregiver' ? config.caregiverCode : role === 'family' ? config.familyCode : null;
    if (!expected || !safeEqual(code ?? '', expected)) {
      const fresh = a && Date.now() - a.first < WINDOW_MS ? a : { first: Date.now(), count: 0 };
      fresh.count++;
      attempts.set(ip, fresh);
      throw new HttpError(401, 'Wrong role or access code');
    }
    attempts.delete(ip);
    const cleanName = String(name ?? '').trim().slice(0, 60) || (role === 'caregiver' ? 'Caregiver' : 'Family');
    const token = crypto.randomBytes(24).toString('hex');
    sessions.set(token, { role, name: cleanName, expires: Date.now() + SESSION_MS });
    return { token, role, name: cleanName };
  }

  const requireAuth = (req, res, next) => {
    const token = (req.get('authorization') || '').replace(/^Bearer /, '');
    const s = sessions.get(token);
    if (!s || s.expires < Date.now()) {
      sessions.delete(token);
      return next(new HttpError(401, 'Please sign in again'));
    }
    req.user = s;
    next();
  };

  const requireRole = (role) => (req, res, next) =>
    req.user.role === role ? next() : next(new HttpError(403, 'Only caregivers can do this'));

  return { login, requireAuth, requireRole, logout: (token) => sessions.delete(token) };
}
