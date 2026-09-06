/** Landing page — home screen when not logged in
 * Shows hero, features, and login options for all user types
 */

import { Link } from 'react-router-dom';
import { useTranslation } from '../i18n/config.js';
import './Landing.css';

const LANG_OPTIONS = [
  { code: 'en', label: 'EN' },
  { code: 'hi', label: 'हिंदी' },
  { code: 'mr', label: 'मराठी' },
  { code: 'kn', label: 'ಕನ್ನಡ' },
];

export default function Landing() {
  const { t, lang, setLang } = useTranslation();

  return (
    <div className="landing-page">
      {/* Language Selector - Top Right */}
      <div className="landing-lang">
        <select
          className="lang-dropdown"
          value={lang}
          onChange={(e) => setLang(e.target.value)}
          aria-label="Select Language"
        >
          {LANG_OPTIONS.map((opt) => (
            <option key={opt.code} value={opt.code}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Hero Section */}
      <section className="hero">
        <div className="hero__bg"></div>
        <div className="container hero__content">
          <div className="hero__text">
            <h1 className="hero__title animate-fade-in">
              <span className="hero__title-main">Kabadiwala</span>
              <span className="hero__title-sub">Connect</span>
            </h1>
            <p className="hero__tagline animate-fade-in" style={{ animationDelay: '100ms' }}>
              {t('landing.tagline')}
            </p>
            <div className="hero__actions animate-fade-in" style={{ animationDelay: '200ms' }}>
              <Link to="/login/collector" className="btn btn-accent btn-lg">
                {t('landing.getStarted')}
              </Link>
              <Link to="/safety" className="btn btn-outline btn-lg">
                {t('landing.learnMore')}
              </Link>
            </div>
          </div>
          <div className="hero__visual animate-scale-in" style={{ animationDelay: '300ms' }}>
            <div className="hero__illustration">
              <div className="hero__circle hero__circle--1"></div>
              <div className="hero__circle hero__circle--2"></div>
              <div className="hero__circle hero__circle--3"></div>
              <div className="hero__icon hero__icon--recycler">♻️</div>
              <div className="hero__icon hero__icon--kabadiwala">📦</div>
              <div className="hero__icon hero__icon--rupee">₹</div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="features">
        <div className="container">
          <h2 className="section-title" style={{ textAlign: 'center', marginBottom: 'var(--space-8)' }}>
            {t('landing.featuresTitle')}
          </h2>
          <div className="features__grid">
            <div className="feature-card animate-fade-in" style={{ animationDelay: '100ms' }}>
              <div className="feature-card__icon">📱</div>
              <h3 className="feature-card__title">{t('landing.feature1Title')}</h3>
              <p className="feature-card__desc">{t('landing.feature1Desc')}</p>
            </div>
            <div className="feature-card animate-fade-in" style={{ animationDelay: '200ms' }}>
              <div className="feature-card__icon">💰</div>
              <h3 className="feature-card__title">{t('landing.feature2Title')}</h3>
              <p className="feature-card__desc">{t('landing.feature2Desc')}</p>
            </div>
            <div className="feature-card animate-fade-in" style={{ animationDelay: '300ms' }}>
              <div className="feature-card__icon">🔍</div>
              <h3 className="feature-card__title">{t('landing.feature3Title')}</h3>
              <p className="feature-card__desc">{t('landing.feature3Desc')}</p>
            </div>
            <div className="feature-card animate-fade-in" style={{ animationDelay: '400ms' }}>
              <div className="feature-card__icon">📍</div>
              <h3 className="feature-card__title">{t('landing.feature4Title')}</h3>
              <p className="feature-card__desc">{t('landing.feature4Desc')}</p>
            </div>
          </div>
        </div>
      </section>

      {/* User Types Section */}
      <section className="user-types">
        <div className="container">
          <h2 className="section-title" style={{ textAlign: 'center', marginBottom: 'var(--space-6)' }}>
            {t('landing.whoAreYou')}
          </h2>
          <div className="user-types__grid">
            <div className="user-type-card animate-fade-in" style={{ animationDelay: '100ms' }}>
              <div className="user-type-card__icon">📦</div>
              <h3 className="user-type-card__title">{t('landing.collector')}</h3>
              <p className="user-type-card__desc">{t('landing.collectorDesc')}</p>
              <Link to="/login/collector" className="btn btn-primary">{t('landing.loginAsCollector')}</Link>
            </div>
            <div className="user-type-card animate-fade-in" style={{ animationDelay: '200ms' }}>
              <div className="user-type-card__icon">♻️</div>
              <h3 className="user-type-card__title">{t('landing.recycler')}</h3>
              <p className="user-type-card__desc">{t('landing.recyclerDesc')}</p>
              <Link to="/login/recycler" className="btn btn-primary">{t('landing.loginAsRecycler')}</Link>
            </div>
            <div className="user-type-card animate-fade-in" style={{ animationDelay: '300ms' }}>
              <div className="user-type-card__icon">⚙️</div>
              <h3 className="user-type-card__title">{t('landing.admin')}</h3>
              <p className="user-type-card__desc">{t('landing.adminDesc')}</p>
              <Link to="/login/admin" className="btn btn-outline">{t('landing.loginAsAdmin')}</Link>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="cta">
        <div className="container">
          <div className="cta__content animate-fade-in">
            <h2 className="cta__title">{t('landing.ctaTitle')}</h2>
            <p className="cta__desc">{t('landing.ctaDesc')}</p>
            <Link to="/login/collector" className="btn btn-accent btn-lg">{t('landing.getStarted')}</Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="landing-footer">
        <div className="container">
          <p>&copy; 2026 Kabadiwala Connect. {t('landing.footer')}</p>
        </div>
      </footer>
    </div>
  );
}