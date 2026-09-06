/** Collector (Kabadiwala) registration — /collector/register
 *
 * Creates a new collector account via POST /v1/collectors/register and signs
 * the person straight in (the backend returns a session token), just like login.
 */

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { registerCollector } from '../api/client';
import { saveSession, getSession } from '../services/auth';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { useTranslation } from '../i18n/config.js';
import './Login.css';

const LANGUAGES = ['hi', 'en', 'mr', 'kn'];

export default function Register() {
  const { t, setLang } = useTranslation();
  const navigate = useNavigate();

  const [form, setForm] = useState({
    name: '',
    phone: '',
    operating_location: '',
    preferred_language: getSession()?.preferred_language || 'hi',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function setField(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit() {
    const name = form.name.trim();
    const phone = form.phone.trim();
    if (name.length < 2) { setError(t('register.errName')); return; }
    if (!/^[6-9]\d{9}$/.test(phone)) { setError(t('register.errPhone')); return; }

    setError(''); setBusy(true);
    try {
      // POST /v1/collectors/register → { data: { collector, token } }
      const res = await registerCollector({
        name,
        phone,
        operating_location: form.operating_location.trim() || undefined,
        preferred_language: form.preferred_language,
      });
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
      setError(err.message || t('register.errSubmit'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container login-page">
      <div className="login-card card animate-scale-in">
        <div className="login-card__head">
          <div className="login-card__logo" aria-hidden="true"></div>
          <h1 className="section-title">{t('register.title')}</h1>
          <p className="section-subtitle">{t('register.subtitle')}</p>
        </div>

        {error && (
          <div className="alert-banner alert-banner--error animate-fade-in" role="alert">
            {error}
          </div>
        )}

        <section className="login-panel" aria-labelledby="reg-heading">
          <h2 id="reg-heading" className="login-panel__title">
            {t('login.kabadiwala')}
          </h2>

          <label className="form-label" htmlFor="reg-name">{t('register.name')}</label>
          <input
            id="reg-name"
            className="form-input"
            type="text"
            autoComplete="name"
            placeholder={t('register.namePlaceholder')}
            value={form.name}
            onChange={(e) => setField('name', e.target.value)}
          />

          <label className="form-label" htmlFor="reg-phone">{t('login.phoneLabel')}</label>
          <input
            id="reg-phone"
            className="form-input"
            type="tel"
            inputMode="numeric"
            maxLength={10}
            placeholder={t('login.phonePlaceholder')}
            value={form.phone}
            onChange={(e) => setField('phone', e.target.value.replace(/\D/g, '').slice(0, 10))}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
          />

          <label className="form-label" htmlFor="reg-loc">{t('register.location')}</label>
          <input
            id="reg-loc"
            className="form-input"
            type="text"
            placeholder={t('register.locationPlaceholder')}
            value={form.operating_location}
            onChange={(e) => setField('operating_location', e.target.value)}
          />

          <fieldset className="pay-methods" aria-label={t('register.language')}>
            <legend className="form-label">{t('register.language')}</legend>
            {LANGUAGES.map((lang) => (
              <label key={lang} className={`pay-method ${form.preferred_language === lang ? 'pay-method--active' : ''}`}>
                <input
                  type="radio"
                  name="prefLang"
                  value={lang}
                  checked={form.preferred_language === lang}
                  onChange={() => setField('preferred_language', lang)}
                />
                <span>{t(`register.lang.${lang}`)}</span>
              </label>
            ))}
          </fieldset>

          <button
            className="btn btn-primary btn-full"
            onClick={handleSubmit}
            disabled={busy}
            aria-busy={busy}
          >
            {busy ? <><LoadingSpinner size="sm" /> {t('register.creating')}…</> : <> {t('register.create')}</>}
          </button>
        </section>

        <p className="login-foot">
          <Link to="/login">{t('register.haveAccount')}</Link>
        </p>
      </div>
    </div>
  );
}