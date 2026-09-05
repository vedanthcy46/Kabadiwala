import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from '../i18n/config.js';
import { getSession, clearSession } from '../services/auth';
import './Navbar.css';

const LANG_OPTIONS = [
  { code: 'en', label: 'EN' },
  { code: 'hi', label: 'हिंदी' },
  { code: 'mr', label: 'मराठी' },
];

function navFor(role, t) {
  if (role === 'recycler') {
    return [
      { to: '/recycler', label: t('nav.recyclerPortal'), icon: '⊞' },
      { to: '/recycler/scan', label: t('recyclerScan.nav'), icon: '▣' },
      { to: '/recycler?section=profile', label: t('recyclerProfile.title'), icon: '👤' },
      { to: '/safety', label: t('nav.safety'), icon: '' },
    ];
  }
  if (role === 'admin') {
    return [
      { to: '/admin', label: t('nav.admin'), icon: '◎' },
      { to: '/safety', label: t('nav.safety'), icon: '' },
    ];
  }
  return [
    { to: '/collector', label: t('nav.dashboard'), icon: '' },
    { to: '/collector/create-lot', label: t('nav.createLot'), icon: '+' },
    { to: '/collector/prices', label: t('nav.prices'), icon: '₹' },
    { to: '/collector/earnings', label: t('nav.earnings'), icon: '' },
    { to: '/safety', label: t('nav.safety'), icon: '' },
  ];
}

export function Navbar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { t, lang, setLang } = useTranslation();

  const user = getSession();
  const navItems = navFor(user?.role, t);
  const homePath = user?.role === 'recycler' ? '/recycler' : user?.role === 'admin' ? '/admin' : '/collector';
  const [drawerOpen, setDrawerOpen] = useState(false);
  const closeButtonRef = useRef(null);

  const isActive = (to) => location.pathname === to || location.pathname.startsWith(`${to}/`);

  function handleLogout() {
    clearSession();
    setDrawerOpen(false);
    navigate('/', { replace: true });
  }

  function handleNav() {
    setDrawerOpen(false);
  }

  useEffect(() => {
    if (!drawerOpen) return;
    function onKey(e) {
      if (e.key === 'Escape') setDrawerOpen(false);
    }
    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [drawerOpen]);

  return (
    <header className="navbar" role="banner">
      <div className="navbar__inner container">
        <Link to={homePath} className="navbar__logo" aria-label={t('nav.homeLabel')} onClick={() => setDrawerOpen(false)}>
          <div className="navbar__logo-text">
            <span className="navbar__logo-name">Kabadiwala</span>
            <span className="navbar__logo-sub">Connect</span>
          </div>
        </Link>

        <nav className="navbar__nav hide-mobile" aria-label={t('nav.mainNav')}>
          {navItems.map(item => (
            <Link
              key={item.to}
              to={item.to}
              className={`navbar__nav-item ${isActive(item.to) ? 'navbar__nav-item--active' : ''}`}
            >
              <span aria-hidden="true">{item.icon}</span>
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="navbar__right">
          <div className="lang-switcher hide-mobile" role="group" aria-label="Language / भाषा">
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

          {user ? (
            <div className="navbar__account">
              <Link
                to={user.role === 'recycler' ? '/recycler' : user.role === 'admin' ? '/admin' : '/collector'}
                className="navbar__user"
                title={`${t('login.loggedInAs')} ${user.name}`}
                onClick={() => setDrawerOpen(false)}
              >
                <span className="navbar__avatar" aria-hidden="true">
                  {(user.name || '?').charAt(0).toUpperCase()}
                </span>
                <span className="navbar__username hide-mobile">{user.name}</span>
              </Link>
              <button className="navbar__logout hide-mobile" onClick={handleLogout} aria-label={t('login.logout')}>
                {t('login.logout')}
              </button>
            </div>
          ) : (
            <Link to="/login" className="btn btn-primary btn-sm hide-mobile" onClick={() => setDrawerOpen(false)}>
              {t('login.signIn')}
            </Link>
          )}

          <button
            className="navbar__hamburger"
            onClick={() => setDrawerOpen((open) => !open)}
            aria-label={drawerOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={drawerOpen}
            aria-controls="mobile-navigation"
          >
            <span></span>
            <span></span>
            <span></span>
          </button>
        </div>
      </div>

      {drawerOpen && createPortal(<>
        <div id="mobile-navigation" className="navbar__drawer" role="dialog" aria-modal="true" aria-label={t('nav.mobileNav')}>
        <div className="navbar__drawer-inner">
          <div className="navbar__drawer-head">
            <div>
              <p className="navbar__drawer-greet">{t('login.loggedInAs')}</p>
              <p className="navbar__drawer-name">{user?.name || 'Guest'}</p>
            </div>
            <button ref={closeButtonRef} className="navbar__drawer-close" onClick={() => setDrawerOpen(false)} aria-label="Close menu">
              ✕
            </button>
          </div>

          <nav className="navbar__drawer-nav" aria-label={t('nav.mobileNav')}>
            {navItems.map(item => (
              <Link
                key={item.to}
                to={item.to}
                className={`navbar__drawer-item ${isActive(item.to) ? 'navbar__drawer-item--active' : ''}`}
                onClick={handleNav}
              >
                <span aria-hidden="true">{item.icon}</span>
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="navbar__drawer-foot">
            <div className="mobile-lang-row" role="group" aria-label="Language / भाषा">
              <select
                className="mobile-lang-dropdown"
                value={lang}
                onChange={(e) => { setLang(e.target.value); }}
                aria-label="Select Language"
              >
                {LANG_OPTIONS.map((opt) => (
                  <option key={opt.code} value={opt.code}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            {user ? (
              <button className="btn btn-outline btn-full" onClick={handleLogout}>
                {t('login.logout')}
              </button>
            ) : (
              <Link to="/login" className="btn btn-primary btn-full" onClick={handleNav}>
                {t('login.signIn')}
              </Link>
            )}
          </div>
        </div>
        </div>

        <button className="navbar__backdrop" onClick={() => setDrawerOpen(false)} aria-label="Close menu" />
      </>, document.body)}
    </header>
  );
}
