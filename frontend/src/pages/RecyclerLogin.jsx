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
    facility_address: '',
    facility_location: '',
    latitude: null,
    longitude: null,
    location_accuracy: null,
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
      setGpsStatus('Geolocation is not supported by your browser');
      return;
    }
    setDetectingGps(true);
    setGpsStatus('Acquiring precise facility GPS coordinates…');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        const lat = parseFloat(latitude.toFixed(6));
        const lng = parseFloat(longitude.toFixed(6));
        const acc = accuracy ? Math.round(accuracy) : null;
        setForm(f => ({
          ...f,
          latitude: lat,
          longitude: lng,
          location_accuracy: acc,
          facility_location: f.facility_location || f.facility_address || `GPS Location (${lat.toFixed(4)}, ${lng.toFixed(4)})`,
        }));
        let accMsg = '';
        if (acc != null) {
          if (acc <= 20) accMsg = ` · Good accuracy (±${acc}m)`;
          else if (acc <= 50) accMsg = ` · Acceptable accuracy (±${acc}m)`;
          else accMsg = ` · ⚠️ Low accuracy (±${acc}m) — consider moving outdoors and retrying`;
        }
        setGpsStatus(`📍 Coordinates set: ${lat.toFixed(6)}, ${lng.toFixed(6)}${accMsg}`);
        setDetectingGps(false);
      },
      (err) => {
        setGpsStatus('⚠️ Could not access GPS. Please allow location access in your browser and try again.');
        setDetectingGps(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }

  useEffect(() => {
    getAllRecyclers()
      .then((r) => setRecyclers((Array.isArray(r.data) ? r.data : []).filter((x) => ['authorized', 'valid', 'expiring_soon'].includes(x.authorization_status) && x.account_status !== 'SUSPENDED')))
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
      getAllRecyclers({ name: q, limit: 20 })
        .then((r) => setPickerResults((Array.isArray(r.data) ? r.data : []).filter((x) => ['authorized', 'valid', 'expiring_soon'].includes(x.authorization_status) && x.account_status !== 'SUSPENDED')))
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
    const addr = (form.facility_address || form.facility_location || '').trim();
    if (!addr) { setApplyError('Please enter your physical facility address.'); return; }
    if (form.latitude == null || form.longitude == null) {
      setApplyError('Facility GPS coordinates are mandatory for collector distance matching. Please click "Detect / Set Facility Location".');
      return;
    }
    if (form.materials_accepted.length === 0) { setApplyError('Select at least one material category.'); return; }
    setApplyError('');
    setApplyBusy(true);
    try {
      const payload = {
        ...form,
        facility_address: addr,
        facility_location: form.facility_location?.trim() || addr,
        location_source: 'GPS',
      };
      const res = await onboardRecycler(payload);
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
              <label className="form-label" htmlFor="apply-address">Facility Physical Address *</label>
              <textarea
                id="apply-address"
                className="form-input"
                rows={2}
                placeholder="e.g. Plot No. 25, 4th Cross, Peenya Industrial Area, Bengaluru, Karnataka - 560058"
                value={form.facility_address || form.facility_location}
                onChange={e => setForm(f => ({ ...f, facility_address: e.target.value, facility_location: e.target.value }))}
              />
              <p className="form-hint" style={{ fontSize: '0.8rem', marginTop: '4px' }}>
                Physical postal address used on invoices, consignment manifests, and official documentation.
              </p>
            </div>

            <div className="form-group" style={{ padding: '14px', borderRadius: '8px', background: form.latitude ? 'rgba(22, 163, 74, 0.05)' : 'rgba(124, 58, 237, 0.05)', border: form.latitude ? '1px solid rgba(22, 163, 74, 0.3)' : '1px dashed rgba(124, 58, 237, 0.35)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px', marginBottom: '10px' }}>
                <div>
                  <label className="form-label" style={{ margin: 0, fontWeight: 700, fontSize: '0.92rem' }}>
                    📍 Facility Location (GPS Coordinates) * <span style={{ fontSize: '0.78rem', color: '#dc2626', fontWeight: 600 }}>(Mandatory)</span>
                  </label>
                  <p style={{ margin: '2px 0 0', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                    Actual physical GPS location of the processing facility used to calculate collector pickup distances.
                  </p>
                </div>
                <button
                  type="button"
                  className={`btn ${form.latitude ? 'btn-outline' : 'btn-primary'} btn-sm`}
                  onClick={handleAutoDetectGps}
                  disabled={detectingGps}
                  style={{ fontSize: '0.82rem', padding: '5px 12px' }}
                >
                  {detectingGps ? <><LoadingSpinner size="sm" /> Acquiring GPS…</> : form.latitude ? '📍 Change Location' : '📍 Detect / Set Location'}
                </button>
              </div>

              {form.latitude != null && form.longitude != null ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', background: 'var(--color-bg, #fff)', padding: '10px 14px', borderRadius: '6px', border: '1px solid var(--color-border)' }}>
                  <div>
                    <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', display: 'block', textTransform: 'uppercase', letterSpacing: '0.04em' }}>FACILITY GPS COORDINATES</span>
                    <span className="font-mono" style={{ fontWeight: 600, fontSize: '0.92rem', color: 'var(--color-text)' }}>
                      {form.latitude.toFixed(6)}, {form.longitude.toFixed(6)}
                    </span>
                  </div>
                  {form.location_accuracy != null && (
                    <span
                      className={`status-badge ${form.location_accuracy <= 20 ? 'status-badge--success' : form.location_accuracy <= 50 ? 'status-badge--warning' : 'status-badge--error'}`}
                      style={{ fontSize: '0.75rem', padding: '3px 8px' }}
                    >
                      {form.location_accuracy <= 20 ? '🟢 High' : form.location_accuracy <= 50 ? '🟡 Acceptable' : '🔴 Low'}: ±{form.location_accuracy}m
                    </span>
                  )}
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setForm(f => ({ ...f, latitude: null, longitude: null, location_accuracy: null }))}
                    style={{ marginLeft: 'auto', fontSize: '0.75rem', color: '#dc2626', padding: '2px 8px' }}
                    title="Reset coordinates"
                  >
                    Reset
                  </button>
                </div>
              ) : (
                <div style={{ padding: '10px 14px', borderRadius: '6px', background: 'rgba(220, 38, 38, 0.06)', border: '1px solid rgba(220, 38, 38, 0.25)', fontSize: '0.82rem', color: '#b91c1c', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>⚠️</span>
                  <span>GPS coordinates are not set. You must click <strong>"Detect / Set Location"</strong> to complete registration.</span>
                </div>
              )}

              {gpsStatus && (
                <p className="form-hint" style={{ marginTop: '8px', marginBottom: 0, fontSize: '0.8rem', color: form.latitude ? 'var(--color-success, #16a34a)' : 'var(--color-primary)' }}>
                  {gpsStatus}
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
