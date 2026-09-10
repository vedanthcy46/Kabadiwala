import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getEarningsSummary, getLotsByCollector, DEMO_COLLECTOR_ID } from '../api/client';
import { currentCollectorId } from '../services/auth';
import { StatCard } from '../components/StatCard';
import { StatusBadge } from '../components/StatusBadge';
import { PageLoader, SkeletonCard } from '../components/LoadingSpinner';
import { useTranslation } from '../i18n/config.js';
import './Dashboard.css';

function fmt(n) {
  if (n == null) return '—';
  return `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function fmtDate(d, lang) {
  if (!d) return '';
  const locale = lang === 'hi' ? 'hi-IN' : lang === 'mr' ? 'mr-IN' : 'en-IN';
  return new Date(d).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function CollectorDashboard() {
  const { t, lang } = useTranslation();
  const [earnings, setEarnings] = useState(null);
  const [lots, setLots] = useState([]);
  const [loadingE, setLoadingE] = useState(true);
  const [loadingL, setLoadingL] = useState(true);
  const [error, setError] = useState('');

  const collectorId = currentCollectorId() ?? DEMO_COLLECTOR_ID;

  useEffect(() => {
    getEarningsSummary(collectorId)
      .then(r => setEarnings(r.data))
      .catch(() => setError(t('dashboard.backendError')))
      .finally(() => setLoadingE(false));

    getLotsByCollector(collectorId)
      .then(r => setLots(Array.isArray(r.data) ? r.data.slice(0, 6) : []))
      .catch(() => {})
      .finally(() => setLoadingL(false));
  }, []); // eslint-disable-line

  return (
    <div className="container">
      {/* Page Header */}
      <div className="dash-header animate-fade-in">
        <div>
          <h1 className="section-title">{t('dashboard.title')}</h1>
          <p className="section-subtitle">{t('dashboard.subtitle')}</p>
        </div>
        <Link to="/collector/create-lot" className="btn btn-accent btn-lg">
          <span aria-hidden="true">+</span>
          {t('dashboard.createNewLot')}
        </Link>
      </div>

      {error && (
        <div className="alert-banner alert-banner--warn animate-fade-in">
           {error}
        </div>
      )}

      {/* Earnings Cards */}
      <section aria-labelledby="earnings-heading">
        <h2 id="earnings-heading" className="sr-only">{t('dashboard.earnings')}</h2>
        <div className="grid-4" style={{ marginBottom: 'var(--space-8)' }}>
          {loadingE ? (
            [0,1,2,3].map(i => <SkeletonCard key={i} />)
          ) : (
            <>
              <StatCard
                icon="₹"
                label={t('dashboard.totalEarned')}
                value={fmt(earnings?.total_earned)}
                sub={t('common.allTime')}
                delay={0}
              />
              <StatCard
                icon=""
                label={t('dashboard.paidOut')}
                value={fmt(earnings?.total_paid)}
                sub={t('common.completed')}
                delay={60}
              />
              <StatCard
                icon=""
                label={t('dashboard.pending')}
                value={fmt(earnings?.total_pending)}
                sub={t('common.pendingPayment')}
                delay={120}
              />
              <StatCard
                icon=""
                label={t('dashboard.totalLots')}
                value={earnings?.total_transactions ?? '—'}
                sub={t('common.createdSoFar')}
                accent
                delay={180}
              />
            </>
          )}
        </div>
      </section>

      {/* Quick Actions */}
      <section className="quick-actions animate-fade-in" aria-labelledby="actions-heading">
        <h2 id="actions-heading" className="section-title" style={{ marginBottom: 'var(--space-4)' }}>
          {t('dashboard.quickActions')}
        </h2>
        <div className="quick-actions__grid">
          <Link to="/collector/create-lot" className="quick-action-card">
            
            <span className="quick-action-card__label">{t('dashboard.createLot')}</span>
            <span className="quick-action-card__desc">{t('dashboard.createLotDesc')}</span>
          </Link>
          <Link to="/collector/prices" className="quick-action-card">
            
            <span className="quick-action-card__label">{t('dashboard.priceBoard')}</span>
            <span className="quick-action-card__desc">{t('dashboard.priceBoardDesc')}</span>
          </Link>
          <Link to="/collector/find-recyclers" className="quick-action-card">
            
            <span className="quick-action-card__label">{t('dashboard.findRecyclers')}</span>
            <span className="quick-action-card__desc">{t('dashboard.findRecyclersDesc')}</span>
          </Link>
          <Link to="/collector/earnings" className="quick-action-card">
            
            <span className="quick-action-card__label">{t('dashboard.earningsLedger')}</span>
            <span className="quick-action-card__desc">{t('dashboard.earningsLedgerDesc')}</span>
          </Link>
          <Link to="/safety" className="quick-action-card">
            
            <span className="quick-action-card__label">{t('dashboard.safetyGuidance')}</span>
            <span className="quick-action-card__desc">{t('dashboard.safetyGuidanceDesc')}</span>
          </Link>
        </div>
      </section>

      {/* Recent Lots */}
      <section className="animate-fade-in" aria-labelledby="recent-lots-heading">
        <div className="flex items-center justify-between" style={{ marginBottom: 'var(--space-4)' }}>
          <h2 id="recent-lots-heading" className="section-title">{t('dashboard.recentLots')}</h2>
        </div>

        {loadingL ? (
          <PageLoader />
        ) : lots.length === 0 ? (
          <div className="empty-state card">
            
            <p style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-semibold)' }}>{t('dashboard.noLots')}</p>
            <p>{t('dashboard.noLotsDesc')}</p>
            <Link to="/collector/create-lot" className="btn btn-primary">
              {t('dashboard.createFirstLot')}
            </Link>
          </div>
        ) : (
          <div className="lots-list">
            {lots.map((lot, i) => (
              <Link
                key={lot.lot_id}
                to={`/collector/lots/${lot.lot_id}`}
                className="lot-row card card-clickable stagger-item"
                style={{ animationDelay: `${i * 60}ms`, textDecoration: 'none', color: 'inherit' }}
                aria-label={`Lot ${lot.lot_id} — ${lot.category}`}
              >
                <div className="lot-row__cat">
                  
                  <div>
                    <p className="lot-row__id">{lot.lot_id}</p>
                    <p className="lot-row__category">{lot.category}</p>
                  </div>
                </div>
                <div className="lot-row__meta hide-mobile">
                  <span>{lot.approx_weight_kg ?? lot.weight_kg ?? '?'} {t('common.kg')}</span>
                  <span>{fmtDate(lot.created_at, lang)}</span>
                </div>
                <div className="lot-row__value">
                  {fmt(lot.estimated_value)}
                </div>
                <StatusBadge status={lot.transaction_status || lot.payment_status || 'quoted'} />
                <span className="hide-mobile" style={{ color: 'var(--color-text-muted)' }}>›</span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
