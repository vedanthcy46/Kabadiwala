import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { getLotsByRecycler, getAvailableLots, quoteLot } from '../api/client';
import { resolveRecyclerId } from '../services/auth';
import { StatusBadge } from '../components/StatusBadge';
import { PageLoader, LoadingSpinner } from '../components/LoadingSpinner';
import { useTranslation } from '../i18n/config.js';
import './IncomingLots.css';

// transaction_status values from DB schema: quoted | matched | handed_over | confirmed
// Plus marketplace statuses on open_offer_status: requested | offered | accepted | rejected | expired
const ALL_FILTER = 'all';

function fmtDate(d, lang) {
  if (!d) return '';
  const locale = lang === 'hi' ? 'hi-IN' : lang === 'mr' ? 'mr-IN' : 'en-IN';
  return new Date(d).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
}

function fmt(n) {
  if (n == null) return null;
  return `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

export default function IncomingLots() {
  const { t } = useTranslation();
  const STATUS_FILTERS = [
    { key: ALL_FILTER,    label: t('incomingLots.filterAll') },
    { key: 'matched',     label: t('status.matched') },
    { key: 'handed_over', label: t('status.handed_over') },
    { key: 'confirmed',   label: t('status.confirmed') },
  ];
  const [lots, setLots] = useState([]);
  // Available pool = collectors' freshly-created lots matching this recycler's
  // materials that have no open offer yet (they would otherwise never appear).
  const [availableLots, setAvailableLots] = useState([]);
  const [filter, setFilter] = useState(ALL_FILTER);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // Quote marketplace state (open offers on lots)
  const [quotePrices, setQuotePrices] = useState({});
  const [quotingLot, setQuotingLot] = useState(null);
  const [quoteMsg, setQuoteMsg] = useState('');
  const recyclerId = resolveRecyclerId();

  const load = useCallback(() => {
    setLoading(true);
    // GET /v1/handover/lots/recycler/:recyclerId returns lots assigned
    // to this recycler (matched / handed_over / confirmed), AND lots where
    // this recycler has an open quote offer (open_offer_id/_price/_status).
    getLotsByRecycler(recyclerId)
      .then(r => {
        setLots(Array.isArray(r.data) ? r.data : []);
      })
      .catch(() => setError(t('incomingLots.loadError')))
      .finally(() => setLoading(false));

    // GET /v1/quotes/available?recycler_id= → open lots matched by material
    getAvailableLots(recyclerId)
      .then(r => setAvailableLots(Array.isArray(r.data) ? r.data : []))
      .catch(() => setAvailableLots([]));
  }, [t, recyclerId]);

  useEffect(() => { load(); }, [load]);

  const openQuoteLots = lots.filter(l => l.open_offer_status && l.open_offer_status !== 'accepted');

  async function handleSubmitQuote(lot) {
    const price = Number(quotePrices[lot.lot_id]);
    if (!price || price <= 0) { setQuoteMsg(t('quotes.validPrice')); return; }
    setQuotingLot(lot.lot_id);
    setQuoteMsg('');
    setError('');
    try {
      // Reuse the open request (existingOfferId) or create one, then set price
      await quoteLot({
        lotId: lot.lot_id,
        recyclerId: lot.recycler_id ?? recyclerId,
        offeredPrice: price,
        existingOfferId: lot.open_offer_id,
      });
      setQuoteMsg(t('quotes.quoteSent'));
      setQuotePrices((q) => ({ ...q, [lot.lot_id]: '' }));
      load();
      setTimeout(() => setQuoteMsg(''), 4500);
    } catch (err) {
      setError(err.message || t('quotes.quoteSendFail'));
    } finally {
      setQuotingLot(null);
    }
  }

  // Filter by transaction_status (the real backend enum field)
  const filtered = filter === ALL_FILTER
    ? lots
    : lots.filter(l => l.transaction_status === filter);

  function countFor(key) {
    if (key === ALL_FILTER) return lots.length;
    return lots.filter(l => l.transaction_status === key).length;
  }

  return (
    <div className="container">
      <div className="animate-fade-in" style={{ marginBottom: 'var(--space-6)' }}>
        <Link to="/recycler" className="back-link">{t('common.back')}</Link>
        <h1 className="section-title" style={{ marginTop: 'var(--space-3)' }}>{t('incomingLots.title')}</h1>
        <p className="section-subtitle">{t('incomingLots.subtitle')}</p>
      </div>

      {/* Filter Tabs — keyed on actual transaction_status values */}
      <div className="filter-tabs animate-fade-in" role="tablist" aria-label="Filter by transaction status">
        {STATUS_FILTERS.map(f => (
          <button
            key={f.key}
            role="tab"
            aria-selected={filter === f.key}
            className={`filter-tab ${filter === f.key ? 'filter-tab--active' : ''}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
            <span className="filter-tab__count">{countFor(f.key)}</span>
          </button>
        ))}
      </div>

      {error && (
        <div className="alert-banner alert-banner--warn animate-fade-in" role="alert">
           {error}
          <button
            className="btn btn-ghost btn-sm"
            onClick={load}
            style={{ marginLeft: 'auto' }}
          >
            Retry
          </button>
        </div>
      )}

      {quoteMsg && (
        <div className="alert-banner alert-banner--success animate-fade-in" role="status">
          {quoteMsg}
        </div>
      )}

      {!loading && openQuoteLots.length > 0 && (
        <section className="card quote-section animate-fade-in" aria-labelledby="quote-req-heading">
          <h2 id="quote-req-heading" className="detail-section-title">{t('quotes.recyclerRequests')}</h2>
          <p className="quote-section__empty">{t('quotes.recyclerRequestsDesc')}</p>
          <ul className="quote-list">
            {openQuoteLots.map((lot) => (
              <li key={lot.lot_id} className="quote-item">
                <div className="quote-item__main">
                  <Link to={`/recycler/lots/${lot.lot_id}`} className="quote-item__name" style={{ color: 'var(--color-primary)' }}>
                    {lot.lot_id} · {lot.category}
                  </Link>
                  <div className="quote-item__status">
                    {t('quotes.weightValue', { weight: lot.approx_weight_kg ?? '—', value: fmt(lot.estimated_value) })}
                  </div>
                </div>

                {lot.open_offer_status === 'offered' ? (
                  <div className="quote-item__actions">
                    <strong>{fmt(lot.open_offer_price)}</strong>
                    <StatusBadge status="offered" size="md" />
                    <button className="btn btn-ghost btn-sm" onClick={() => setQuotePrices((q) => ({ ...q, [lot.lot_id]: String(lot.open_offer_price) }))}>
                      {t('common.edit')}
                    </button>
                  </div>
                ) : (
                  <div className="quote-item__actions">
                    <div className="pay-price-input" style={{ width: 'auto' }}>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        className="form-input"
                        placeholder={t('quotes.pricePlaceholder')}
                        value={quotePrices[lot.lot_id] || ''}
                        onChange={(e) => setQuotePrices((q) => ({ ...q, [lot.lot_id]: e.target.value }))}
                        aria-label={`${t('quotes.submitQuote')} ${lot.lot_id}`}
                      />
                      <span className="weight-unit">₹</span>
                    </div>
                    <button
                      className="btn btn-accent btn-sm"
                      onClick={() => handleSubmitQuote(lot)}
                      disabled={quotingLot === lot.lot_id}
                      aria-busy={quotingLot === lot.lot_id}
                    >
                      {quotingLot === lot.lot_id
                        ? <><LoadingSpinner size="sm" /> {t('common.loading')}…</>
                        : <> {t('quotes.submitQuote')}</>}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {!loading && availableLots.length > 0 && (
        <section className="card quote-section animate-fade-in" aria-labelledby="avail-heading">
          <h2 id="avail-heading" className="detail-section-title">{t('incomingLots.availableTitle')}</h2>
          <p className="quote-section__empty">{t('incomingLots.availableDesc')}</p>
          <ul className="quote-list">
            {availableLots.map((lot) => (
              <li key={lot.lot_id} className="quote-item">
                <div className="quote-item__main">
                  <Link to={`/recycler/lots/${lot.lot_id}`} className="quote-item__name" style={{ color: 'var(--color-primary)' }}>
                    {lot.lot_id} · {lot.category}
                  </Link>
                  <div className="quote-item__status">
                    {t('quotes.weightValue', { weight: lot.approx_weight_kg ?? '—', value: fmt(lot.market_estimate) })}
                    {lot.collection_location ? ` · ${lot.collection_location}` : ''}
                  </div>
                </div>
                <div className="quote-item__actions">
                  <div className="pay-price-input" style={{ width: 'auto' }}>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      className="form-input"
                      placeholder={t('quotes.pricePlaceholder')}
                      value={quotePrices[lot.lot_id] || ''}
                      onChange={(e) => setQuotePrices((q) => ({ ...q, [lot.lot_id]: e.target.value }))}
                      aria-label={`${t('quotes.submitQuote')} ${lot.lot_id}`}
                    />
                    <span className="weight-unit">₹</span>
                  </div>
                  <button
                    className="btn btn-accent btn-sm"
                    onClick={() => handleSubmitQuote(lot)}
                    disabled={quotingLot === lot.lot_id}
                    aria-busy={quotingLot === lot.lot_id}
                  >
                    {quotingLot === lot.lot_id
                      ? <><LoadingSpinner size="sm" /> {t('common.loading')}…</>
                      : <> {t('quotes.submitQuote')}</>}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {loading ? (
        <PageLoader />
      ) : filtered.length === 0 ? (
        <div className="empty-state card">
          
          <p style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-semibold)' }}>
            {lots.length === 0 ? t('incomingLots.noLots') : t('incomingLots.noFilteredLots')}
          </p>
          <p>
            {lots.length === 0
              ? t('incomingLots.noLotsDesc')
              : t('incomingLots.noFilteredLotsDesc')}
          </p>
        </div>
      ) : (
        <div className="lots-grid">
          {filtered.map((lot, i) => (
            <Link
              key={lot.lot_id}
              to={`/recycler/lots/${lot.lot_id}`}
              className="lot-card card card-clickable stagger-item"
              style={{ animationDelay: `${i * 50}ms`, textDecoration: 'none', color: 'inherit' }}
              aria-label={`Lot ${lot.lot_id} — ${lot.category}`}
            >
              <div className="lot-card__header">
                <div className="lot-card__icon" aria-hidden="true"></div>
                <div className="lot-card__meta">
                  {/* Use transaction_status — the meaningful recycler-facing status */}
                  <StatusBadge status={lot.transaction_status || 'matched'} />
                </div>
              </div>
              <p className="lot-card__id">{lot.lot_id}</p>
              <p className="lot-card__category">{lot.category}</p>
              <div className="lot-card__details">
                <div className="lot-card__detail">
                  
                  <span>{lot.approx_weight_kg ?? '?'} kg</span>
                </div>
                {lot.recycler_name && (
                  <div className="lot-card__detail">
                    
                    <span>{lot.recycler_name}</span>
                  </div>
                )}
                <div className="lot-card__detail">
                  
                  <span>{fmtDate(lot.created_at)}</span>
                </div>
              </div>
              {fmt(lot.estimated_value) && (
                <div className="lot-card__value">
                  {fmt(lot.estimated_value)}
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', fontWeight: 'normal' }}>
                    {' '}est.
                  </span>
                </div>
              )}
              <div className="lot-card__arrow" aria-hidden="true">›</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
