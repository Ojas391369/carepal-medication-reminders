import { useState } from 'react';
import { api } from '../api.js';
import { useLoad, Spinner, ErrorNote } from '../ui.jsx';

const when = (iso) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

export default function Handover({ patient, readOnly, notify }) {
  const notes = useLoad(() => api.handover(patient.id), [patient.id], 60000);
  const [shift, setShift] = useState('day');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try { await api.addHandover(patient.id, { shift, note }); setNote(''); notes.reload(); notify('Handover note saved'); }
    catch (err) { notify(err.message, 'error'); }
    finally { setBusy(false); }
  }

  return (
    <>
      {!readOnly && (
        <form className="card form" onSubmit={submit}>
          <h2>Handover note</h2>
          <label>Written by the
            <select value={shift} onChange={(e) => setShift(e.target.value)}><option value="day">Day caregiver (for night)</option><option value="night">Night caregiver (for day)</option></select>
          </label>
          <label>What should the next caregiver know?
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={4} maxLength={1000} required placeholder="Mood, meals, BP readings, doses that need attention…" />
          </label>
          <button className="primary" disabled={busy || !note.trim()}>Save note</button>
        </form>
      )}
      {notes.loading ? <Spinner /> : <ErrorNote error={notes.error} />}
      <ul className="plain">
        {(notes.data ?? []).map((n) => (
          <li key={n.id} className="card">
            <div className="row-between"><strong>{n.author}</strong><span className={`pill ${n.shift === 'day' ? 'ok' : 'none'}`}>{n.shift === 'day' ? 'Day shift' : 'Night shift'}</span></div>
            <p className="note">{n.note}</p>
            <span className="muted small">{when(n.createdAt)}</span>
          </li>
        ))}
      </ul>
      {notes.data?.length === 0 && <p className="muted center">No notes yet.</p>}
    </>
  );
}
