const KEY = 'carepal.session';
let onUnauthorized = () => {};

export const getSession = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } };
export const saveSession = (s) => (s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY));
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

async function request(path, { method = 'GET', body, raw, contentType } = {}) {
  const headers = {};
  const token = getSession()?.token;
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = contentType || 'application/json';
  let res;
  try {
    res = await fetch(`/api${path}`, { method, headers, body: raw ? body : body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    throw new Error('Cannot reach the server. Check your connection.');
  }
  if (res.status === 401 && token) onUnauthorized();
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return res.status === 204 ? null : res.json();
}

export const api = {
  config: () => request('/config'),
  login: (b) => request('/login', { method: 'POST', body: b }),
  logout: () => request('/logout', { method: 'POST' }).catch(() => {}),
  patients: () => request('/patients'),
  setEmail: (pid, email) => request(`/patients/${pid}/reminder-email`, { method: 'PUT', body: { email } }),
  medicines: (pid) => request(`/patients/${pid}/medicines`),
  addMedicine: (pid, m) => request(`/patients/${pid}/medicines`, { method: 'POST', body: m }),
  updateMedicine: (id, m) => request(`/medicines/${id}`, { method: 'PUT', body: m }),
  deleteMedicine: (id) => request(`/medicines/${id}`, { method: 'DELETE' }),
  refill: (id, quantity) => request(`/medicines/${id}/refill`, { method: 'POST', body: { quantity } }),
  uploadPrescription: (id, file) => request(`/medicines/${id}/prescription`, { method: 'PUT', body: file, raw: true, contentType: file.type }),
  schedule: (pid, date) => request(`/patients/${pid}/schedule?date=${date}`),
  record: (dose) => request('/doses', { method: 'PUT', body: dose }),
  undo: ({ medicineId, date, time }) => request(`/doses?${new URLSearchParams({ medicineId, date, time })}`, { method: 'DELETE' }),
  adherence: (pid) => request(`/patients/${pid}/adherence?days=7`),
  handover: (pid) => request(`/patients/${pid}/handover`),
  addHandover: (pid, n) => request(`/patients/${pid}/handover`, { method: 'POST', body: n }),
  pushKey: () => request('/push/key'),
  pushSubscribe: (sub) => request('/push/subscribe', { method: 'POST', body: sub }),
  pushTest: () => request('/push/test', { method: 'POST' }),
  demoNotify: (patientId, type) => request('/demo/notify', { method: 'POST', body: { patientId, type } }),
  async prescriptionUrl(id) { // fetched with the auth header, so shown as a blob URL
    const res = await fetch(`/api/medicines/${id}/prescription`, { headers: { Authorization: `Bearer ${getSession()?.token}` } });
    if (!res.ok) throw new Error('Could not load the prescription photo');
    return URL.createObjectURL(await res.blob());
  },
};

// ---- web push ----
const toKey = (b64) => {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export async function enablePush() {
  if (!pushSupported()) throw new Error('Push notifications are not supported here. On iPhone, add the app to the Home Screen first.');
  if ((await Notification.requestPermission()) !== 'granted') throw new Error('Notification permission was not granted');
  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  const { publicKey } = await api.pushKey();
  // Always start from a fresh subscription. An old one can belong to different server keys
  // (for example after the server data was reset), and the server would not know about it.
  const existing = await reg.pushManager.getSubscription();
  if (existing) await existing.unsubscribe();
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(publicKey) });
  await api.pushSubscribe(sub.toJSON());
}
