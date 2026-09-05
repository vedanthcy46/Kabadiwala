/**
 * Earnings Ledger — /collector/earnings
 *
 * API used:
 *  GET /v1/payments/earnings/:collectorId  → summary cards
 *  GET /v1/payments/history/:collectorId   → ledger rows
 *
 * IMPORTANT: /payments/history only returns rows where final_price IS NOT NULL
 * (see payment.service.js). In-flight lots (quoted/matched/handed_over) without
 * a final price are NOT shown here — they appear on the Dashboard.
 * This is a backend limitation documented in PHASE4_FRONTEND.md.
 *
 * Offline: both calls are cache-backed. When serving from cache,
 * a "Showing cached data" notice is displayed.
 */

import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { getEarningsSummary, getPaymentHistory, DEMO_COLLECTOR_ID } from '../api/client';
import { currentCollectorId } from '../services/auth';
import { StatusBadge } from '../components/StatusBadge';
import { PageLoader, SkeletonCard } from '../components/LoadingSpinner';
import { useTranslation } from '../i18n/config.js';
import './Earnings.css';

// ── Formatters ─────────────────────────────────────────────────────────────
function fmt(n) {
  if (n == null) return '—';
  return `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function fmtDate(d, lang) {
  if (!d) return '—';
  const locale = lang === 'hi' ? 'hi-IN' : lang === 'mr' ? 'mr-IN' : 'en-IN';
  return new Date(d).toLocaleString(locale, {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  });
}

// ── Filter helpers ──────────────────────────────────────────────────────────

function applyFilter(rows, filter) {
  if (filter === 'all') return rows;
  return rows.filter((r) => r.payment_status === filter);
}

// ── Component ───────────────────────────────────────────────────────────────
export default function CollectorEarnings() {
  const { t, lang } = useTranslation();
  const FILTER_OPTIONS = [
    { value: 'all',     label: t('earnings.filterAll') },
    { value: 'paid',    label: t('earnings.filterPaid') },
    { value: 'pending', label: t('earnings.filterPending') },
  ];
  const [summary, setSummary] = useState(null);
  const [rows, setRows] = useState([]);
  const [fromCache, setFromCache] = useState(false);
  const [loadingS, setLoadingS] = useState(true);
  const [loadingR, setLoadingR] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');
  const [expandedRow, setExpandedRow] = useState(null);

  const collectorId = currentCollectorId() ?? DEMO_COLLECTOR_ID;

  const load = useCallback(async () => {
    setLoadingS(true);
    setLoadingR(true);
    setError('');

    try {
      const [sumRes, histRes] = await Promise.all([
        getEarningsSummary(collectorId),
        getPaymentHistory(collectorId),
      ]);
      setSummary(sumRes.data);
      setRows(Array.isArray(histRes.data) ? histRes.data : []);
      setFromCache(sumRes.fromCache || histRes.fromCache);
    } catch (err) {
      setError(t('earnings.loadError') + ' ' + (err.message || ''));
    } finally {
      setLoadingS(false);
      setLoadingR(false);
    }
  }, [collectorId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  const filtered = applyFilter(rows, filter);

  return (
    <div className="container">
      {/* ── Header ── */}
      <div className="earnings-header">
        <div>
          <h1 className="section-title">{t('earnings.title')}</h1>
          <p className="section-subtitle">{t('earnings.subtitle')}</p>
        </div>
        <Link to="/collector" className="btn btn-ghost btn-sm">
          {t('common.back')}
        </Link>
      </div>

      {/* ── Offline / cache notice ── */}
      {fromCache && (
        <div className="earnings-cache-notice" role="note">
          
          {t('earnings.cachedNotice')}
        </div>
      )}

      {/* ── Error banner ── */}
      {error && (
        <div className="alert-banner alert-banner--warn" role="alert">
           {error}
          <button className="btn btn-ghost btn-sm" onClick={load} style={{ marginLeft: 'auto' }}>
            {t('common.retry')}
          </button>
        </div>
      )}

      {/* ── Summary cards ── */}
      <section aria-labelledby="summary-heading" className="earnings-summary-section">
        <h2 id="summary-heading" className="sr-only">{t('earnings.title')}</h2>
        {loadingS ? (
          <div className="grid-4">
            {[0, 1, 2, 3].map((i) => <SkeletonCard key={i} />)}
          </div>
        ) : (
          <div className="earnings-cards-grid">
            <div className="earnings-card">
              <div className="earnings-card__icon" aria-hidden="true">₹</div>
              <div className="earnings-card__body">
                <p className="earnings-card__label">{t('earnings.totalEarned')}</p>
                <p className="earnings-card__value">{fmt(summary?.total_earned)}</p>
                <p className="earnings-card__sub">{t('common.allTime')}</p>
              </div>
            </div>

            <div className="earnings-card earnings-card--green">
              <div className="earnings-card__icon" aria-hidden="true"></div>
              <div className="earnings-card__body">
                <p className="earnings-card__label">{t('earnings.paidOut')}</p>
                <p className="earnings-card__value">{fmt(summary?.total_paid)}</p>
                <p className="earnings-card__sub">{summary?.paid_transactions ?? 0} {t('earnings.totalTransactions').toLowerCase()}</p>
              </div>
            </div>

            <div className="earnings-card earnings-card--amber">
              <div className="earnings-card__icon" aria-hidden="true"></div>
              <div className="earnings-card__body">
                <p className="earnings-card__label">{t('earnings.pending')}</p>
                <p className="earnings-card__value">{fmt(summary?.total_pending)}</p>
                <p className="earnings-card__sub">{summary?.pending_transactions ?? 0} {t('common.pendingPayment').toLowerCase()}</p>
              </div>
            </div>

            <div className="earnings-card earnings-card--purple">
              <div className="earnings-card__icon" aria-hidden="true"></div>
              <div className="earnings-card__body">
                <p className="earnings-card__label">{t('earnings.totalTransactions')}</p>
                <p className="earnings-card__value">{summary?.total_transactions ?? '—'}</p>
                <p className="earnings-card__sub">{t('earnings.filteredTotal')}</p>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* ── Ledger ── */}
      <section aria-labelledby="ledger-heading" className="earnings-ledger-section">
        <div className="earnings-ledger-header">
          <h2 id="ledger-heading" className="section-title" style={{ fontSize: 'var(--text-xl)' }}>
            {t('earnings.title')}
          </h2>

          {/* Filter tabs */}
          <div className="earnings-filter-tabs" role="group" aria-label="Filter by payment status">
            {FILTER_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                className={`earnings-filter-btn ${filter === opt.value ? 'earnings-filter-btn--active' : ''}`}
                onClick={() => setFilter(opt.value)}
                aria-pressed={filter === opt.value}
                id={`filter-${opt.value}`}
              >
                {opt.label}
                {opt.value !== 'all' && rows.length > 0 && (
                  <span className="earnings-filter-count">
                    {rows.filter((r) => r.payment_status === opt.value).length}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Note: in-flight lots without final_price are excluded — backend limitation */}
        {!loadingR && rows.length === 0 && (
          <div className="empty-state card">
            
            <p style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-semibold)' }}>
              {t('earnings.noTransactions')}
            </p>
            <p className="text-muted text-sm">
              {t('earnings.noTransactionsDesc')}
            </p>
            <Link to="/collector/create-lot" className="btn btn-primary">
              {t('dashboard.createLot')}
            </Link>
          </div>
        )}

        {!loadingR && rows.length > 0 && filtered.length === 0 && (
          <div className="empty-state card">
            
            <p>{t('earnings.noFilteredResults')}</p>
            <button className="btn btn-ghost btn-sm" onClick={() => setFilter('all')}>
              {t('earnings.filterAll')}
            </button>
          </div>
        )}

        {loadingR ? (
          <PageLoader />
        ) : filtered.length > 0 ? (
          <>
            {/* Desktop: table layout */}
            <div className="ledger-table-wrap hide-mobile" aria-label="Earnings ledger table">
              <table className="ledger-table">
                <thead>
                  <tr>
                    <th scope="col">{t('earnings.table.lot')}</th>
                    <th scope="col">{t('earnings.table.material')}</th>
                    <th scope="col">{t('earnings.table.weight')}</th>
                    <th scope="col">{t('earnings.table.recycler')}</th>
                    <th scope="col">{t('earnings.table.amount')}</th>
                    <th scope="col">{t('earnings.table.status')}</th>
                    <th scope="col">{t('earnings.table.date')}</th>
                    <th scope="col" className="sr-only">{t('earnings.table.view')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => (
                    <tr
                      key={row.lot_id}
                      className="ledger-row"
                      onClick={() => setExpandedRow(expandedRow === row.lot_id ? null : row.lot_id)}
                      aria-expanded={expandedRow === row.lot_id}
                    >
                      <td>
                        <span className="ledger-lot-id font-mono">{row.lot_id}</span>
                      </td>
                      <td>{row.material_category}</td>
                      <td>{row.quantity_weight_kg ?? '—'} {t('common.kg')}</td>
                      <td>{row.recycler_name ?? '—'}</td>
                      <td className="ledger-price-cell">
                        <span className="ledger-price">{fmt(row.final_price)}</span>
                        {row.payment_method && row.payment_status === 'paid' && (
                          <span className="ledger-method">{t(`lotDetail.payMethods.${row.payment_method}`)}</span>
                        )}
                      </td>
                      <td><StatusBadge status={row.payment_status || 'pending'} /></td>
                      <td className="ledger-date">{fmtDate(row.txn_datetime, lang)}</td>
                      <td>
                        <Link
                          to={`/collector/lots/${row.lot_id}`}
                          className="btn btn-ghost btn-sm"
                          onClick={(e) => e.stopPropagation()}
                          aria-label={`View lot ${row.lot_id}`}
                        >
                          {t('common.view')}
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile: card list */}
            <div className="ledger-cards show-mobile-only">
              {filtered.map((row, i) => (
                <div
                  key={row.lot_id}
                  className="ledger-card card"
                  style={{ animationDelay: `${i * 60}ms` }}
                >
                  <div className="ledger-card__top">
                    <div>
                      <p className="ledger-lot-id font-mono">{row.lot_id}</p>
                      <p className="ledger-card__material">{row.material_category}</p>
                    </div>
                    <StatusBadge status={row.payment_status || 'pending'} />
                  </div>

                  <div className="ledger-card__row">
                    <span className="ledger-card__label">{t('earnings.table.weight')}</span>
                    <span>{row.quantity_weight_kg ?? '—'} {t('common.kg')}</span>
                  </div>

                  <div className="ledger-card__row">
                    <span className="ledger-card__label">{t('earnings.table.recycler')}</span>
                    <span>{row.recycler_name ?? '—'}</span>
                  </div>

                  <div className="ledger-card__row">
                    <span className="ledger-card__label">{t('earnings.table.date')}</span>
                    <span>{fmtDate(row.txn_datetime, lang)}</span>
                  </div>

                  <div className="ledger-card__row">
                    <span className="ledger-card__label">{t('earnings.table.amount')}</span>
                    <span className="ledger-price-cell">
                      <span className="ledger-price">{fmt(row.final_price)}</span>
                      {row.payment_method && row.payment_status === 'paid' && (
                        <span className="ledger-method">{t(`lotDetail.payMethods.${row.payment_method}`)}</span>
                      )}
                    </span>
                  </div>

                  <Link
                    to={`/collector/lots/${row.lot_id}`}
                    className="btn btn-outline btn-sm btn-full"
                    style={{ marginTop: 'var(--space-3)' }}
                  >
                    {t('common.view')}
                  </Link>
                </div>
              ))}
            </div>

            {/* Totals footer */}
            <div className="ledger-footer">
              <span className="text-muted text-sm">
                {filtered.length} / {rows.length} {t('earnings.totalTransactions').toLowerCase()}
              </span>
              <span className="ledger-footer__total">
                {t('earnings.filteredTotal')}:{' '}
                <strong>
                  {fmt(filtered.reduce((acc, r) => acc + (Number(r.final_price) || 0), 0))}
                </strong>
              </span>
            </div>
          </>
        ) : null}
      </section>
    </div>
  );
}
