import { useRef, useState } from 'react';
import { api } from '../api.js';
import { FOOD, fmtDate, fmtTime, supplyText, todayIn, useLoad, Spinner, ErrorNote } from '../ui.jsx';

const LABEL = { given: 'Given', skipped: 'Skipped', missed: 'Missed', due: 'Due' };

const blank = (today) => ({ name: '', strength: '', dose: '1 tablet', times: ['08:00'], food: 'after', startDate: today, endDate: '', stock: 30, unitsPerDose: 1, lowStockDays: 5 });

function MedForm({ initial, onSave, onCancel }) {
  const [m, setM] = useState(initial);
  const [newTime, setNewTime] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setM({ ...m, [k]: e.target.value });

  function addTime() {
    if (newTime && !m.times.includes(newTime)) setM({ ...m, times: [...m.times, newTime].sort() });
    setNewTime('');
  }
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try { await onSave({ ...m, stock: Number(m.stock), unitsPerDose: Number(m.unitsPerDose), lowStockDays: Number(m.lowStockDays) }); }
    catch (err) { setError(err.message); setBusy(false); }
  }

  return (
    <form className="card form" onSubmit={submit}>
      <h2>{initial.id ? 'Edit medicine' : 'Add medicine'}</h2>
      <label>Name<input value={m.name} onChange={set('name')} required maxLength={100} /></label>
      <div className="grid2">
        <label>Strength<input value={m.strength} onChange={set('strength')} placeholder="500 mg" maxLength={50} /></label>
        <label>Dose<input value={m.dose} onChange={set('dose')} required placeholder="1 tablet" maxLength={50} /></label>
      </div>
      <fieldset>
        <legend>Times of day</legend>
        <div className="chips">
          {m.times.map((t) => (
            <span key={t} className="chip active">{fmtTime(t)} <button type="button" aria-label={`Remove ${t}`} onClick={() => setM({ ...m, times: m.times.filter((x) => x !== t) })}>×</button></span>
          ))}
        </div>
        <div className="btn-row">
          <input type="time" value={newTime} onChange={(e) => setNewTime(e.target.value)} aria-label="Add a time" />
          <button type="button" onClick={addTime}>Add time</button>
        </div>
      </fieldset>
      <label>Food
        <select value={m.food} onChange={set('food')}>{Object.entries(FOOD).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      </label>
      <div className="grid2">
        <label>Start date<input type="date" value={m.startDate} onChange={set('startDate')} required /></label>
        <label>End date (optional)<input type="date" value={m.endDate} onChange={set('endDate')} min={m.startDate} /></label>
      </div>
      <div className="grid3">
        <label>Stock on hand<input type="number" min="0" step="any" value={m.stock} onChange={set('stock')} /></label>
        <label>Units per dose<input type="number" min="0.5" step="any" value={m.unitsPerDose} onChange={set('unitsPerDose')} /></label>
        <label>Warn at (days)<input type="number" min="1" max="90" value={m.lowStockDays} onChange={set('lowStockDays')} /></label>
      </div>
      <ErrorNote error={error} />
      <div className="btn-row">
        <button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function MedCard({ m, readOnly, notify, reload, onEdit }) {
  const [qty, setQty] = useState('');
  const [img, setImg] = useState(null);
  const file = useRef(null);
  const wrap = async (fn, ok) => { try { await fn(); notify(ok); reload(); } catch (e) { notify(e.message, 'error'); } };

  return (
    <li className="card med">
      <div className="row-between">
        <div><strong>{m.name}</strong> <span className="muted">{m.strength}</span></div>
        <span className={`pill ${{ critical: 'bad', low: 'ok', ok: 'good', ended: 'none' }[m.supply.level]}`}>{supplyText(m.supply)}</span>
      </div>
      <div className="muted small">{m.dose} · {FOOD[m.food]} · {m.times.map(fmtTime).join(', ')}</div>
      <div className="muted small">{fmtDate(m.startDate, { day: 'numeric', month: 'short', year: 'numeric' })} to {m.endDate ? fmtDate(m.endDate, { day: 'numeric', month: 'short', year: 'numeric' }) : 'ongoing'} · {m.stock} in stock</div>
      {m.supply.runsOutOn && m.supply.level !== 'ok' && <div className="small reason">Runs out around {fmtDate(m.supply.runsOutOn)}</div>}

      {m.recent?.length > 0 && (
        <div className="history">
          <div className="muted small">Recent doses</div>
          <ul className="plain history-list">
            {m.recent.map((r) => (
              <li key={r.date + r.time} className="row-between small">
                <span>{fmtDate(r.date, { weekday: 'short', day: 'numeric', month: 'short' })}, {fmtTime(r.time)}{r.status === 'skipped' && r.reason ? ` · ${r.reason}` : ''}</span>
                <span className={`status ${r.status}`}>{LABEL[r.status]}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="btn-row">
        {m.hasPrescription && <button onClick={async () => { try { setImg(img ? null : await api.prescriptionUrl(m.id)); } catch (e) { notify(e.message, 'error'); } }}>{img ? 'Hide prescription' : 'View prescription'}</button>}
        {!readOnly && (
          <>
            <button onClick={() => file.current.click()}>{m.hasPrescription ? 'Replace photo' : 'Attach prescription'}</button>
            <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { const f = e.target.files[0]; e.target.value = ''; if (f) { setImg(null); wrap(() => api.uploadPrescription(m.id, f), 'Prescription attached'); } }} />
            <button onClick={onEdit}>Edit</button>
            <button className="danger" onClick={() => window.confirm(`Delete ${m.name} and its history? To just stop a course, set an end date instead.`) && wrap(() => api.deleteMedicine(m.id), 'Medicine deleted')}>Delete</button>
          </>
        )}
      </div>
      {img && <img className="rx" src={img} alt={`Prescription for ${m.name}`} />}
      {!readOnly && (
        <form className="btn-row" onSubmit={(e) => { e.preventDefault(); wrap(async () => { await api.refill(m.id, Number(qty)); setQty(''); }, 'Stock updated'); }}>
          <input type="number" min="1" step="any" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="Refill qty" aria-label={`Refill quantity for ${m.name}`} required />
          <button>Add stock</button>
        </form>
      )}
    </li>
  );
}

export default function Medicines({ patient, readOnly, notify, tz }) {
  const meds = useLoad(() => api.medicines(patient.id), [patient.id]);
  const [editing, setEditing] = useState(null); // null | medicine object | 'new'
  const today = todayIn(tz);

  async function save(m) {
    if (m.id) await api.updateMedicine(m.id, m); else await api.addMedicine(patient.id, m);
    notify(m.id ? 'Medicine updated' : 'Medicine added');
    setEditing(null);
    meds.reload();
  }

  if (editing) return <MedForm initial={editing === 'new' ? blank(today) : editing} onSave={save} onCancel={() => setEditing(null)} />;
  if (meds.loading) return <Spinner />;

  return (
    <>
      {!readOnly && <button className="primary wide" onClick={() => setEditing('new')}>+ Add medicine</button>}
      <ErrorNote error={meds.error} />
      <ul className="plain">
        {(meds.data ?? []).map((m) => <MedCard key={m.id} m={m} readOnly={readOnly} notify={notify} reload={meds.reload} onEdit={() => setEditing(m)} />)}
      </ul>
      {meds.data?.length === 0 && <p className="muted center">No medicines yet.</p>}
    </>
  );
}
