/** Collector Login screen — /login/collector
 * Login for Kabadiwala (collectors) with phone number
 */

import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { loginCollector } from '../api/client';
import { saveSession } from '../services/auth';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { useTranslation } from '../i18n/config.js';
import './Login.css';

export default function CollectorLogin() {
  const { t, setLang } = useTranslation();
  const navigate = useNavigate();

  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleLogin() {
    const phoneValue = phone.trim();
    if (!phoneValue) { setError(t('login.phoneRequired')); return; }
    setError('');
    setBusy(true);
    try {
      const res = await loginCollector(phoneValue);
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
      setLang(collector.preferred_language);
      navigate('/collector', { replace: true });
    } catch (err) {
      setError(err.message || t('login.loginFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container login-page">
      <div className="login-card card animate-scale-in">
        <div className="login-card__head login-card__head--collector">
          <div className="login-card__logo login-card__logo--collector" aria-hidden="true">📦</div>
          <h1 className="section-title">{t('collectorLogin.title')}</h1>
          <p className="section-subtitle">{t('collectorLogin.subtitle')}</p>
        </div>

        {error && (
          <div className="alert-banner alert-banner--error animate-fade-in" role="alert">
            {error}
          </div>
        )}

        <section className="login-panel" aria-labelledby="coll-heading">
          <label className="form-label" htmlFor="login-phone">{t('collectorLogin.phoneLabel')}</label>
          <input
            id="login-phone"
            className="form-input"
            type="tel"
            inputMode="numeric"
            maxLength={10}
            placeholder={t('collectorLogin.phonePlaceholder')}
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
            onKeyDown={(e) => { if (e.key === 'Enter') handleLogin(); }}
          />

          <button
            className="btn btn-primary btn-full"
            onClick={handleLogin}
            disabled={busy}
            aria-busy={busy}
          >
            {busy ? <><LoadingSpinner size="sm" /> {t('collectorLogin.signingIn')}…</> : t('collectorLogin.signIn')}
          </button>

          <p className="login-hint">{t('collectorLogin.phoneHint')}</p>
          <p className="login-hint login-register-link">
            {t('collectorLogin.noAccount')}{' '}
            <Link to="/collector/register">{t('collectorLogin.createAccount')}</Link>
          </p>
        </section>

        {/* Role switcher */}
        <div className="login-role-switch">
          <span>{t('login.notCollector') || 'Not a collector?'}</span>
          <Link to="/login/recycler">{t('login.loginAsRecycler') || 'Login as Recycler'}</Link>
        </div>

        <p className="login-foot">
          <Link to="/">{t('landing.getStarted')}</Link>
        </p>
      </div>
    </div>
  );
}