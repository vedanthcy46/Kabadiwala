/** Admin panel — /admin
 *
 * Restricted-area view for the platform operator:
 *  - Overview (live counts + expiry alerts)
 *  - Recycler verification queue (approve / reject authorization apps)
 *  - Price-source registry (where market data comes from)
 *
 * Backs onto /v1/admin endpoints. Login uses the demo admin code shown on
 * the screen (mock passphrase for the SIH demo).
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  adminLogin, getAdminSummary, getAllRecyclers,
  adminVerifyRecycler, getPriceSources, getAdminLots, getAdminAuditEvents,
  getAiDatasetSummary, getAiDatasetSamples, getAnomalies, getAiDatasetExportUrl,
} from '../api/client';
import { getSession, saveSession, clearSession } from '../services/auth';
import { StatusBadge } from '../components/StatusBadge';
import { PageLoader, LoadingSpinner } from '../components/LoadingSpinner';
import { useTranslation } from '../i18n/config.js';
import './Admin.css';

const TABS = ['overview', 'recyclers', 'lots', 'audit', 'anomalies', 'prices', 'dataset'];
const TAB_FALLBACKS = { lots: 'Lot register', audit: 'Audit trail', anomalies: 'Anomalies', dataset: 'AI Dataset' };

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
}

const TODAY = new Date();
const EXPIRY_WINDOW_DAYS = 60;

export default function Admin() {
  const { t } = useTranslation();

  const session = getSession();
  const [authed, setAuthed] = useState(session?.role === 'admin');

  const [code, setCode] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState('');

  const [tab, setTab] = useState('overview');
  const [summary, setSummary] = useState(null);
  const [recyclers, setRecyclers] = useState([]);
  const [locationFilter, setLocationFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedRecyclerDoc, setSelectedRecyclerDoc] = useState(null);
  const [rejectTargetRecycler, setRejectTargetRecycler] = useState(null);
  const [rejectionReasonInput, setRejectionReasonInput] = useState('');
  const [priceSources, setPriceSources] = useState([]);
  const [lots, setLots] = useState([]);
  const [auditEvents, setAuditEvents] = useState([]);
  const [anomalies, setAnomalies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [verifyBusy, setVerifyBusy] = useState(null);
  const [aiSummary, setAiSummary] = useState(null);
  const [aiSamples, setAiSamples] = useState([]);

  useEffect(() => { setAuthed(getSession()?.role === 'admin'); }, []);

  function flash(msg) {
    setToast(msg);
    setTimeout(() => setToast(''), 4500);
  }

  async function handleLogin() {
    if (!code.trim()) { setLoginError(t('admin.codeRequired')); return; }
    setLoginBusy(true);
    setLoginError('');
    try {
      const res = await adminLogin(code.trim());
      saveSession({ role: 'admin', userId: 'admin', name: res.data.admin.label, token: res.data.token });
      setAuthed(true);
    } catch (err) {
      setLoginError(err.message || t('admin.loginFail'));
    } finally {
      setLoginBusy(false);
    }
  }

  async function loadAll() {
    setLoading(true);
    setError('');
    try {
      const [sumRes, recRes, priceRes, lotsRes, auditRes, aiSumRes, aiSampRes, anomalyRes] = await Promise.all([
        getAdminSummary(),
        getAllRecyclers({ limit: 1000 }),
        getPriceSources(),
        getAdminLots(),
        getAdminAuditEvents(),
        getAiDatasetSummary(),
        getAiDatasetSamples({ limit: 12 }),
        getAnomalies().catch(() => ({ anomalies: [] })),
      ]);
      setSummary(sumRes.data);
      setRecyclers(Array.isArray(recRes.data) ? recRes.data : []);
      setPriceSources(Array.isArray(priceRes.data) ? priceRes.data : []);
      setLots(Array.isArray(lotsRes.data) ? lotsRes.data : []);
      setAuditEvents(Array.isArray(auditRes.data) ? auditRes.data : []);
      setAiSummary(aiSumRes.data);
      setAiSamples(Array.isArray(aiSampRes.data?.samples) ? aiSampRes.data.samples : []);
      setAnomalies(Array.isArray(anomalyRes.anomalies) ? anomalyRes.anomalies : (Array.isArray(anomalyRes.data?.anomalies) ? anomalyRes.data.anomalies : []));
    } catch {
      setError(t('admin.loadError'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (authed) loadAll();
  }, [authed]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleVerify(id, decision, reason) {
    setVerifyBusy(id);
    setError('');
    try {
      await adminVerifyRecycler(id, decision, 'SPCB verification check — ' + new Date().toISOString().slice(0, 10), reason);
      flash(decision === 'authorized' ? t('admin.approved') : t('admin.rejected'));
      setRejectTargetRecycler(null);
      setRejectionReasonInput('');
      loadAll();
    } catch (err) {
      setError(err.message || t('admin.verifyFail'));
    } finally {
      setVerifyBusy(null);
    }
  }

  function handleLogout() {
    clearSession();
    setAuthed(false);
    setCode('');
  }

  async function handleExportCsv(e) {
    if (e) e.preventDefault();
    try {
      const url = getAiDatasetExportUrl();
      const session = getSession();
      const headers = {};
      if (session?.token) {
        headers['Authorization'] = `Bearer ${session.token}`;
      }
      const res = await fetch(url, { headers });
      if (!res.ok) {
        throw new Error(`Export failed (${res.status} ${res.statusText})`);
      }
      const blob = await res.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = 'ai_training_dataset.csv';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      setError(err.message || 'Failed to download dataset CSV');
    }
  }

  const expiring = recyclers.filter((r) => {
    if (!r.authorization_valid_until) return false;
    const until = new Date(r.authorization_valid_until);
    const windowEnd = new Date(TODAY.getTime() + EXPIRY_WINDOW_DAYS * 86400000);
    return (r.authorization_status === 'expiring_soon' || r.authorization_status === 'expired' || (until >= TODAY && until <= windowEnd));
  });

  const q = locationFilter.trim().toLowerCase();
  const filteredRecyclers = recyclers.filter((r) => {
    if (q) {
      const matchLoc = (r.service_area || '').toLowerCase().includes(q) ||
                       (r.facility_location || '').toLowerCase().includes(q) ||
                       (r.name || '').toLowerCase().includes(q) ||
                       (r.authorization_number || '').toLowerCase().includes(q);
      if (!matchLoc) return false;
    }
    if (statusFilter === 'pending') {
      return r.account_status === 'PENDING' || r.authorization_status === 'pending';
    }
    if (statusFilter === 'renewal_pending') {
      return r.authorization_status === 'renewal_pending';
    }
    if (statusFilter === 'expiring') {
      return r.authorization_status === 'expiring_soon' || r.authorization_status === 'expired' || r.account_status === 'SUSPENDED';
    }
    if (statusFilter === 'active') {
      return (r.account_status === 'ACTIVE' || !r.account_status) && (r.authorization_status === 'authorized' || r.authorization_status === 'valid');
    }
    if (statusFilter === 'rejected') {
      return r.account_status === 'REJECTED' || r.authorization_status === 'unauthorized';
    }
    return true;
  });

  // ── Admin login gate ──────────────────────────────────────────────────────
  if (!authed) {
    return (
      <div className="container login-page">
        <div className="login-card card animate-scale-in">
          <Link to="/" className="back-link" style={{ alignSelf: 'flex-start', marginBottom: 'var(--space-2)' }}>
            {t('common.back')}
          </Link>
          <div className="login-card__head">
            <div className="login-card__logo" aria-hidden="true"></div>
            <h1 className="section-title">{t('admin.title')}</h1>
            <p className="section-subtitle">{t('admin.subtitle')}</p>
          </div>

          {loginError && (
            <div className="alert-banner alert-banner--error animate-fade-in" role="alert">
              {loginError}
            </div>
          )}

          <section className="login-panel" aria-labelledby="admin-login-heading">
            <label className="form-label" htmlFor="admin-code">{t('admin.codeLabel')}</label>
            <input
              id="admin-code"
              className="form-input"
              type="password"
              placeholder={t('admin.codePlaceholder')}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleLogin(); }}
            />
            <button
              className="btn btn-primary btn-full"
              onClick={handleLogin}
              disabled={loginBusy}
              aria-busy={loginBusy}
            >
              {loginBusy ? <><LoadingSpinner size="sm" /> {t('common.loading')}…</> : <> {t('admin.enterPanel')}</>}
            </button>
            <p className="login-hint">{t('admin.demoCode', { code: 'KBC-ADMIN-2026' })}</p>
          </section>
        </div>
      </div>
    );
  }

  // ── Dashboard ─────────────────────────────────────────────────────────────
  return (
    <div className="container">
      <div className="animate-fade-in" style={{ marginBottom: 'var(--space-6)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
        <div>
          <h1 className="section-title">{t('admin.title')}</h1>
          <p className="section-subtitle">{t('admin.subtitle')}</p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={handleLogout}>{t('login.logout')}</button>
      </div>

      {/* Tabs */}
      <div className="filter-tabs animate-fade-in" role="tablist" aria-label={t('admin.tabsLabel')}>
        {TABS.map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            className={`filter-tab ${tab === k ? 'filter-tab--active' : ''}`}
            onClick={() => setTab(k)}
          >
            {TAB_FALLBACKS[k] || t(`admin.tab.${k}`)}
          </button>
        ))}
      </div>

      {error && (
        <div className="alert-banner alert-banner--error animate-fade-in" role="alert">
          {error}
        </div>
      )}
      {toast && (
        <div className="alert-banner alert-banner--success animate-fade-in" role="status">
          {toast}
        </div>
      )}

      {loading ? (
        <PageLoader />
      ) : tab === 'overview' ? (
        <div className="admin-overview animate-fade-in">
          <div className="admin-stat-grid">
            <div className="admin-stat card">
              <span className="admin-stat__label">{t('admin.stat.collectors')}</span>
              <span className="admin-stat__value">{summary?.collectors ?? '—'}</span>
            </div>
            <div className="admin-stat card">
              <span className="admin-stat__label">{t('admin.stat.recyclers')}</span>
              <span className="admin-stat__value">{summary?.recyclers ?? '—'}</span>
            </div>
            <div className="admin-stat card admin-stat--alert">
              <span className="admin-stat__label">{t('admin.stat.pending')}</span>
              <span className="admin-stat__value">{summary?.pending_recyclers ?? 0}</span>
            </div>
            <div className="admin-stat card admin-stat--alert">
              <span className="admin-stat__label">{t('admin.stat.expiring')}</span>
              <span className="admin-stat__value">{summary?.expiring_authorizations ?? 0}</span>
            </div>
            <div className="admin-stat card">
              <span className="admin-stat__label">{t('admin.stat.lots')}</span>
              <span className="admin-stat__value">{summary?.lots ?? '—'}</span>
            </div>
            <div className="admin-stat card">
              <span className="admin-stat__label">{t('admin.stat.transactions')}</span>
              <span className="admin-stat__value">{summary?.transactions ?? '—'}</span>
            </div>
            <div className="admin-stat card">
              <span className="admin-stat__label">{t('admin.stat.paid')}</span>
              <span className="admin-stat__value">{summary?.paid_transactions ?? 0}</span>
            </div>
            <div className="admin-stat card">
              <span className="admin-stat__label">{t('admin.stat.openOffers')}</span>
              <span className="admin-stat__value">{summary?.open_offers ?? 0}</span>
            </div>
            <div className="admin-stat card">
              <span className="admin-stat__label">{t('admin.stat.priceSources')}</span>
              <span className="admin-stat__value">{summary?.price_sources ?? '—'}</span>
            </div>
          </div>

          {expiring.length > 0 && (
            <section className="card animate-fade-in" style={{ marginTop: 'var(--space-6)' }}>
              <h2 className="detail-section-title">{t('admin.expiryTitle')}</h2>
              <ul className="quote-list">
                {expiring.map((r) => (
                  <li key={r.id} className="quote-item">
                    <div className="quote-item__main">
                      <span className="quote-item__name">{r.name}</span>
                      <span className="quote-item__status">
                        {t('admin.expiryHint', { date: fmtDate(r.authorization_valid_until) })}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                      <StatusBadge status={r.account_status || 'ACTIVE'} size="md" />
                      <StatusBadge status={r.authorization_status || 'pending'} size="md" />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      ) : tab === 'recyclers' ? (
        <div className="animate-fade-in">
          <p className="quote-section__empty">{t('admin.verifyDesc')}</p>
          
          {/* Status Sub-filter Bar */}
          <div className="filter-tabs" style={{ marginBottom: 'var(--space-3)' }}>
            {[
              { id: 'all', label: 'All Recyclers' },
              { id: 'pending', label: 'Pending Approval' },
              { id: 'renewal_pending', label: 'Renewal Pending' },
              { id: 'expiring', label: 'Expiring / Expired' },
              { id: 'active', label: 'Active Authorized' },
              { id: 'rejected', label: 'Rejected' },
            ].map(st => (
              <button
                key={st.id}
                type="button"
                className={`filter-tab ${statusFilter === st.id ? 'filter-tab--active' : ''}`}
                onClick={() => setStatusFilter(st.id)}
              >
                {st.label}
              </button>
            ))}
          </div>

          <div className="admin-filter-bar">
            <label className="admin-filter-bar__label" htmlFor="admin-location-filter">Filter by location / name / license #:</label>
            <input
              id="admin-location-filter"
              className="admin-filter-bar__input"
              type="search"
              placeholder="e.g. Delhi, SPCB/2026, Peenya…"
              value={locationFilter}
              onChange={(e) => setLocationFilter(e.target.value)}
            />
            <span className="admin-filter-bar__count">{filteredRecyclers.length} of {recyclers.length}</span>
          </div>

          <div className="admin-table-wrap card">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>{t('admin.table.name')}</th>
                  <th>{t('admin.table.location')}</th>
                  <th>{t('admin.table.authNumber')}</th>
                  <th>Valid Until</th>
                  <th>Account Status</th>
                  <th>Authorization</th>
                  <th>{t('admin.table.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {filteredRecyclers.map((r) => (
                  <tr key={r.id} className={r.authorization_status === 'pending' || r.authorization_status === 'renewal_pending' ? 'admin-row--pending' : ''}>
                    <td>
                      <span className="admin-table__name">{r.name}</span>
                      {r.verification_source && (
                        <span className="admin-table__sub">{r.verification_source}</span>
                      )}
                    </td>
                    <td>
                      {r.facility_location || '—'}
                      {r.service_area && (
                        <span className="admin-table__sub">{r.service_area}</span>
                      )}
                    </td>
                    <td className="font-mono">{r.authorization_number || '—'}</td>
                    <td className="font-mono">{fmtDate(r.authorization_valid_until)}</td>
                    <td><StatusBadge status={r.account_status || 'ACTIVE'} size="md" /></td>
                    <td><StatusBadge status={r.authorization_status || 'pending'} size="md" /></td>
                    <td>
                      <div className="quote-item__actions" style={{ gap: '6px' }}>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          title="View Authorization Details & Document"
                          onClick={() => setSelectedRecyclerDoc(r)}
                        >
                          📄 Docs
                        </button>
                        <button
                          type="button"
                          className="btn btn-accent btn-sm"
                          disabled={!!verifyBusy}
                          onClick={() => handleVerify(r.id, 'authorized')}
                          aria-busy={verifyBusy === r.id}
                        >
                          {t('admin.approve')}
                        </button>
                        <button
                          type="button"
                          className="btn btn-outline btn-sm"
                          disabled={!!verifyBusy}
                          onClick={() => {
                            setRejectTargetRecycler(r);
                            setRejectionReasonInput(r.rejection_reason || 'Authorization document or registration is invalid');
                          }}
                        >
                          {t('admin.reject')}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Document & Details Modal */}
          {selectedRecyclerDoc && (
            <div className="modal-backdrop animate-fade-in" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
              <div className="card animate-scale-in" style={{ width: '90%', maxWidth: '560px', background: 'var(--color-bg, #fff)', padding: '24px', borderRadius: '12px' }}>
                <h2 className="section-title" style={{ fontSize: '1.25rem', marginBottom: '12px' }}>
                  📜 Recycler Verification & Document Details
                </h2>
                
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
                  <div>
                    <span className="detail-item__label">Facility Name</span>
                    <p style={{ fontWeight: '600' }}>{selectedRecyclerDoc.name}</p>
                  </div>
                  <div>
                    <span className="detail-item__label">Facility Location</span>
                    <p>{selectedRecyclerDoc.facility_location || '—'}</p>
                  </div>
                  <div>
                    <span className="detail-item__label">SPCB License #</span>
                    <p className="font-mono">{selectedRecyclerDoc.authorization_number || '—'}</p>
                  </div>
                  <div>
                    <span className="detail-item__label">Issue Date</span>
                    <p>{fmtDate(selectedRecyclerDoc.authorization_issue_date)}</p>
                  </div>
                  <div>
                    <span className="detail-item__label">Valid Until (Expiry)</span>
                    <p className="font-mono">{fmtDate(selectedRecyclerDoc.authorization_valid_until)}</p>
                  </div>
                  <div>
                    <span className="detail-item__label">Verification Source</span>
                    <p>{selectedRecyclerDoc.verification_source || 'SPCB Portal'}</p>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
                  <div>
                    <span className="detail-item__label" style={{ display: 'block', marginBottom: '4px' }}>Account Status</span>
                    <StatusBadge status={selectedRecyclerDoc.account_status || 'ACTIVE'} size="md" />
                  </div>
                  <div>
                    <span className="detail-item__label" style={{ display: 'block', marginBottom: '4px' }}>Auth Status</span>
                    <StatusBadge status={selectedRecyclerDoc.authorization_status || 'pending'} size="md" />
                  </div>
                </div>

                {selectedRecyclerDoc.authorization_document_url ? (
                  <div style={{ padding: '12px', background: 'var(--color-bg-alt, #f8fafc)', borderRadius: '8px', marginBottom: '16px' }}>
                    <span className="detail-item__label" style={{ display: 'block', marginBottom: '6px' }}>Submitted Certificate Document</span>
                    <a href={selectedRecyclerDoc.authorization_document_url} target="_blank" rel="noopener noreferrer" className="btn btn-outline btn-sm">
                      📎 Open Document ({selectedRecyclerDoc.authorization_document_url})
                    </a>
                  </div>
                ) : (
                  <div className="alert-banner alert-banner--warn" style={{ fontSize: '0.85rem', marginBottom: '16px' }}>
                    No PDF/Image link was uploaded for this authorization.
                  </div>
                )}

                {selectedRecyclerDoc.rejection_reason && (
                  <div className="alert-banner alert-banner--error" style={{ fontSize: '0.85rem', marginBottom: '16px' }}>
                    <strong>Rejection Reason:</strong> {selectedRecyclerDoc.rejection_reason}
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                  <button type="button" className="btn btn-outline" onClick={() => setSelectedRecyclerDoc(null)}>
                    Close
                  </button>
                  <button
                    type="button"
                    className="btn btn-accent"
                    onClick={() => {
                      const recId = selectedRecyclerDoc.id;
                      setSelectedRecyclerDoc(null);
                      handleVerify(recId, 'authorized');
                    }}
                  >
                    Approve Recycler
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Rejection Reason Modal */}
          {rejectTargetRecycler && (
            <div className="modal-backdrop animate-fade-in" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
              <div className="card animate-scale-in" style={{ width: '90%', maxWidth: '480px', background: 'var(--color-bg, #fff)', padding: '24px', borderRadius: '12px' }}>
                <h2 className="section-title" style={{ fontSize: '1.25rem', marginBottom: '8px' }}>
                  🚫 Reject Recycler Application
                </h2>
                <p className="section-subtitle" style={{ fontSize: '0.9rem', marginBottom: '16px' }}>
                  Rejecting <strong>{rejectTargetRecycler.name}</strong> will set account status to REJECTED and remove them from match results.
                </p>

                <div className="form-group" style={{ marginBottom: '20px' }}>
                  <label className="form-label">Reason for Rejection</label>
                  <textarea
                    className="form-input"
                    rows={3}
                    required
                    placeholder="Enter reason for rejection (e.g. SPCB Certificate Expired / Unmatched License Number)"
                    value={rejectionReasonInput}
                    onChange={(e) => setRejectionReasonInput(e.target.value)}
                  />
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                  <button type="button" className="btn btn-outline" onClick={() => setRejectTargetRecycler(null)} disabled={!!verifyBusy}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline"
                    style={{ borderColor: 'var(--color-destructive, #dc2626)', color: 'var(--color-destructive, #dc2626)' }}
                    disabled={!!verifyBusy || !rejectionReasonInput.trim()}
                    onClick={() => handleVerify(rejectTargetRecycler.id, 'unauthorized', rejectionReasonInput.trim())}
                  >
                    Confirm Rejection
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : tab === 'lots' ? (
        <div className="animate-fade-in">
          <p className="quote-section__empty">Lot register: operational status, evidence count, and payment progress. Records are read-only so original evidence remains intact.</p>
          <div className="admin-table-wrap card">
            <table className="admin-table">
              <thead><tr><th>Lot</th><th>Material</th><th>Participants</th><th>Workflow</th><th>Evidence</th><th>Payment</th></tr></thead>
              <tbody>{lots.map((lot) => (
                <tr key={lot.lot_id}>
                  <td><span className="admin-table__name font-mono">{lot.display_lot_id || lot.lot_id}</span><span className="admin-table__sub">{fmtDate(lot.created_at)}</span></td>
                  <td>{lot.category}<span className="admin-table__sub">{lot.approx_weight_kg} kg</span></td>
                  <td>{lot.collector_name || '—'}<span className="admin-table__sub">{lot.recycler_name || 'Awaiting recycler'}</span></td>
                  <td><StatusBadge status={lot.transaction_status || 'quoted'} size="md" /></td>
                  <td>{lot.image_count} photos · {lot.event_count} events</td>
                  <td><StatusBadge status={lot.payment_status || 'pending'} size="md" />{lot.final_price != null && <span className="admin-table__sub">₹{Number(lot.final_price).toLocaleString('en-IN')}</span>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      ) : tab === 'audit' ? (
        <div className="animate-fade-in">
          <p className="quote-section__empty">Latest immutable traceability events. Use this log to investigate disputes or suspicious transitions.</p>
          <div className="admin-table-wrap card">
            <table className="admin-table">
              <thead><tr><th>Time</th><th>Lot</th><th>Event</th><th>Actor</th><th>Evidence</th></tr></thead>
              <tbody>{auditEvents.map((event) => (
                <tr key={event.id}>
                  <td>{fmtDate(event.occurred_at)}</td>
                  <td className="font-mono">{event.lot_id}</td>
                  <td><span className="admin-table__name">{event.event_type.replace(/_/g, ' ')}</span></td>
                  <td>{event.actor_name}<span className="admin-table__sub">{event.actor_role}</span></td>
                  <td className="admin-event-meta">{Object.keys(event.metadata || {}).length ? JSON.stringify(event.metadata) : '—'}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      ) : tab === 'anomalies' ? (
        <div className="animate-fade-in">
          <p className="quote-section__empty">Statistical outlier detection log: transactions with unusual price-to-weight ratios or suspicious unit pricing deviations.</p>
          {anomalies.length === 0 ? (
            <div className="card" style={{ padding: 'var(--space-6)', textAlign: 'center', color: 'var(--color-text-muted)' }}>
              No pricing anomalies detected across active transactions. All recorded payouts are within normal statistical tolerances.
            </div>
          ) : (
            <div className="admin-table-wrap card">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Date / Time</th>
                    <th>Lot ID</th>
                    <th>Material</th>
                    <th>Weight</th>
                    <th>Final Price</th>
                    <th>Unit Price vs Avg</th>
                    <th>Z-Score</th>
                    <th>Severity</th>
                    <th>Explainable AI (XAI) Root Cause</th>
                  </tr>
                </thead>
                <tbody>
                  {anomalies.map((a) => (
                    <tr key={a.id}>
                      <td>{fmtDate(a.txn_datetime)}</td>
                      <td className="font-mono">{a.lot_id}</td>
                      <td><span className="admin-table__name">{a.material_category}</span></td>
                      <td>{a.quantity_weight_kg} kg</td>
                      <td>₹{Number(a.final_price).toLocaleString('en-IN')}</td>
                      <td className="font-mono">
                        ₹{a.unit_price}/kg
                        <span className="admin-table__sub">
                          {Number(a.sample_count || 0) >= 5 ? `Hist Avg: ₹${a.avg_unit_price}/kg` : `Mkt Bench: ₹${a.avg_unit_price}/kg`}
                        </span>
                      </td>
                      <td className="font-mono" style={{ fontWeight: '600', color: Math.abs(Number(a.z_score)) > 2 ? 'var(--color-error, #dc2626)' : 'inherit' }}>
                        {a.z_score != null ? `${Number(a.z_score) > 0 ? '+' : ''}${a.z_score}σ` : '—'}
                      </td>
                      <td>
                        <span className={`dataset-outcome dataset-outcome--${a.severity === 'high' ? 'dismissed' : 'corrected'}`} style={{ color: a.severity === 'high' ? 'var(--color-error, #dc2626)' : 'var(--color-warning, #b45309)' }}>
                          {a.severity?.toUpperCase()}
                        </span>
                      </td>
                      <td style={{ minWidth: '280px' }}>
                        <div style={{ fontSize: '0.85rem', lineHeight: '1.4' }}>
                          <span style={{ fontWeight: '600', color: 'var(--color-primary)', display: 'block' }}>
                            🤖 {a.anomaly_label || a.anomaly_code || 'AI Flagged'}
                          </span>
                          <span className="text-muted" style={{ display: 'block', marginTop: '2px' }}>
                            {a.ai_explanation || 'Unit price violates statistical or market benchmark tolerances.'}
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : tab === 'dataset' ? (
        <div className="animate-fade-in">
          <p className="quote-section__empty">{t('admin.dataset.desc')}</p>

          <div className="admin-stat-grid">
            <div className="admin-stat card">
              <span className="admin-stat__label">{t('admin.dataset.samples')}</span>
              <span className="admin-stat__value">{aiSummary?.totals?.samples ?? '—'}</span>
            </div>
            <div className="admin-stat card">
              <span className="admin-stat__label">{t('admin.dataset.validated')}</span>
              <span className="admin-stat__value">{aiSummary?.totals?.validated ?? '—'}</span>
            </div>
            <div className="admin-stat card admin-stat--alert">
              <span className="admin-stat__label">{t('admin.dataset.pendingReview')}</span>
              <span className="admin-stat__value">{aiSummary?.totals?.pending_review ?? 0}</span>
            </div>
            <div className="admin-stat card">
              <span className="admin-stat__label">{t('admin.dataset.accuracy')}</span>
              <span className="admin-stat__value">
                {aiSummary?.totals?.accuracy_pct != null ? `${aiSummary.totals.accuracy_pct}%` : '—'}
              </span>
            </div>
          </div>

          {(aiSummary?.categories?.length || 0) > 0 && (
            <div className="admin-table-wrap card" style={{ marginTop: 'var(--space-4)' }}>
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>{t('admin.dataset.category')}</th>
                    <th>{t('admin.dataset.accepted')}</th>
                    <th>{t('admin.dataset.corrected')}</th>
                    <th>{t('admin.dataset.dismissed')}</th>
                    <th>{t('admin.dataset.pending')}</th>
                    <th>{t('admin.dataset.accuracy')}</th>
                  </tr>
                </thead>
                <tbody>
                  {aiSummary.categories.map((c) => (
                    <tr key={c.category}>
                      <td><span className="admin-table__name">{c.category}</span></td>
                      <td>{c.accepted}</td>
                      <td>{c.corrected}</td>
                      <td>{c.dismissed}</td>
                      <td>{c.pending_review}</td>
                      <td>{c.accuracy_pct != null ? `${c.accuracy_pct}%` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {aiSamples.length > 0 && (
            <div className="admin-table-wrap card" style={{ marginTop: 'var(--space-4)' }}>
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>{t('admin.dataset.when')}</th>
                    <th>{t('admin.dataset.lot')}</th>
                    <th>{t('admin.dataset.aiPredicted')}</th>
                    <th>{t('admin.dataset.humanLabel')}</th>
                    <th>{t('admin.dataset.outcome')}</th>
                  </tr>
                </thead>
                <tbody>
                  {aiSamples.map((s) => (
                    <tr key={s.id}>
                      <td>{fmtDate(s.created_at)}</td>
                      <td className="font-mono">{s.lot_id || '—'}</td>
                      <td>{s.ai_predicted_category}<span className="admin-table__sub">{Math.round(Number(s.ai_confidence || 0) * 100)}%</span></td>
                      <td>{s.human_category || s.effective_category || '—'}</td>
                      <td><span className={`dataset-outcome dataset-outcome--${s.outcome || 'pending'}`}>{s.outcome || 'pending'}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <button
            type="button"
            className="btn btn-outline"
            style={{ marginTop: 'var(--space-4)' }}
            onClick={handleExportCsv}
          >
            {t('admin.dataset.exportCsv')}
          </button>
        </div>
      ) : (
        <div className="animate-fade-in">
          <p className="quote-section__empty">{t('admin.pricesDesc')}</p>
          <div className="admin-table-wrap card">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>{t('admin.table.source')}</th>
                  <th>{t('admin.table.type')}</th>
                  <th>{t('admin.table.url')}</th>
                  <th>{t('admin.table.lastCollected')}</th>
                </tr>
              </thead>
              <tbody>
                {priceSources.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <span className="admin-table__name">{s.source_name}</span>
                      <span className="admin-table__sub">{s.description || ''}</span>
                    </td>
                    <td className="admin-table__type">{s.source_type.replace(/_/g, ' ')}</td>
                    <td className="font-mono">
                      {s.source_url ? <a href={s.source_url} target="_blank" rel="noreferrer" style={{ color: 'var(--color-primary)' }}>{s.source_url.replace(/^https?:\/\//, '')}</a> : '—'}
                    </td>
                    <td>{fmtDate(s.last_collected_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
