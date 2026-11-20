import { useCallback, useEffect, useState } from 'react';
import { api, getSession, saveSession, setUnauthorizedHandler } from './api.js';
import Login from './views/Login.jsx';
import Today from './views/Today.jsx';
import Overview from './views/Overview.jsx';
import Medicines from './views/Medicines.jsx';
import Handover from './views/Handover.jsx';
import { Spinner } from './ui.jsx';

const TABS = {
  caregiver: [['today', 'Today'], ['meds', 'Medicines'], ['handover', 'Handover'], ['overview', 'Family view']],
  family: [['overview', 'Overview'], ['today', 'Today'], ['meds', 'Medicines'], ['handover', 'Handover']],
};

export default function App() {
  const [session, setSession] = useState(getSession);
  const [config, setConfig] = useState(null);
  const [patients, setPatients] = useState(null);
  const [patientId, setPatientId] = useState(null);
  const [tab, setTab] = useState(null);
  const [toast, setToast] = useState(null);

  const notify = useCallback((message, kind = 'ok') => {
    setToast({ message, kind });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const logout = useCallback(() => {
    api.logout();
    saveSession(null);
    setSession(null);
    setPatients(null);
    setTab(null);
  }, []);

  useEffect(() => { setUnauthorizedHandler(logout); }, [logout]);
  useEffect(() => { api.config().then(setConfig).catch(() => setConfig({ tz: 'Asia/Kolkata', demo: false })); }, []);
  useEffect(() => {
    if (!session) return;
    api.patients().then((list) => { setPatients(list); setPatientId((id) => id ?? list[0]?.id ?? null); }).catch((e) => notify(e.message, 'error'));
  }, [session, notify]);

  if (!config) return <Spinner />;
  if (!session) {
    return <Login config={config} onLogin={(s) => { saveSession(s); setSession(s); setTab(TABS[s.role][0][0]); }} />;
  }
  if (!patients) return <Spinner />;

  const patient = patients.find((p) => p.id === patientId);
  const tabs = TABS[session.role];
  const active = tab ?? tabs[0][0];
  const readOnly = session.role !== 'caregiver';
  const props = { patient, readOnly, notify, tz: config.tz, session, demo: config.demo };
  const reloadPatients = () => api.patients().then(setPatients);

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <strong>TheCarePal Medication</strong>
          <span className="role">{session.role === 'caregiver' ? 'Caregiver' : 'Family'} · {session.name}</span>
        </div>
        <button className="link" onClick={logout}>Sign out</button>
      </header>

      {patients.length > 1 && (
        <select className="patient-select" aria-label="Choose patient" value={patientId ?? ''} onChange={(e) => setPatientId(Number(e.target.value))}>
          {patients.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      )}

      <main>
        {!patient && <p className="muted center">No patients yet.</p>}
        {patient && (
          <>
            <h1 className="patient-name">{patient.name}{patient.age ? `, ${patient.age}` : ''}</h1>
            {active === 'today' && <Today key={patient.id} {...props} />}
            {active === 'meds' && <Medicines key={patient.id} {...props} />}
            {active === 'handover' && <Handover key={patient.id} {...props} />}
            {active === 'overview' && <Overview key={patient.id} {...props} onEmailSaved={reloadPatients} />}
          </>
        )}
      </main>

      {toast && <div className={`toast ${toast.kind}`} role="status">{toast.message}</div>}

      <nav className="tabs" aria-label="Sections">
        {tabs.map(([key, label]) => (
          <button key={key} className={key === active ? 'active' : ''} aria-current={key === active ? 'page' : undefined} onClick={() => setTab(key)}>{label}</button>
        ))}
      </nav>
    </div>
  );
}
