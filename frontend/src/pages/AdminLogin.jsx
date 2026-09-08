/** Admin Login screen — /admin/login
 * Simple login for admin users with demo credentials
 */

import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useTranslation } from '../i18n/config.js';
import { saveSession } from '../services/auth';
import './Login.css';

const DEMO_ADMIN = {
  id: 1,
  name: 'Kabadiwala Admin',
  email: 'admin@kabadiwala.in',
  admin_code: 'KBC-ADMIN-2026',
};

export default function AdminLogin() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [adminCode, setAdminCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleAdminLogin() {
    const code = String(adminCode ?? '').trim().toUpperCase();
    if (!code) {
      setError(t('admin.codeRequired'));
      return;
    }
    setError('');
    setBusy(true);

    // Simulate admin authentication
    setTimeout(() => {
      if (code === DEMO_ADMIN.admin_code) {
        saveSession({
          role: 'admin',
          userId: DEMO_ADMIN.id,
          name: DEMO_ADMIN.name,
          email: DEMO_ADMIN.email,
        });
        navigate('/admin', { replace: true });
      } else {
        setError(t('admin.loginFail'));
      }
      setBusy(false);
    }, 500);
  }

  return (
    <div className="container login-page">
      <div className="login-card card animate-scale-in">
        <Link to="/" className="back-link" style={{ alignSelf: 'flex-start', marginBottom: 'var(--space-2)' }}>
          {t('common.back')}
        </Link>
        <div className="login-card__head login-card__head--admin">
          <div className="login-card__logo login-card__logo--admin" aria-hidden="true">⚙️</div>
          <h1 className="section-title">{t('adminLogin.title')}</h1>
          <p className="section-subtitle">{t('adminLogin.subtitle')}</p>
        </div>

        {error && (
          <div className="alert-banner alert-banner--error animate-fade-in" role="alert">
            {error}
          </div>
        )}

        <section className="login-panel" aria-labelledby="admin-heading">
          <label className="form-label" htmlFor="admin-code">
            {t('adminLogin.codeLabel')}
          </label>
          <input
            id="admin-code"
            className="form-input"
            type="text"
            placeholder={t('adminLogin.codePlaceholder')}
            value={adminCode}
            onChange={(e) => setAdminCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAdminLogin(); }}
          />

          <button
            className="btn btn-primary btn-full"
            onClick={handleAdminLogin}
            disabled={busy}
            aria-busy={busy}
          >
            {busy ? t('common.loading') : t('adminLogin.signIn')}
          </button>

          <div className="login-demo" role="group">
            <p className="login-demo__label">{t('adminLogin.demoCode')}</p>
            <button
              className="demo-chip"
              onClick={() => setAdminCode(DEMO_ADMIN.admin_code)}
            >
              <span className="demo-chip__name">{DEMO_ADMIN.admin_code}</span>
            </button>
          </div>
        </section>

        <p className="login-foot">
          <Link to="/">{t('adminLogin.backToLogin')}</Link>
        </p>
      </div>
    </div>
  );
}