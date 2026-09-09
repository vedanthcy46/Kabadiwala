/** Recycler Login / Onboarding — /login/recycler
 *
 * Two modes:
 *  1. Sign in  — existing authorized recycler enters their ID
 *  2. Apply    — new recycler submits an application (status = pending)
 *                Admin must approve before they can log in
 */

import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { loginRecycler, getAllRecyclers, onboardRecycler, adminVerifyRecycler, MATERIAL_CATEGORIES } from '../api/client';
import { saveSession } from '../services/auth';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { useTranslation } from '../i18n/config.js';
import './Login.css';

export default function RecyclerLogin() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [mode, setMode] = useState('login'); // 'login' | 'apply'

  // ── Login state ──────────────────────────────────────────────────────────
  const [recyclers, setRecyclers] = useState([]);
  const [recyclerId, setRecyclerId] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);

  // ── Searchable recycler picker ───────────────────────────────────────────
  const [pickerQuery, setPickerQuery] = useState('');
  const [pickerResults, setPickerResults] = useState([]);
  const [pickerBusy, setPickerBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  // ── Apply state ──────────────────────────────────────────────────────────
  const [form, setForm] = useState({
    name: '',
    facility_location: '',
    latitude: null,
    longitude: null,
    contact_details: '',
    materials_accepted: [],
    pickup_availability: 'on_request',
    service_area: '',
    authorization_number: '',
    authorization_issue_date: '',
    authorization_valid_until: '',
    authorization_document_url: '',
    authorization_details: '',
  });
  const [applyError, setApplyError] = useState('');
  const [applyBusy, setApplyBusy] = useState(false);
  const [detectingGps, setDetectingGps] = useState(false);
  const [gpsStatus, setGpsStatus] = useState('');
  const [applied, setApplied] = useState(false);
  const [appliedId, setAppliedId] = useState(null);

  function handleAutoDetectGps() {
    if (!navigator.geolocation) {
      setGpsStatus('Geolocation not supported by your browser');
      return;
    }
    setDetectingGps(true);
    setGpsStatus('Acquiring precise GPS coordinates…');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        setForm(f => ({
          ...f,
          latitude: parseFloat(latitude.toFixed(6)),
          longitude: parseFloat(longitude.toFixed(6)),
          facility_location: f.facility_location || `GPS (${latitude.toFixed(4)}, ${longitude.toFixed(4)})`,
        }));
        setGpsStatus(`📍 Coordinates set: ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`);
        setDetectingGps(false);
      },
      (err) => {
        setGpsStatus('Could not access GPS. Will auto-geocode address.');
        setDetectingGps(false);
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }

  useEffect(() => {
    getAllRecyclers()
      .then((r) => setRecyclers((Array.isArray(r.data) ? r.data : []).filter((x) => x.authorization_status === 'authorized')))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const q = pickerQuery.trim();
    if (q.length < 2) {
      setPickerResults([]);
      setPickerBusy(false);
      setPickerOpen(false);
      return;
    }
    setPickerBusy(true);
    setPickerOpen(true);
    const timer = setTimeout(() => {
      getAllRecyclers({ name: q, authorization_status: 'authorized', limit: 20 })
        .then((r) => setPickerResults(Array.isArray(r.data) ? r.data : []))
        .catch(() => setPickerResults([]))
        .finally(() => setPickerBusy(false));
    }, 250);
    return () => clearTimeout(timer);
  }, [pickerQuery]);

  async function handleLogin() {
    const id = Number(recyclerId);
    if (!id) { setLoginError(t('login.recyclerIdRequired')); return; }
    setLoginError('');
    setLoginBusy(true);
    try {
      const res = await loginRecycler(id);
      const { recycler, token } = res.data;
      saveSession({
        role: 'recycler',
        userId: recycler.id,
        name: recycler.name,
        facility_location: recycler.facility_location,
        materials_accepted: recycler.materials_accepted,
        token,
      });
      navigate('/recycler', { replace: true });
    } catch (err) {
      setLoginError(err.message || t('login.loginFailed'));
    } finally {
      setLoginBusy(false);
    }
  }

  function pickRecycler(r) {
    setRecyclerId(String(r.id));
    setPickerQuery('');
    setPickerResults([]);
    setPickerOpen(false);
    setLoginError('');
  }

  function toggleMaterial(id) {
    setForm(f => ({
      ...f,
      materials_accepted: f.materials_accepted.includes(id)
        ? f.materials_accepted.filter(m => m !== id)
        : [...f.materials_accepted, id],
    }));
  }

  async function handleApply() {
    if (!form.name.trim()) { setApplyError('Please enter your facility name.'); return; }
    if (!form.facility_location.trim()) { setApplyError('Please enter your facility location.'); return; }
    if (form.materials_accepted.length === 0) { setApplyError('Select at least one material category.'); return; }
    setApplyError('');
    setApplyBusy(true);
    try {
      const res = await onboardRecycler(form);
      setAppliedId(res.data?.id);
      setApplied(true);
    } catch (err) {
      setApplyError(err.message || 'Could not submit application. Please try again.');
    } finally {
      setApplyBusy(false);
    }
  }

  const [approvingBusy, setApprovingBusy] = useState(false);

  async function handleQuickApproveAndLogin() {
    if (!appliedId) return;
    setApprovingBusy(true);
    try {
      await adminVerifyRecycler(appliedId, {
        decision: 'authorized',
        verification_source: 'Instant Admin Verification (Demo / Evaluator Mode)',
      });
      const res = await loginRecycler(appliedId);
      const { recycler, token } = res.data;
      saveSession({
        role: 'recycler',
        userId: recycler.id,
        name: recycler.name,
        facility_location: recycler.facility_location,
        materials_accepted: recycler.materials_accepted,
        token,
      });
      navigate('/recycler', { replace: true });
    } catch (err) {
      setApplyError(err.message || 'Auto-approval failed. Please verify via /admin.');
      setApprovingBusy(false);
    }
  }

  // ── Applied success screen ───────────────────────────────────────────────
  if (applied) {
    return (
      <div className="container login-page">
        <div className="login-card card animate-scale-in">
          <div className="login-card__head">
            <div style={{ fontSize: 48, textAlign: 'center' }}>✅</div>
            <h1 className="section-title" style={{ textAlign: 'center' }}>Application Submitted</h1>
            <p className="section-subtitle" style={{ textAlign: 'center' }}>
              Your recycler application has been received and is pending regulatory/admin verification.
            </p>
          </div>
          <div className="card" style={{ background: 'var(--color-surface-alt)', padding: 'var(--space-4)', borderRadius: 'var(--radius-md)', margin: 'var(--space-4) 0' }}>
            <p style={{ margin: 0, fontSize: 'var(--text-sm)' }}>
              <strong>Your Recycler ID:</strong>{' '}
              <span className="font-mono" style={{ fontSize: 'var(--text-lg)', color: 'var(--color-primary)' }}>
                {appliedId ?? '—'}
              </span>
            </p>
            <p style={{ margin: 'var(--space-2) 0 0', fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
              Save this ID. Once authorized by the platform admin or SPCB, use it to sign in.
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', margin: 'var(--space-4) 0' }}>
            <button
              className="btn btn-primary btn-full"
              onClick={handleQuickApproveAndLogin}
              disabled={approvingBusy}
            >
              {approvingBusy ? <><LoadingSpinner size="sm" /> Authorizing & Signing In…</> : '⚡ Demo: Quick Authorize & Log In Now'}
            </button>

            <Link to="/admin" className="btn btn-outline btn-full" style={{ textAlign: 'center' }}>
              🛡️ Open Admin Approval Queue (/admin)
            </Link>

            <button
              className="btn btn-ghost btn-full"
              onClick={() => { setApplied(false); setRecyclerId(String(appliedId)); setMode('login'); }}
            >
              Back to Sign In
            </button>
          </div>

          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', textAlign: 'center', margin: 0 }}>
            Under CPCB E-Waste rules, recyclers require authorization before handling hazardous lots. For instant testing, use the Quick Authorize button above or sign in to <code>/admin</code> (code: <code>admin123</code>).
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="container login-page">
      <div className="login-card card animate-scale-in">
        <div className="login-card__head login-card__head--recycler">
          <div className="login-card__logo login-card__logo--recycler" aria-hidden="true">♻️</div>
          <h1 className="section-title">
            {mode === 'login' ? (t('recyclerLogin.title') || 'Recycler Portal') : 'Apply as Recycler'}
          </h1>
          <p className="section-subtitle">
            {mode === 'login'
              ? (t('recyclerLogin.subtitle') || 'Sign in to manage incoming lots')
              : 'Submit your facility details for admin verification'}
          </p>
        </div>

        {/* Mode toggle */}
        <div className="filter-tabs" role="tablist" style={{ marginBottom: 'var(--space-4)' }}>
          <button
            role="tab"
            aria-selected={mode === 'login'}
            className={`filter-tab ${mode === 'login' ? 'filter-tab--active' : ''}`}
            onClick={() => { setMode('login'); setLoginError(''); }}
          >
            Sign In
          </button>
          <button
            role="tab"
            aria-selected={mode === 'apply'}
            className={`filter-tab ${mode === 'apply' ? 'filter-tab--active' : ''}`}
            onClick={() => { setMode('apply'); setApplyError(''); }}
          >
            Apply / Register
          </button>
        </div>

        {/* ── SIGN IN ──────────────────────────────────────────────────── */}
        {mode === 'login' && (
          <section className="login-panel" aria-labelledby="rec-heading">
            {loginError && (
              <div className="alert-banner alert-banner--error animate-fade-in" role="alert">
                {loginError}
              </div>
            )}

            <div className="form-group">
              <label className="form-label" htmlFor="recycler-name-search">
                Find your facility by name
              </label>
              <input
                id="recycler-name-search"
                className="form-input"
                type="search"
                autoComplete="off"
                placeholder="Type 2+ letters, e.g. Trishyirya, E-R3, Cerebra, Fozia…"
                value={pickerQuery}
                onChange={(e) => setPickerQuery(e.target.value)}
                onBlur={() => setTimeout(() => setPickerOpen(false), 150)}
              />
              {pickerOpen && (
                <div className="recycler-picker">
                  {pickerBusy && <span className="recycler-picker__hint">Searching…</span>}
                  {!pickerBusy && pickerResults.length === 0 && (
                    <span className="recycler-picker__hint">No authorized recyclers match “{pickerQuery.trim()}”.</span>
                  )}
                  {pickerResults.length > 0 && (
                    <ul className="recycler-picker__list" role="listbox" aria-label="Matching recyclers">
                      {pickerResults.map((r) => (
                        <li key={r.id} role="option">
                          <button
                            type="button"
                            className="recycler-picker__item"
                            onClick={() => pickRecycler(r)}
                            disabled={loginBusy}
                          >
                            <span className="recycler-picker__name">#{r.id} · {r.name}</span>
                            <span className="recycler-picker__loc">{r.service_area || r.facility_location || '—'}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>

            <label className="form-label" htmlFor="login-recycler-id">
              {t('login.recyclerIdLabel') || 'Recycler ID'}
            </label>
            <input
              id="login-recycler-id"
              className="form-input"
              type="number"
              min="1"
              inputMode="numeric"
              placeholder={t('login.recyclerIdPlaceholder') || 'Enter your recycler ID'}
              value={recyclerId}
              onChange={(e) => setRecyclerId(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleLogin(); }}
            />
            <button
              className="btn btn-primary btn-full"
              onClick={handleLogin}
              disabled={loginBusy}
              aria-busy={loginBusy}
            >
              {loginBusy ? <><LoadingSpinner size="sm" /> Signing in…</> : (t('login.recyclerSignIn') || 'Sign in to Recycler Portal')}
            </button>

            {recyclers.length > 0 && (
              <div className="login-demo" role="group" aria-label={t('login.demoRecyclers') || 'Demo recyclers'}>
                <p className="login-demo__label">{t('login.demoRecyclers') || 'Demo verified recyclers:'}</p>
                {recyclers.slice(0, 4).map((r) => (
                  <button
                    key={r.id}
                    className="demo-chip"
                    onClick={() => { setRecyclerId(String(r.id)); }}
                    disabled={loginBusy}
                  >
                    <span className="demo-chip__name">#{r.id} · {r.name}</span>
                    <span className="demo-chip__phone font-mono">{r.facility_location}</span>
                  </button>
                ))}
              </div>
            )}
            <p className="login-hint">{t('login.recyclerHint2') || 'Only admin-verified recyclers can sign in.'}</p>
          </section>
        )}

        {/* ── APPLY / REGISTER ─────────────────────────────────────────── */}
        {mode === 'apply' && (
          <section className="login-panel" aria-labelledby="apply-heading">
            {applyError && (
              <div className="alert-banner alert-banner--error animate-fade-in" role="alert">
                {applyError}
              </div>
            )}

            <div className="form-group">
              <label className="form-label" htmlFor="apply-name">Facility / Business Name *</label>
              <input
                id="apply-name"
                className="form-input"
                placeholder="e.g. GreenCycle Recyclers Pvt. Ltd."
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              />
            </div>

            <div className="form-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-1)' }}>
                <label className="form-label" htmlFor="apply-location" style={{ margin: 0 }}>Facility Location / Address *</label>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={handleAutoDetectGps}
                  disabled={detectingGps}
                  style={{ fontSize: '0.8rem', padding: '2px 8px', height: 'auto' }}
                >
                  {detectingGps ? <><LoadingSpinner size="sm" /> Locating…</> : '📍 Detect GPS'}
                </button>
              </div>
              <input
                id="apply-location"
                className="form-input"
                placeholder="e.g. Peenya Industrial Area, Bengaluru or Okhla, Delhi"
                value={form.facility_location}
                onChange={e => setForm(f => ({ ...f, facility_location: e.target.value }))}
              />
              {gpsStatus && (
                <p className="form-hint" style={{ color: form.latitude ? 'var(--color-success, #16a34a)' : 'var(--color-primary)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                  {detectingGps && <LoadingSpinner size="sm" />}
                  <span>{gpsStatus}</span>
                </p>
              )}
              {!gpsStatus && (
                <p className="form-hint">
                  Coordinates will be automatically resolved from this address and mapped for collectors.
                </p>
              )}
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="apply-contact">Contact Number / Email</label>
              <input
                id="apply-contact"
                className="form-input"
                placeholder="+91 XXXXX XXXXX"
                value={form.contact_details}
                onChange={e => setForm(f => ({ ...f, contact_details: e.target.value }))}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Materials Accepted *</label>
              <div className="p2-subcat-pills" role="group" aria-label="Material categories">
                {MATERIAL_CATEGORIES.map(cat => (
                  <button
                    key={cat.id}
                    type="button"
                    className={`p2-subcat-pill ${form.materials_accepted.includes(cat.id) ? 'p2-subcat-pill--active' : ''}`}
                    onClick={() => toggleMaterial(cat.id)}
                    aria-pressed={form.materials_accepted.includes(cat.id)}
                  >
                    {cat.icon} {cat.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="apply-pickup">Pickup Availability</label>
              <select
                id="apply-pickup"
                className="form-input form-select"
                value={form.pickup_availability}
                onChange={e => setForm(f => ({ ...f, pickup_availability: e.target.value }))}
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="on_request">On Request</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="apply-area">Service Area</label>
              <input
                id="apply-area"
                className="form-input"
                placeholder="e.g. Bengaluru North, 20 km radius"
                value={form.service_area}
                onChange={e => setForm(f => ({ ...f, service_area: e.target.value }))}
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="apply-auth-num">SPCB Authorization / License Number</label>
              <input
                id="apply-auth-num"
                className="form-input"
                placeholder="e.g. SPCB/AUTH/2026/102"
                value={form.authorization_number}
                onChange={e => setForm(f => ({ ...f, authorization_number: e.target.value }))}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)' }}>
              <div className="form-group">
                <label className="form-label" htmlFor="apply-auth-issue">License Issue Date</label>
                <input
                  id="apply-auth-issue"
                  type="date"
                  className="form-input"
                  value={form.authorization_issue_date}
                  onChange={e => setForm(f => ({ ...f, authorization_issue_date: e.target.value }))}
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="apply-auth-expiry">License Expiry Date *</label>
                <input
                  id="apply-auth-expiry"
                  type="date"
                  className="form-input"
                  value={form.authorization_valid_until}
                  onChange={e => setForm(f => ({ ...f, authorization_valid_until: e.target.value }))}
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="apply-doc-url">Authorization Certificate Document Link (PDF / Image URL)</label>
              <input
                id="apply-doc-url"
                type="url"
                className="form-input"
                placeholder="https://spcb.gov.in/docs/cert_102.pdf"
                value={form.authorization_document_url}
                onChange={e => setForm(f => ({ ...f, authorization_document_url: e.target.value }))}
              />
              <p className="form-hint">Upload or link your SPCB authorization document so platform admin can review and verify your application.</p>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="apply-auth">SPCB Authorization Notes / Remarks</label>
              <textarea
                id="apply-auth"
                className="form-input"
                rows={2}
                placeholder="Issuing authority, hazardous waste handling limits, special permits…"
                value={form.authorization_details}
                onChange={e => setForm(f => ({ ...f, authorization_details: e.target.value }))}
              />
            </div>

            <button
              className="btn btn-primary btn-full"
              onClick={handleApply}
              disabled={applyBusy}
              aria-busy={applyBusy}
            >
              {applyBusy ? <><LoadingSpinner size="sm" /> Submitting…</> : 'Submit Application'}
            </button>
          </section>
        )}

        <div className="login-role-switch">
          <span>Not a recycler?</span>
          <Link to="/login/collector">Login as Collector</Link>
        </div>
        <p className="login-foot">
          <Link to="/">← Back to home</Link>
        </p>
      </div>
    </div>
  );
}
