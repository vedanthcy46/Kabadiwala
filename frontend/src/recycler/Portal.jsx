/** Recycler Portal — one page for the recycler side ("all in one portal just for now")
 *
 * Combines the recycler overview, incoming lots, and profile into a single
 * page with in-page section tabs. Legacy routes /recycler/lots and
 * /recycler/profile redirect here (see App.jsx).
 */

import { useEffect, useState } from 'react';
import { useLocation, Link } from 'react-router-dom';
import { useTranslation } from '../i18n/config.js';
import RecyclerDashboard from './Dashboard';
import IncomingLots from './IncomingLots';
import RecyclerProfile from './Profile';
import './Portal.css';

export default function RecyclerPortal() {
  const { t } = useTranslation();
  const location = useLocation();

  // Optional ?section=lots|profile|overview deep-link (used by quick links)
  const initialFromQuery = new URLSearchParams(location.search).get('section');
  const tab = ['lots', 'profile', 'overview'].includes(initialFromQuery) ? initialFromQuery : 'overview';

  const TABS = [
    { key: 'overview', label: t('recyclerPortal.overview'), icon: '' },
    { key: 'lots',     label: t('recyclerPortal.incomingLots'), icon: '' },
    { key: 'profile',  label: t('recyclerPortal.profile'), icon: '' },
  ];

  return (
    <div className="portal">
      <nav className="portal-tabs" role="tablist" aria-label={t('recyclerPortal.nav')}>
        {TABS.map((item) => (
          <Link
            key={item.key}
            to={`/recycler?section=${item.key}`}
            role="tab"
            aria-selected={tab === item.key}
            className={`portal-tab ${tab === item.key ? 'portal-tab--active' : ''}`}
            style={{ textDecoration: 'none' }}
          >
            <span aria-hidden="true">{item.icon}</span>
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="portal-body">
        {tab === 'overview' && <RecyclerDashboard />}
        {tab === 'lots' && <IncomingLots />}
        {tab === 'profile' && <RecyclerProfile />}
      </div>
    </div>
  );
}