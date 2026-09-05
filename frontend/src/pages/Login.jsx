/** Login screen — /login
 *
 * One portal for everyone, "just for now":
 *  - Kabadiwala (collector): sign in with a phone number. The backend matches a
 *    collector account and returns a session token. Required before creating a lot.
 *  - Recycler: demo persona only (single account standing in for the facility) —
 *    sign in with the recycler icon button when the evaluator wants the recycler view.
 *
 * Backs onto GET /v1/collectors and POST /v1/collectors/login.
 */

import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { loginCollector, loginRecycler, getAllRecyclers } from '../api/client';
import { saveSession } from '../services/auth';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { useTranslation } from '../i18n/config.js';
import './Login.css';

export default function Login({ location }) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [recyclers, setRecyclers] = useState([]);
  const [phones, setPhones] = useState({ collector: '', recycler: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const from = location?.state?.from || '/collector';

  useEffect(() => {
    getAllRecyclers()
      .then((r) => setRecyclers((Array.isArray(r.data) ? r.data : []).filter((x) => x.authorization_status === 'authorized')))
      .catch(() => { });
  }, []);

  async function handleCollectorLogin(phoneValue) {
    const phone = String(phoneValue ?? phones.collector ?? '').trim();
    if (!phone) { setError(t('login.phoneRequired')); return; }
    setError(''); setBusy(true);
    try {
      // POST /v1/collectors/login { phone } → { data: { collector, token } }
      const res = await loginCollector(phone);
      const { collector, token } = res.data;
      saveSession({
        role: 'collector',
        userId: collector.id,
        name: collector.name,
        phone: collector.phone,
        preferred_language: collector.preferred_language,
        operating_location: collector.operating_location,
        token,
      });
      navigate(from, { replace: true });
    } catch (err) {
      setError(err.message || t('login.loginFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function handleRecyclerLogin(recyclerIdValue) {
    const recyclerId = Number(recyclerIdValue ?? phones.recycler ?? '');
    if (!recyclerId) { setError(t('login.recyclerIdRequired')); return; }
    setError(''); setBusy(true);
    try {
      // POST /v1/recyclers/login { recycler_id } → { data: { recycler, token } }
      const res = await loginRecycler(recyclerId);
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
      setError(err.message || t('login.loginFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container login-page">
      <div className="login-card card animate-scale-in">
        <div className="login-card__head">
          <div className="login-card__logo" aria-hidden="true"></div>
          <h1 className="section-title">{t('login.title')}</h1>
          <p className="section-subtitle">{t('login.subtitle')}</p>
        </div>

        {error && (
          <div className="alert-banner alert-banner--error animate-fade-in" role="alert">
            {error}
          </div>
        )}

        {/* ── Kabadiwala (collector) login ─────────────────────────────── */}
        <section className="login-panel" aria-labelledby="coll-heading">
          <h2 id="coll-heading" className="login-panel__title">

            {t('login.kabadiwala')}
          </h2>

          <label className="form-label" htmlFor="login-phone">{t('login.phoneLabel')}</label>
          <input
            id="login-phone"
            className="form-input"
            type="tel"
            inputMode="numeric"
            maxLength={10}
            placeholder={t('login.phonePlaceholder')}
            value={phones.collector}
            onChange={(e) => setPhones((p) => ({ ...p, collector: e.target.value.replace(/\D/g, '').slice(0, 10) }))}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCollectorLogin(); }}
          />

          <button
            className="btn btn-primary btn-full"
            onClick={() => handleCollectorLogin()}
            disabled={busy}
            aria-busy={busy}
          >
            {busy ? <><LoadingSpinner size="sm" /> {t('login.signingIn')}…</> : <> {t('login.signIn')}</>}
          </button>

          <p className="login-hint">{t('login.phoneHint')}</p>
          <p className="login-hint login-register-link">
            {t('login.noAccount')}{' '}
            <Link to="/collector/register">{t('login.createAccount')}</Link>
          </p>
        </section>

        {/* ── Recycler sign-in ─────────────────────────────────────────── */}
        <section className="login-panel login-panel--recycler" aria-labelledby="rec-heading">
          <h2 id="rec-heading" className="login-panel__title">

            {t('login.recycler')}
          </h2>
          <p className="login-hint">{t('login.recyclerHint')}</p>

          <label className="form-label" htmlFor="login-recycler-id">{t('login.recyclerIdLabel')}</label>
          <input
            id="login-recycler-id"
            className="form-input"
            type="number"
            min="1"
            inputMode="numeric"
            placeholder={t('login.recyclerIdPlaceholder')}
            value={phones.recycler}
            onChange={(e) => setPhones((p) => ({ ...p, recycler: e.target.value }))}
            onKeyDown={(e) => { if (e.key === 'Enter') handleRecyclerLogin(); }}
          />
          <button
            className="btn btn-outline btn-full"
            onClick={() => handleRecyclerLogin()}
            disabled={busy}
            aria-busy={busy}
          >
            {busy ? <><LoadingSpinner size="sm" /> {t('common.loading')}…</> : <> {t('login.recyclerSignIn')}</>}
          </button>

          {recyclers.length > 0 && (
            <div className="login-demo" role="group" aria-label={t('login.demoRecyclers')}>
              <p className="login-demo__label">{t('login.demoRecyclers')}</p>
              {recyclers.map((r) => (
                <button
                  key={r.id}
                  className="demo-chip"
                  onClick={() => handleRecyclerLogin(r.id)}
                  disabled={busy}
                >
                  <span className="demo-chip__name">#{r.id} · {r.name}</span>
                  <span className="demo-chip__phone font-mono">{r.facility_location}</span>
                </button>
              ))}
            </div>
          )}
          <p className="login-hint">{t('login.recyclerHint2')}</p>
        </section>

        <p className="login-foot">
          <Link to="/">{t('landing.getStarted')}</Link>
        </p>
      </div>
    </div>
  );
}