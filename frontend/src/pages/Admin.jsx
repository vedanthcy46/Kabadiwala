/** Admin panel — /admin
 *
 * Restricted-area view for the platform operator:
 *  - Overview (live counts + expiry alerts + analytics charts)
 *  - Recycler verification queue (approve / reject authorization apps)
 *  - Price-source registry (where market data comes from)
 *
 * Backs onto /v1/admin endpoints. Login uses the demo admin code shown on
 * the screen (mock passphrase for the SIH demo).
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Chart as ChartJS,
  ArcElement, BarElement, LineElement, PointElement,
  CategoryScale, LinearScale,
  Tooltip, Legend, Filler,
} from 'chart.js';
import { Doughnut, Bar } from 'react-chartjs-2';
import {
  adminLogin, getAdminSummary, getAllRecyclers,
  adminVerifyRecycler, getPriceSources, getAdminLots, getAdminAuditEvents,
  getAiDatasetSummary, getAiDatasetSamples, getAnomalies, getAiDatasetExportUrl, updateAiFeedback,
  getAiModel, retrainAiModel,
  getAdminAnalytics, getAdminHeatmap, createPriceSource, updatePriceSource, deletePriceSource,
} from '../api/client';
import AdminHeatmap from '../admin/AdminHeatmap';
import { getSession, saveSession, clearSession } from '../services/auth';
import { StatusBadge } from '../components/StatusBadge';
import { PageLoader, LoadingSpinner } from '../components/LoadingSpinner';
import { useTranslation } from '../i18n/config.js';
import './Admin.css';

ChartJS.register(
  ArcElement, BarElement, LineElement, PointElement,
  CategoryScale, LinearScale,
  Tooltip, Legend, Filler,
);

const TABS = ['overview', 'recyclers', 'lots', 'audit', 'anomalies', 'prices', 'dataset'];
const TAB_FALLBACKS = { lots: 'Lot register', audit: 'Audit trail', anomalies: 'Anomalies', dataset: 'AI Dataset' };

// ── Chart colour palette (matches design tokens) ─────────────────────────────
const CATEGORY_COLORS = [
  '#7C3AED', // purple  — PCBs
  '#16A34A', // green   — Batteries
  '#2563EB', // blue    — CRTs
  '#D97706', // amber   — LCD panels
  '#DB2777', // pink    — Cables
  '#0891B2', // cyan    — Motors / Magnets
  '#65A30D', // lime    — Mixed Plastics
  '#9333EA', // violet  — other
];

const AUTH_COLORS = {
  authorized:   '#16A34A',
  pending:      '#D97706',
  unauthorized: '#DC2626',
};

const CHART_FONT = { family: 'Inter, sans-serif', size: 12 };

const DOUGHNUT_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  cutout: '65%',
  plugins: {
    legend: { position: 'right', labels: { font: CHART_FONT, boxWidth: 12, padding: 14 } },
    tooltip: {
      callbacks: {
        label: (ctx) => ` ${ctx.label}: ${Number(ctx.raw).toLocaleString('en-IN')} kg`,
      },
    },
  },
};

const DOUGHNUT_AUTH_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  cutout: '65%',
  plugins: {
    legend: { position: 'right', labels: { font: CHART_FONT, boxWidth: 12, padding: 14 } },
    tooltip: {
      callbacks: {
        label: (ctx) => ` ${ctx.label}: ${ctx.raw} recyclers`,
      },
    },
  },
};

const BAR_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: 'index', intersect: false },
  plugins: {
    legend: { position: 'top', labels: { font: CHART_FONT, boxWidth: 10, padding: 12 } },
    tooltip: {
      callbacks: {
        label: (ctx) => {
          if (ctx.dataset.yAxisID === 'y1') {
            return ` GMV: ₹${Number(ctx.raw).toLocaleString('en-IN')}`;
          }
          return ` Transactions: ${ctx.raw}`;
        },
      },
    },
  },
  scales: {
    x: { grid: { display: false }, ticks: { font: { ...CHART_FONT, size: 10 }, maxTicksLimit: 10 } },
    y: {
      type: 'linear',
      position: 'left',
      title: { display: true, text: 'Transactions', font: CHART_FONT },
      grid: { color: 'rgba(124,58,237,0.08)' },
      ticks: { font: CHART_FONT },
    },
    y1: {
      type: 'linear',
      position: 'right',
      title: { display: true, text: 'GMV (₹)', font: CHART_FONT },
      grid: { drawOnChartArea: false },
      ticks: {
        font: CHART_FONT,
        callback: (v) => `₹${Number(v).toLocaleString('en-IN')}`,
      },
    },
  },
};

// Helper — short date label for chart X axis
function shortDate(str) {
  if (!str) return '';
  const d = new Date(str);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

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
  const [showSourceModal, setShowSourceModal] = useState(false);
  const [editingSource, setEditingSource] = useState(null);
  const [sourceForm, setSourceForm] = useState({ source_name: '', source_type: 'MARKET REFERENCE', source_url: '', description: '' });
  const [sourceBusy, setSourceBusy] = useState(false);
  const [lots, setLots] = useState([]);
  const [auditEvents, setAuditEvents] = useState([]);
  const [anomalies, setAnomalies] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [heatmapData, setHeatmapData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [verifyBusy, setVerifyBusy] = useState(null);
  const [aiSummary, setAiSummary] = useState(null);
  const [aiSamples, setAiSamples] = useState([]);
  const [aiOutcomeFilter, setAiOutcomeFilter] = useState('all');
  const [aiCategoryFilter, setAiCategoryFilter] = useState('all');
  const [inspectSample, setInspectSample] = useState(null);
  const [correctionSample, setCorrectionSample] = useState(null);
  const [correctingCat, setCorrectingCat] = useState('');
  const [correctionReasonInput, setCorrectionReasonInput] = useState('');
  const [aiActionBusy, setAiActionBusy] = useState(null);
  const [aiModel, setAiModel] = useState(null);
  const [retrainingBusy, setRetrainingBusy] = useState(false);

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
      const [sumRes, recRes, priceRes, lotsRes, auditRes, aiSumRes, aiSampRes, anomalyRes, analyticsRes, heatRes, aiModelRes] = await Promise.all([
        getAdminSummary(),
        getAllRecyclers({ limit: 1000 }),
        getPriceSources(),
        getAdminLots(),
        getAdminAuditEvents(),
        getAiDatasetSummary(),
        getAiDatasetSamples({ limit: 100 }),
        getAnomalies().catch(() => ({ anomalies: [] })),
        getAdminAnalytics().catch(() => ({ data: null })),
        getAdminHeatmap().catch(() => ({ data: null })),
        getAiModel().catch(() => ({ data: null })),
      ]);
      setSummary(sumRes.data);
      setRecyclers(Array.isArray(recRes.data) ? recRes.data : []);
      setPriceSources(Array.isArray(priceRes.data) ? priceRes.data : []);
      setLots(Array.isArray(lotsRes.data) ? lotsRes.data : []);
      setAuditEvents(Array.isArray(auditRes.data) ? auditRes.data : []);
      setAiSummary(aiSumRes.data);
      setAiSamples(Array.isArray(aiSampRes.data?.samples) ? aiSampRes.data.samples : []);
      setAnomalies(Array.isArray(anomalyRes.anomalies) ? anomalyRes.anomalies : (Array.isArray(anomalyRes.data?.anomalies) ? anomalyRes.data.anomalies : []));
      setAnalytics(analyticsRes.data ?? null);
      setHeatmapData(heatRes.data ?? null);
      setAiModel(aiModelRes?.data ?? null);
    } catch {
      setError(t('admin.loadError'));
    } finally {
      setLoading(false);
    }
  }

  async function handleDatasetAction(sampleId, outcome, humanCategory = null, reason = null) {
    setAiActionBusy(sampleId);
    setError('');
    try {
      await updateAiFeedback(sampleId, {
        outcome,
        human_category: humanCategory,
        correction_reason: reason,
        reviewed_by: 'Admin Governance',
      });
      flash(
        outcome === 'accepted' ? 'Sample accepted & validated into training dataset' :
        outcome === 'corrected' ? 'Sample correction submitted' :
        outcome === 'rejected' ? 'Sample rejected from training dataset' :
        'Sample status updated'
      );
      setCorrectionSample(null);
      setInspectSample(null);
      setCorrectionReasonInput('');
      const [aiSumRes, aiSampRes, aiModRes] = await Promise.all([
        getAiDatasetSummary(),
        getAiDatasetSamples({ limit: 100 }),
        getAiModel().catch(() => ({ data: null })),
      ]);
      setAiSummary(aiSumRes.data);
      setAiSamples(Array.isArray(aiSampRes.data?.samples) ? aiSampRes.data.samples : []);
      if (aiModRes?.data) setAiModel(aiModRes.data);
    } catch (err) {
      setError(err.message || 'Failed to update sample status');
    } finally {
      setAiActionBusy(null);
    }
  }

  async function handleRetrainAiModel() {
    setRetrainingBusy(true);
    setError('');
    try {
      const res = await retrainAiModel();
      setAiModel(res.data);
      flash(res.message || 'Continuous AI model retrained successfully!');
      const aiSumRes = await getAiDatasetSummary();
      setAiSummary(aiSumRes.data);
    } catch (err) {
      setError(err.message || 'Failed to retrain model');
    } finally {
      setRetrainingBusy(false);
    }
  }

  function normalizeCategoryOption(cat) {
    if (!cat) return 'PCB';
    const raw = String(cat).trim();
    const map = {
      'battery': 'Battery',
      'batteries': 'Battery',
      'pcb': 'PCB',
      'pcbs': 'PCB',
      'crt': 'CRT',
      'monitors': 'CRT',
      'lcd': 'LCD',
      'lcds': 'LCD',
      'cables': 'Cables',
      'cable': 'Cables',
      'motors': 'Motors',
      'motor': 'Motors',
      'plastics': 'Plastics',
      'plastic': 'Plastics',
      'other': 'Other',
    };
    return map[raw.toLowerCase()] || raw;
  }

  function openCorrectionModal(sample) {
    setCorrectionSample(sample);
    const cat = sample.human_category || sample.effective_category || sample.ai_predicted_category || 'PCB';
    setCorrectingCat(normalizeCategoryOption(cat));
    setCorrectionReasonInput(sample.correction_reason || '');
    window.scrollTo({ top: 100, behavior: 'smooth' });
  }

  function openInspectModal(sample) {
    setInspectSample(sample);
    window.scrollTo({ top: 100, behavior: 'smooth' });
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

  const filteredAiSamples = aiSamples.filter((s) => {
    if (aiOutcomeFilter !== 'all' && (s.outcome || 'pending') !== aiOutcomeFilter) return false;
    if (aiCategoryFilter !== 'all' && s.ai_predicted_category !== aiCategoryFilter && s.human_category !== aiCategoryFilter) return false;
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

  // ── Price Sources CRUD ───────────────────────────────────────────────────
  async function handleSavePriceSource(e) {
    e.preventDefault();
    setSourceBusy(true);
    try {
      if (editingSource) {
        await updatePriceSource(editingSource.id, sourceForm);
        flash('Price source updated.');
      } else {
        await createPriceSource(sourceForm);
        flash('Price source created.');
      }
      setShowSourceModal(false);
      setEditingSource(null);
      // Refresh list
      const res = await getPriceSources();
      setPriceSources(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      flash('Error saving source: ' + err.message);
    } finally {
      setSourceBusy(false);
    }
  }

  async function handleDeletePriceSource(id) {
    if (!window.confirm('Delete this price source?')) return;
    try {
      await deletePriceSource(id);
      flash('Price source deleted.');
      setPriceSources(prev => prev.filter(s => s.id !== id));
    } catch (err) {
      flash('Error deleting source: ' + err.message);
    }
  }

  function openNewSourceModal() {
    setEditingSource(null);
    setSourceForm({ source_name: '', source_type: 'MARKET REFERENCE', source_url: '', description: '' });
    setShowSourceModal(true);
  }

  function openEditSourceModal(s) {
    setEditingSource(s);
    setSourceForm({ source_name: s.source_name, source_type: s.source_type, source_url: s.source_url || '', description: s.description || '' });
    setShowSourceModal(true);
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
          {/* KPI stat cards */}
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

          {/* ── ANALYTICS CHARTS ──────────────────────────────────────── */}
          <div className="admin-charts-row">

            {/* Chart 1: Material Volume by Category (Donut) */}
            <section className="admin-chart-card card animate-fade-in" aria-label="Material volume by category">
              <div className="admin-chart-header">
                <div>
                  <h2 className="admin-chart-title">Material Volume by Category</h2>
                  <p className="admin-chart-sub">Total kg collected across all 7 PS-mandated material streams</p>
                </div>
                {analytics?.materialMix && (
                  <span className="admin-chart-badge">
                    {analytics.materialMix.reduce((s, r) => s + Number(r.total_weight_kg || 0), 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })} kg total
                  </span>
                )}
              </div>
              <div className="admin-chart-canvas-wrap" style={{ height: 220 }}>
                {analytics?.materialMix?.length > 0 ? (
                  <Doughnut
                    data={{
                      labels: analytics.materialMix.map((r) => r.category),
                      datasets: [{
                        data: analytics.materialMix.map((r) => Number(r.total_weight_kg || 0)),
                        backgroundColor: CATEGORY_COLORS.slice(0, analytics.materialMix.length),
                        borderColor: '#fff',
                        borderWidth: 2,
                        hoverOffset: 6,
                      }],
                    }}
                    options={DOUGHNUT_OPTS}
                  />
                ) : (
                  <div className="admin-chart-empty">No material lots created yet — data will appear as collectors submit lots.</div>
                )}
              </div>
              {analytics?.materialMix?.length > 0 && (
                <div className="admin-chart-legend-pills">
                  {analytics.materialMix.map((r, i) => (
                    <span key={r.category} className="admin-legend-pill">
                      <span className="admin-legend-dot" style={{ background: CATEGORY_COLORS[i % CATEGORY_COLORS.length] }} />
                      {r.category}
                      <strong>{r.lot_count} lots</strong>
                    </span>
                  ))}
                </div>
              )}
            </section>

            {/* Chart 3: Recycler Authorization Status (Donut) */}
            <section className="admin-chart-card card animate-fade-in" aria-label="Recycler authorization breakdown">
              <div className="admin-chart-header">
                <div>
                  <h2 className="admin-chart-title">Recycler Network Status</h2>
                  <p className="admin-chart-sub">SPCB/CPCB authorization breakdown across registered facilities</p>
                </div>
                {analytics?.recyclerStatus && (
                  <span className="admin-chart-badge" style={{ background: 'var(--color-success-light)', color: 'var(--color-success)' }}>
                    {(analytics.recyclerStatus.find(r => r.status === 'authorized')?.count ?? 0)} authorized
                  </span>
                )}
              </div>
              <div className="admin-chart-canvas-wrap" style={{ height: 220 }}>
                {analytics?.recyclerStatus?.length > 0 ? (
                  <Doughnut
                    data={{
                      labels: analytics.recyclerStatus.map((r) => r.status.charAt(0).toUpperCase() + r.status.slice(1)),
                      datasets: [{
                        data: analytics.recyclerStatus.map((r) => Number(r.count)),
                        backgroundColor: analytics.recyclerStatus.map((r) => AUTH_COLORS[r.status] ?? '#94A3B8'),
                        borderColor: '#fff',
                        borderWidth: 2,
                        hoverOffset: 6,
                      }],
                    }}
                    options={DOUGHNUT_AUTH_OPTS}
                  />
                ) : (
                  <div className="admin-chart-empty">No recyclers registered yet.</div>
                )}
              </div>
              {analytics?.recyclerStatus?.length > 0 && (
                <div className="admin-chart-legend-pills">
                  {analytics.recyclerStatus.map((r) => (
                    <span key={r.status} className="admin-legend-pill">
                      <span className="admin-legend-dot" style={{ background: AUTH_COLORS[r.status] ?? '#94A3B8' }} />
                      {r.status.charAt(0).toUpperCase() + r.status.slice(1)}
                      <strong>{r.count}</strong>
                    </span>
                  ))}
                </div>
              )}
            </section>
          </div>

          {/* Chart 2: Transaction Velocity + GMV Revenue Trend (Dual-Axis Bar+Line) */}
          <section className="admin-chart-card admin-chart-card--wide card animate-fade-in" style={{ marginTop: 'var(--space-4)' }} aria-label="Transaction velocity and GMV trend">
            <div className="admin-chart-header">
              <div>
                <h2 className="admin-chart-title">Transaction Velocity &amp; Revenue Trend (Last 30 Days)</h2>
                <p className="admin-chart-sub">Daily lot handovers (bars, left axis) alongside total platform GMV in ₹ (line, right axis)</p>
              </div>
              {analytics?.revenueTrends?.length > 0 && (
                <div className="admin-chart-badges-row">
                  <span className="admin-chart-badge">
                    ₹{analytics.revenueTrends.reduce((s, r) => s + Number(r.gmv || 0), 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })} total GMV
                  </span>
                  <span className="admin-chart-badge" style={{ background: 'var(--color-accent-light)', color: 'var(--color-accent)' }}>
                    {analytics.revenueTrends.reduce((s, r) => s + Number(r.txn_count || 0), 0)} transactions
                  </span>
                </div>
              )}
            </div>
            <div className="admin-chart-canvas-wrap" style={{ height: 280 }}>
              {analytics?.revenueTrends?.length > 0 ? (
                <Bar
                  data={{
                    labels: analytics.revenueTrends.map((r) => shortDate(r.date)),
                    datasets: [
                      {
                        type: 'bar',
                        label: 'Transactions',
                        data: analytics.revenueTrends.map((r) => Number(r.txn_count)),
                        backgroundColor: 'rgba(124, 58, 237, 0.22)',
                        borderColor: '#7C3AED',
                        borderWidth: 1.5,
                        borderRadius: 4,
                        yAxisID: 'y',
                        order: 2,
                      },
                      {
                        type: 'line',
                        label: 'GMV (₹)',
                        data: analytics.revenueTrends.map((r) => Number(r.gmv)),
                        borderColor: '#16A34A',
                        backgroundColor: 'rgba(22, 163, 74, 0.08)',
                        borderWidth: 2.5,
                        pointRadius: 4,
                        pointBackgroundColor: '#16A34A',
                        tension: 0.4,
                        fill: true,
                        yAxisID: 'y1',
                        order: 1,
                      },
                    ],
                  }}
                  options={BAR_OPTS}
                />
              ) : (
                <div className="admin-chart-empty">No transactions in the last 30 days — chart will populate as handovers are completed.</div>
              )}
            </div>
            {/* Payment Method Split */}
            {analytics?.revenueTrends?.length > 0 && (() => {
              const totalGmv  = analytics.revenueTrends.reduce((s, r) => s + Number(r.gmv || 0), 0);
              const cashGmv   = analytics.revenueTrends.reduce((s, r) => s + Number(r.cash_gmv || 0), 0);
              const upiGmv    = analytics.revenueTrends.reduce((s, r) => s + Number(r.upi_gmv || 0), 0);
              const bankGmv   = analytics.revenueTrends.reduce((s, r) => s + Number(r.bank_gmv || 0), 0);
              const pct = (v) => totalGmv > 0 ? Math.round((v / totalGmv) * 100) : 0;
              return (
                <div className="admin-payment-split">
                  <span className="admin-payment-split__label">Payment method split:</span>
                  <div className="admin-payment-split__bar">
                    {cashGmv > 0  && <div className="admin-payment-split__seg admin-payment-split__seg--cash"  style={{ flex: cashGmv  }} title={`Cash ₹${cashGmv.toLocaleString('en-IN')}`} />}
                    {upiGmv > 0   && <div className="admin-payment-split__seg admin-payment-split__seg--upi"   style={{ flex: upiGmv   }} title={`UPI ₹${upiGmv.toLocaleString('en-IN')}`} />}
                    {bankGmv > 0  && <div className="admin-payment-split__seg admin-payment-split__seg--bank"  style={{ flex: bankGmv  }} title={`Bank ₹${bankGmv.toLocaleString('en-IN')}`} />}
                    {(cashGmv + upiGmv + bankGmv) === 0 && <div style={{ flex: 1, background: 'var(--color-muted)', borderRadius: 4 }} />}
                  </div>
                  <div className="admin-payment-split__chips">
                    <span className="admin-payment-chip admin-payment-chip--cash">Cash {pct(cashGmv)}%</span>
                    <span className="admin-payment-chip admin-payment-chip--upi">UPI {pct(upiGmv)}%</span>
                    <span className="admin-payment-chip admin-payment-chip--bank">Bank {pct(bankGmv)}%</span>
                  </div>
                </div>
              );
            })()}
          </section>

          {/* ── LOCATION HEATMAP ──────────────────────────────────────── */}
          <AdminHeatmap heatmapData={heatmapData} loading={loading} />

          {/* Expiring authorizations alert list */}
          {expiring.length > 0 && (
            <section className="card animate-fade-in" style={{ marginTop: 'var(--space-4)' }}>
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: '700' }}>🤖 AI Dataset Validation Workspace</h3>
              <p className="text-muted" style={{ margin: '4px 0 0 0', fontSize: '0.9rem' }}>
                Human-in-the-loop validation workspace for e-waste image classification and retraining datasets.
              </p>
            </div>
            <button
              type="button"
              className="btn btn-outline"
              onClick={handleExportCsv}
            >
              📥 {t('admin.dataset.exportCsv')}
            </button>
          </div>

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

          {/* Continuous-Learning Live Model Card */}
          <div className="card" style={{ marginTop: 'var(--space-4)', padding: 'var(--space-4)', background: 'linear-gradient(135deg, rgba(37,99,235,0.05), rgba(124,58,237,0.06))', border: '1px solid rgba(37,99,235,0.25)', borderRadius: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '1.2rem' }}>⚡</span>
                  <strong style={{ fontSize: '1.05rem', color: 'var(--color-text)' }}>
                    Continuous-Learning Model: <span style={{ color: 'var(--color-primary)' }}>{aiModel?.version || 'v1.6'}</span>
                  </strong>
                  <span className="p2-ai-pill p2-ai-pill--high" style={{ fontSize: '0.75rem', padding: '2px 8px' }}>
                    Live Accuracy: {aiModel?.accuracy_pct ?? aiSummary?.totals?.accuracy_pct ?? 75}%
                  </span>
                  <span className="text-muted" style={{ fontSize: '0.8rem' }}>
                    ({aiModel?.totalSamples ?? aiSummary?.totals?.validated ?? 0} validated samples)
                  </span>
                </div>
                <p className="text-muted" style={{ margin: '4px 0 0 0', fontSize: '0.85rem' }}>
                  Empirical centroids and Laplace-smoothed priors retrain in real-time as collectors and admins validate materials.
                  Last trained: {aiModel?.trainedAt ? new Date(aiModel.trainedAt).toLocaleTimeString() : 'Active'}
                </p>
              </div>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleRetrainAiModel}
                disabled={retrainingBusy}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 14px', fontSize: '0.85rem' }}
                title="Force full retraining of centroids and accuracy priors across all feedback rows"
              >
                {retrainingBusy ? <LoadingSpinner size="sm" /> : '⚡ Retrain Model Now'}
              </button>
            </div>
            {aiModel?.accuracyPriors && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: 'var(--space-3)', paddingTop: 'var(--space-3)', borderTop: '1px solid rgba(0,0,0,0.08)' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: '600', color: 'var(--color-text-muted)', alignSelf: 'center' }}>
                  Learned Category Accuracy Priors:
                </span>
                {Object.entries(aiModel.accuracyPriors).map(([cat, prior]) => (
                  <span key={cat} style={{ fontSize: '0.75rem', background: 'var(--color-bg, #fff)', border: '1px solid var(--color-border)', borderRadius: '4px', padding: '2px 8px', display: 'inline-flex', gap: '4px', alignItems: 'center' }}>
                    <span>{cat}:</span>
                    <strong style={{ color: prior >= 0.75 ? '#15803d' : prior >= 0.5 ? '#b45309' : '#dc2626' }}>
                      {Math.round(prior * 100)}%
                    </strong>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Filter Bar */}
          <div className="admin-filter-bar card" style={{ padding: 'var(--space-3) var(--space-4)', display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap', alignItems: 'center', marginTop: 'var(--space-4)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="admin-filter-bar__label">Validation Status:</span>
              <select
                className="form-input"
                style={{ width: 'auto', padding: '4px 10px', fontSize: '0.85rem' }}
                value={aiOutcomeFilter}
                onChange={(e) => setAiOutcomeFilter(e.target.value)}
              >
                <option value="all">All Outcomes ({aiSamples.length})</option>
                <option value="pending">⏳ Pending Review</option>
                <option value="accepted">✅ Accepted</option>
                <option value="corrected">✏️ Corrected</option>
                <option value="rejected">❌ Rejected</option>
              </select>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="admin-filter-bar__label">Category:</span>
              <select
                className="form-input"
                style={{ width: 'auto', padding: '4px 10px', fontSize: '0.85rem' }}
                value={aiCategoryFilter}
                onChange={(e) => setAiCategoryFilter(e.target.value)}
              >
                <option value="all">All Categories</option>
                <option value="PCB">PCB (Printed Circuit Boards)</option>
                <option value="Battery">Battery</option>
                <option value="CRT">CRT Monitors</option>
                <option value="LCD">LCD Screens</option>
                <option value="Cables">Cables & Wires</option>
                <option value="Motors">Motors & Magnets</option>
                <option value="Plastics">Mixed E-Plastics</option>
                <option value="Other">Other E-Waste</option>
              </select>
            </div>

            <div style={{ marginLeft: 'auto', fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
              Showing <strong>{filteredAiSamples.length}</strong> of <strong>{aiSamples.length}</strong> samples
            </div>
          </div>

          {(aiSummary?.categories?.length || 0) > 0 && (
            <div className="admin-table-wrap card" style={{ marginTop: 'var(--space-4)' }}>
              <div style={{ padding: 'var(--space-3) var(--space-4)', borderBottom: '1px solid var(--color-border)', fontWeight: '600', fontSize: '0.9rem' }}>
                📊 Accuracy & Distribution by E-Waste Category
              </div>
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
                      <td><span style={{ color: '#15803d', fontWeight: '600' }}>{c.accepted}</span></td>
                      <td><span style={{ color: '#c2410c', fontWeight: '600' }}>{c.corrected}</span></td>
                      <td>{c.dismissed}</td>
                      <td><span style={{ color: '#b45309', fontWeight: '600' }}>{c.pending_review}</span></td>
                      <td><strong>{c.accuracy_pct != null ? `${c.accuracy_pct}%` : '—'}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="admin-table-wrap card" style={{ marginTop: 'var(--space-4)' }}>
            <div style={{ padding: 'var(--space-3) var(--space-4)', borderBottom: '1px solid var(--color-border)', fontWeight: '600', fontSize: '0.9rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>🔍 Classification Samples & Human Validation Records</span>
              <span className="text-muted" style={{ fontSize: '0.8rem', fontWeight: 'normal' }}>
                Click action buttons to accept, correct, or audit records
              </span>
            </div>
            {filteredAiSamples.length === 0 ? (
              <div style={{ padding: 'var(--space-6)', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                No dataset samples found matching the selected filters.
              </div>
            ) : (
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>{t('admin.dataset.when')}</th>
                    <th>Lot / Collector</th>
                    <th>{t('admin.dataset.aiPredicted')}</th>
                    <th>{t('admin.dataset.humanLabel')}</th>
                    <th>{t('admin.dataset.outcome')}</th>
                    <th>Audit Details</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAiSamples.map((s) => {
                    const outcome = s.outcome || 'pending';
                    const isBusy = aiActionBusy === s.id;
                    return (
                      <tr key={s.id} className={outcome === 'pending' ? 'admin-row--pending' : ''}>
                        <td>
                          {fmtDate(s.created_at)}
                          <span className="admin-table__sub" style={{ fontSize: '0.75rem' }}>ID #{s.id}</span>
                        </td>
                        <td>
                          <span className="font-mono" style={{ fontWeight: '600', display: 'block' }}>
                            {s.display_lot_id || s.lot_id || `Sample #${s.id}`}
                          </span>
                          {s.collector_name && <span className="admin-table__sub">👤 {s.collector_name}</span>}
                        </td>
                        <td>
                          <span style={{ fontWeight: '600' }}>{s.ai_predicted_category}</span>
                          <span className="admin-table__sub">
                            Conf: <strong>{Math.round(Number(s.ai_confidence || 0) * 100)}%</strong>
                          </span>
                        </td>
                        <td>
                          {s.human_category || s.effective_category ? (
                            <span style={{ fontWeight: '600', color: (s.human_category || s.effective_category) !== s.ai_predicted_category ? '#c2410c' : '#15803d' }}>
                              {s.human_category || s.effective_category}
                            </span>
                          ) : (
                            <span style={{ fontWeight: '600', color: '#15803d' }}>
                              {s.ai_predicted_category}
                            </span>
                          )}
                        </td>
                        <td>
                          <span className={`dataset-outcome dataset-outcome--${outcome}`}>
                            {outcome === 'accepted' && '✅ Accepted'}
                            {outcome === 'corrected' && '✏️ Corrected'}
                            {outcome === 'pending' && '⏳ Pending'}
                            {outcome === 'rejected' && '❌ Rejected'}
                            {outcome === 'review_required' && '⚠️ Review Required'}
                            {!['accepted', 'corrected', 'pending', 'rejected', 'review_required'].includes(outcome) && outcome}
                          </span>
                        </td>
                        <td style={{ maxWidth: '240px' }}>
                          {s.correction_reason ? (
                            <div style={{ fontSize: '0.8rem', lineHeight: '1.3' }}>
                              <span style={{ fontStyle: 'italic', display: 'block', color: 'var(--color-text-primary)' }}>
                                "{s.correction_reason}"
                              </span>
                              {s.reviewed_by && (
                                <span className="admin-table__sub">
                                  By {s.reviewed_by} {s.reviewed_at ? `on ${fmtDate(s.reviewed_at)}` : ''}
                                </span>
                              )}
                            </div>
                          ) : s.reviewed_by ? (
                            <span className="admin-table__sub">Reviewed by {s.reviewed_by}</span>
                          ) : (
                            <span className="text-muted" style={{ fontSize: '0.8rem' }}>Unreviewed</span>
                          )}
                        </td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <div style={{ display: 'inline-flex', gap: '4px' }}>
                            <button
                              type="button"
                              className="btn btn-outline"
                              style={{ padding: '2px 8px', fontSize: '0.75rem' }}
                              onClick={() => openInspectModal(s)}
                              title="Inspect sample details & audit log"
                            >
                              👁 View
                            </button>
                            {outcome === 'pending' && (
                              <>
                                <button
                                  type="button"
                                  className="btn btn-outline"
                                  style={{ padding: '2px 8px', fontSize: '0.75rem', borderColor: '#b45309', color: '#b45309' }}
                                  onClick={() => openCorrectionModal(s)}
                                  disabled={isBusy}
                                  title="Correct classification label"
                                >
                                  ✏️ Correct
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-primary"
                                  style={{ padding: '2px 8px', fontSize: '0.75rem', backgroundColor: '#16a34a', borderColor: '#16a34a' }}
                                  onClick={() => handleDatasetAction(s.id, 'accepted')}
                                  disabled={isBusy}
                                  title="Accept AI prediction & validate into training set"
                                >
                                  {isBusy ? <LoadingSpinner size="sm" /> : '✅ Accept'}
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-outline"
                                  style={{ padding: '2px 8px', fontSize: '0.75rem', borderColor: '#dc2626', color: '#dc2626' }}
                                  onClick={() => handleDatasetAction(s.id, 'rejected', null, 'Rejected by admin')}
                                  disabled={isBusy}
                                  title="Reject sample from training set"
                                >
                                  ❌ Reject
                                </button>
                              </>
                            )}
                            {outcome === 'corrected' && (
                              <>
                                <button
                                  type="button"
                                  className="btn btn-outline"
                                  style={{ padding: '2px 8px', fontSize: '0.75rem', borderColor: '#b45309', color: '#b45309' }}
                                  onClick={() => openCorrectionModal(s)}
                                  disabled={isBusy}
                                  title="Edit correction label or reason"
                                >
                                  ✏️ Edit
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-primary"
                                  style={{ padding: '2px 8px', fontSize: '0.75rem', backgroundColor: '#16a34a', borderColor: '#16a34a' }}
                                  onClick={() => handleDatasetAction(s.id, 'accepted', s.human_category || s.effective_category || s.ai_predicted_category, s.correction_reason)}
                                  disabled={isBusy}
                                  title="Approve corrected label into retraining set"
                                >
                                  {isBusy ? <LoadingSpinner size="sm" /> : '✅ Approve'}
                                </button>
                              </>
                            )}
                            {(outcome === 'accepted' || outcome === 'rejected') && (
                              <button
                                type="button"
                                className="btn btn-outline"
                                style={{ padding: '2px 8px', fontSize: '0.75rem' }}
                                onClick={() => handleDatasetAction(s.id, 'pending')}
                                disabled={isBusy}
                                title="Reopen for re-review"
                              >
                                ↩️ Reopen
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      ) : (
        <div className="animate-fade-in">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
            <p className="quote-section__empty" style={{ margin: 0 }}>{t('admin.pricesDesc')}</p>
            <button className="btn btn-primary btn-sm" onClick={openNewSourceModal}>+ Add Source</button>
          </div>
          <div className="admin-table-wrap card">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>{t('admin.table.source')}</th>
                  <th>{t('admin.table.type')}</th>
                  <th>{t('admin.table.url')}</th>
                  <th>{t('admin.table.lastCollected')}</th>
                  <th>Actions</th>
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
                    <td>
                      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                        <button className="btn btn-outline" style={{ padding: '2px 8px', fontSize: '0.75rem' }} onClick={() => openEditSourceModal(s)}>Edit</button>
                        <button className="btn btn-outline" style={{ padding: '2px 8px', fontSize: '0.75rem', color: '#dc2626', borderColor: '#fca5a5' }} onClick={() => handleDeletePriceSource(s.id)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Inspection & Audit Modal ── */}
      {inspectSample && (
        <div className="modal-backdrop" onClick={() => setInspectSample(null)}>
          <div className="modal-content card animate-scale-in" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '600px', width: '90%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)', borderBottom: '1px solid var(--color-border)', paddingBottom: 'var(--space-3)' }}>
              <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: '700' }}>
                👁 Dataset Sample Inspection — ID #{inspectSample.id}
              </h3>
              <button type="button" className="btn-icon" onClick={() => setInspectSample(null)} aria-label="Close">×</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)', marginBottom: 'var(--space-4)' }}>
              <div>
                <span className="admin-stat__label">AI Predicted Category</span>
                <div style={{ fontSize: '1.2rem', fontWeight: '700', color: 'var(--color-primary)' }}>
                  {inspectSample.ai_predicted_category}
                </div>
                <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginTop: '2px' }}>
                  Confidence: <strong>{Math.round(Number(inspectSample.ai_confidence || 0) * 100)}%</strong>
                </div>
              </div>

              <div>
                <span className="admin-stat__label">Validated Human Label</span>
                <div style={{ fontSize: '1.2rem', fontWeight: '700', color: inspectSample.human_category && inspectSample.human_category !== inspectSample.ai_predicted_category ? '#c2410c' : '#15803d' }}>
                  {inspectSample.human_category || inspectSample.effective_category || '—'}
                </div>
                <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginTop: '2px' }}>
                  Outcome: <span className={`dataset-outcome dataset-outcome--${inspectSample.outcome || 'pending'}`}>{inspectSample.outcome || 'pending'}</span>
                </div>
              </div>
            </div>

            <div style={{ background: 'var(--color-surface-alt, #f8fafc)', padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', marginBottom: 'var(--space-4)', fontSize: '0.88rem' }}>
              <div style={{ fontWeight: '600', marginBottom: '4px' }}>📋 Sample Context & Metadata</div>
              <div>• <strong>Lot Reference:</strong> {inspectSample.display_lot_id || inspectSample.lot_id || `Scan Sample #${inspectSample.id} (Unlinked)`}</div>
              {inspectSample.collector_name && <div>• <strong>Collector:</strong> {inspectSample.collector_name}</div>}
              <div>• <strong>Recorded Date:</strong> {fmtDate(inspectSample.created_at)}</div>
              {inspectSample.correction_reason && (
                <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid var(--color-border)' }}>
                  • <strong>Correction Reason:</strong> <span style={{ fontStyle: 'italic' }}>"{inspectSample.correction_reason}"</span>
                </div>
              )}
              {inspectSample.reviewed_by && (
                <div>• <strong>Reviewed By:</strong> {inspectSample.reviewed_by} {inspectSample.reviewed_at ? `on ${fmtDate(inspectSample.reviewed_at)}` : ''}</div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
              <button type="button" className="btn btn-outline" onClick={() => setInspectSample(null)}>Close</button>
              <button
                type="button"
                className="btn btn-outline"
                style={{ borderColor: '#b45309', color: '#b45309' }}
                onClick={() => {
                  const s = inspectSample;
                  setInspectSample(null);
                  openCorrectionModal(s);
                }}
              >
                ✏️ Correct Label
              </button>
              <button
                type="button"
                className="btn btn-primary"
                style={{ backgroundColor: '#16a34a', borderColor: '#16a34a' }}
                onClick={() => {
                  handleDatasetAction(inspectSample.id, 'accepted', inspectSample.human_category, inspectSample.correction_reason);
                }}
              >
                ✅ Accept & Validate
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Correction Modal ── */}
      {correctionSample && (
        <div className="modal-backdrop" onClick={() => setCorrectionSample(null)}>
          <div className="modal-content card animate-scale-in" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '520px', width: '90%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)', borderBottom: '1px solid var(--color-border)', paddingBottom: 'var(--space-3)' }}>
              <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: '700' }}>
                ✏️ Human Label Correction — Sample #{correctionSample.id}
              </h3>
              <button type="button" className="btn-icon" onClick={() => setCorrectionSample(null)} aria-label="Close">×</button>
            </div>

            <p style={{ fontSize: '0.9rem', color: 'var(--color-text-muted)', marginBottom: 'var(--space-4)' }}>
              AI prediction was <strong>{correctionSample.ai_predicted_category}</strong> ({Math.round(Number(correctionSample.ai_confidence || 0) * 100)}% conf). Select the correct category and provide justification.
            </p>

            <div style={{ marginBottom: 'var(--space-4)' }}>
              <label className="form-label">Correct E-Waste Category</label>
              <select
                className="form-input"
                value={correctingCat}
                onChange={(e) => setCorrectingCat(e.target.value)}
              >
                <option value="PCB">PCB (Printed Circuit Boards)</option>
                <option value="Battery">Battery (Li-ion, Lead-Acid)</option>
                <option value="CRT">CRT Glass / Monitors</option>
                <option value="LCD">LCD / LED Screen Panels</option>
                <option value="Cables">Cables, Wires & Wiring Harnesses</option>
                <option value="Motors">Motors, Transformers & Magnets</option>
                <option value="Plastics">Mixed E-Plastics</option>
                <option value="Other">Other E-Waste</option>
              </select>
            </div>

            <div style={{ marginBottom: 'var(--space-4)' }}>
              <label className="form-label">Correction Reason / Justification</label>
              <textarea
                className="form-input"
                rows="3"
                placeholder="e.g., Image contains Lithium-ion battery pack mistakenly identified as PCB due to casing design."
                value={correctionReasonInput}
                onChange={(e) => setCorrectionReasonInput(e.target.value)}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
              <button type="button" className="btn btn-outline" onClick={() => setCorrectionSample(null)}>Cancel</button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => handleDatasetAction(correctionSample.id, 'corrected', correctingCat, correctionReasonInput)}
                disabled={aiActionBusy === correctionSample.id}
              >
                {aiActionBusy === correctionSample.id ? <LoadingSpinner size="sm" /> : 'Save & Submit Correction'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Price Source Modal ── */}
      {showSourceModal && (
        <div className="modal-backdrop" onClick={() => setShowSourceModal(false)}>
          <div className="modal-content card animate-scale-in" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '500px', width: '90%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)', borderBottom: '1px solid var(--color-border)', paddingBottom: 'var(--space-3)' }}>
              <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: '700' }}>
                {editingSource ? 'Edit Price Source' : 'Add Price Source'}
              </h3>
              <button type="button" className="btn-icon" onClick={() => setShowSourceModal(false)} aria-label="Close">×</button>
            </div>
            <form onSubmit={handleSavePriceSource}>
              <div style={{ marginBottom: 'var(--space-3)' }}>
                <label className="form-label">Source Name</label>
                <input required className="form-input" value={sourceForm.source_name} onChange={e => setSourceForm({ ...sourceForm, source_name: e.target.value })} />
              </div>
              <div style={{ marginBottom: 'var(--space-3)' }}>
                <label className="form-label">Type</label>
                <select className="form-input" value={sourceForm.source_type} onChange={e => setSourceForm({ ...sourceForm, source_type: e.target.value })}>
                  <option value="MARKET REFERENCE">Market Reference</option>
                  <option value="REGULATORY">Regulatory</option>
                  <option value="FIELD SURVEY">Field Survey</option>
                </select>
              </div>
              <div style={{ marginBottom: 'var(--space-3)' }}>
                <label className="form-label">URL (Optional)</label>
                <input type="url" className="form-input" value={sourceForm.source_url} onChange={e => setSourceForm({ ...sourceForm, source_url: e.target.value })} />
              </div>
              <div style={{ marginBottom: 'var(--space-4)' }}>
                <label className="form-label">Description (Optional)</label>
                <textarea className="form-input" rows="2" value={sourceForm.description} onChange={e => setSourceForm({ ...sourceForm, description: e.target.value })} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
                <button type="button" className="btn btn-outline" onClick={() => setShowSourceModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={sourceBusy}>
                  {sourceBusy ? <LoadingSpinner size="sm" /> : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
