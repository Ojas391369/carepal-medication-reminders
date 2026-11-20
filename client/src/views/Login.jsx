import { useState } from 'react';
import { api } from '../api.js';

export default function Login({ config, onLogin }) {
  const [role, setRole] = useState('caregiver');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try { onLogin(await api.login({ role, code, name })); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return (
    <form className="login card" onSubmit={submit}>
      <h1>TheCarePal Medication</h1>
      <p className="muted">One shared schedule for the nurse and the family.</p>
      <div className="segmented" role="radiogroup" aria-label="I am a">
        {[['caregiver', 'Nurse / caregiver'], ['family', 'Family member']].map(([v, l]) => (
          <button type="button" key={v} role="radio" aria-checked={role === v} className={role === v ? 'active' : ''} onClick={() => setRole(v)}>{l}</button>
        ))}
      </div>
      <label>Your name
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={role === 'caregiver' ? 'e.g. Anita (night nurse)' : 'e.g. Rohan'} maxLength={60} autoComplete="name" />
      </label>
      <label>Access code
        <input type="password" value={code} onChange={(e) => setCode(e.target.value)} required autoComplete="current-password" />
      </label>
      {error && <p className="alert error" role="alert">{error}</p>}
      <button className="primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      {config.demoCodes && (
        <p className="hint">Demo codes: caregiver <code>{config.demoCodes.caregiver}</code>, family <code>{config.demoCodes.family}</code></p>
      )}
    </form>
  );
}
