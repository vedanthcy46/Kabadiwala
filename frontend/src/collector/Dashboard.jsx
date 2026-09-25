import { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { getEarningsSummary, getLotsByCollector, DEMO_COLLECTOR_ID } from '../api/client';
import { currentCollectorId, getSession } from '../services/auth';
import { PageLoader, SkeletonCard } from '../components/LoadingSpinner';
import { useTranslation } from '../i18n/config.js';
import './Dashboard.css';

// ─── Helpers ────────────────────────────────────────────────────────────────
function fmt(n) {
  if (n == null) return '—';
  return `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function fmtDate(d, lang) {
  if (!d) return '';
  const locale = lang === 'hi' ? 'hi-IN' : lang === 'mr' ? 'mr-IN' : lang === 'kn' ? 'kn-IN' : lang === 'ta' ? 'ta-IN' : lang === 'te' ? 'te-IN' : lang === 'ml' ? 'ml-IN' : lang === 'bn' ? 'bn-IN' : 'en-IN';
  return new Date(d).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
}

// ─── Status meta — emoji + i18n key ─────────────────────────────────────────
// colors stay fixed; labels come from t()
const STATUS_META = {
  quoted:      { emoji: '⏳', color: '#b45309', bg: '#fef3c7', labelKey: 'dashboard.statusWaiting',   stepKey: 'dashboard.stepWaiting' },
  matched:     { emoji: '🤝', color: '#1d4ed8', bg: '#dbeafe', labelKey: 'dashboard.statusMatched',   stepKey: 'dashboard.stepMatched' },
  accepted:    { emoji: '✅', color: '#15803d', bg: '#dcfce7', labelKey: 'dashboard.statusAccepted',  stepKey: 'dashboard.stepAccepted' },
  handed_over: { emoji: '🚚', color: '#7c3aed', bg: '#ede9fe', labelKey: 'dashboard.statusPickedUp',  stepKey: 'dashboard.stepHandedOver' },
  confirmed:   { emoji: '💰', color: '#15803d', bg: '#dcfce7', labelKey: 'dashboard.statusPaid',      stepKey: 'dashboard.stepConfirmed' },
  cancelled:   { emoji: '❌', color: '#dc2626', bg: '#fee2e2', labelKey: 'dashboard.statusCancelled', stepKey: null },
};

function StatusPill({ status, t }) {
  const m = STATUS_META[status] || STATUS_META.quoted;
  const label = t(m.labelKey) || status;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '5px',
      background: m.bg, color: m.color,
      padding: '4px 12px', borderRadius: '20px',
      fontWeight: '700', fontSize: '0.8rem',
    }}>
      {m.emoji} {label}
    </span>
  );
}

// ─── TTS speak helper ─────────────────────────────────────────────────────────
const BCP47 = { en: 'en-IN', hi: 'hi-IN', mr: 'mr-IN', kn: 'kn-IN', ta: 'ta-IN', te: 'te-IN', ml: 'ml-IN', bn: 'bn-IN' };

function useTTS(lang) {
  const audioRef = useRef(null);
  const synthRef = useRef(typeof window !== 'undefined' ? window.speechSynthesis : null);

  function stop() {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    if (synthRef.current) synthRef.current.cancel();
  }

  function speak(text) {
    if (!text) return;
    stop();
    try {
      const apiBase = (import.meta.env?.VITE_API_BASE_URL || '/v1').replace(/\/+$/, '');
      const ttsLang = BCP47[lang] || lang || 'en-IN';
      const url = `${apiBase}/tts?lang=${encodeURIComponent(ttsLang)}&text=${encodeURIComponent(String(text).slice(0, 200))}`;
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onerror = () => fallback(text);
      audio.play().catch(() => fallback(text));
    } catch { fallback(text); }
  }

  function fallback(text) {
    if (!synthRef.current) return;
    try {
      synthRef.current.cancel();
      const utt = new SpeechSynthesisUtterance(text);
      utt.lang = BCP47[lang] || 'en-IN';
      utt.rate = 0.88;
      const voices = synthRef.current.getVoices();
      const v = voices.find(v => v.lang === utt.lang) || voices.find(v => v.lang?.startsWith(lang));
      if (v) utt.voice = v;
      synthRef.current.speak(utt);
    } catch { /* silent */ }
  }

  return { speak, stop };
}

// ─── Quick Action card with big icon + speak button ──────────────────────────
function ActionCard({ to, emoji, label, hint, speakText, onSpeak, color = 'var(--color-primary)', tHear }) {
  return (
    <Link
      to={to}
      className="card card-clickable"
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        gap: '10px', padding: '20px 12px', textDecoration: 'none',
        color: 'inherit', borderTop: `4px solid ${color}`,
        minHeight: '130px', justifyContent: 'center',
        position: 'relative',
      }}
      aria-label={label}
    >
      <button
        type="button"
        onClick={e => { e.preventDefault(); onSpeak(speakText); }}
        aria-label={`${tHear} — ${label}`}
        style={{
          position: 'absolute', top: '8px', right: '8px',
          background: 'transparent', border: 'none',
          fontSize: '1rem', cursor: 'pointer', opacity: 0.6,
          padding: '4px',
        }}
      >🔊</button>

      <span style={{ fontSize: '2.4rem', lineHeight: 1 }}>{emoji}</span>
      <span style={{ fontWeight: '700', fontSize: '0.92rem', textAlign: 'center' }}>{label}</span>
      <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', textAlign: 'center', lineHeight: '1.3' }}>{hint}</span>
    </Link>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────
export default function CollectorDashboard() {
  const { t, lang } = useTranslation();
  const { speak, stop } = useTTS(lang);

  const [earnings, setEarnings]   = useState(null);
  const [lots, setLots]           = useState([]);
  const [loadingE, setLoadingE]   = useState(true);
  const [loadingL, setLoadingL]   = useState(true);
  const [error, setError]         = useState('');
  // sessionStorage: greeting fires ONCE per browser session, not on every remount
  const [greeted, setGreeted] = useState(
    () => sessionStorage.getItem('dash_greeted') === '1'
  );

  const collectorId = currentCollectorId() ?? DEMO_COLLECTOR_ID;
  const session     = getSession();
  const name        = session?.name || t('nav.collector') || 'Collector';
  const firstName   = name.split(' ')[0];

  useEffect(() => {
    getEarningsSummary(collectorId)
      .then(r => setEarnings(r.data))
      .catch(() => setError(t('dashboard.backendError')))
      .finally(() => setLoadingE(false));

    getLotsByCollector(collectorId)
      .then(r => setLots(Array.isArray(r.data) ? r.data.slice(0, 5) : []))
      .catch(() => {})
      .finally(() => setLoadingL(false));
  }, []); // eslint-disable-line

  // Auto-greet once when both loads finish
  useEffect(() => {
    if (loadingE || loadingL || greeted) return;
    setGreeted(true);
    sessionStorage.setItem('dash_greeted', '1'); // persist across tab switches
    let greetingText;
    const earned = earnings?.total_earned;
    const pending = earnings?.total_pending;
    if (earned) {
      greetingText = t('dashboard.greetingVoice', {
        name: firstName,
        earned: fmt(earned),
        pending: fmt(pending ?? 0),
      });
    } else {
      greetingText = t('dashboard.greetingVoiceNoEarnings', { name: firstName });
    }
    setTimeout(() => speak(greetingText), 900);
  }, [loadingE, loadingL]); // eslint-disable-line

  useEffect(() => () => stop(), []); // eslint-disable-line

  // Most urgent lot needing action
  const urgentLot  = lots.find(l => ['matched', 'handed_over'].includes(l.transaction_status));
  const urgentMeta = urgentLot ? STATUS_META[urgentLot.transaction_status] : null;

  // Earnings stat cards config
  const earningCards = [
    {
      icon: '💰',
      label: t('dashboard.totalEarned'),
      value: fmt(earnings?.total_earned),
      color: '#15803d', bg: '#f0fdf4',
      speakText: t('dashboard.totalEarnedVoice', { amount: fmt(earnings?.total_earned) }),
    },
    {
      icon: '⏳',
      label: t('dashboard.pending'),
      value: fmt(earnings?.total_pending),
      color: '#b45309', bg: '#fef3c7',
      speakText: t('dashboard.pendingVoice', { amount: fmt(earnings?.total_pending) }),
    },
    {
      icon: '📦',
      label: t('dashboard.totalLots'),
      value: earnings?.total_transactions ?? '—',
      color: '#1d4ed8', bg: '#eff6ff',
      speakText: t('dashboard.totalLotsVoice', { count: earnings?.total_transactions ?? 0 }),
    },
  ];

  return (
    <div className="container" style={{ paddingBottom: '40px' }}>

      {/* ── Greeting Banner ────────────────────────────────────── */}
      <div className="animate-fade-in" style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: '12px',
        marginBottom: 'var(--space-5)', paddingTop: 'var(--space-4)',
      }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: '800', margin: 0 }}>
            👋 {firstName}!
          </h1>
          <p style={{ margin: '4px 0 0', color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>
            {t('dashboard.subtitle')}
          </p>
        </div>
        <button
          type="button"
          onClick={() => speak(t('dashboard.globalVoice', { name: firstName }))}
          className="btn btn-outline"
          style={{ gap: '6px', fontSize: '0.9rem' }}
          aria-label={t('dashboard.hearInstructions')}
        >
          🔊 {t('dashboard.hearInstructions')}
        </button>
      </div>

      {error && (
        <div className="alert-banner alert-banner--warn animate-fade-in">{error}</div>
      )}

      {/* ── "What to do next" urgent alert ────────────────────── */}
      {urgentLot && urgentMeta && (
        <div className="animate-fade-in" style={{
          background: '#eff6ff', border: '2px solid #3b82f6',
          borderRadius: '14px', padding: '16px 20px',
          marginBottom: 'var(--space-5)',
          display: 'flex', alignItems: 'flex-start', gap: '14px',
        }}>
          <span style={{ fontSize: '2rem' }}>
            {urgentLot.transaction_status === 'matched' ? '👆' : '✍️'}
          </span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: '800', fontSize: '0.82rem', color: '#1d4ed8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>
              {t('dashboard.actionNeeded')}
            </div>
            <div style={{ fontWeight: '600', fontSize: '0.95rem', color: '#1e3a8a' }}>
              {t(urgentMeta.stepKey)}
            </div>
            <Link
              to={`/collector/lots/${urgentLot.lot_id}`}
              className="btn btn-primary"
              style={{ marginTop: '12px', fontSize: '0.88rem', padding: '8px 18px' }}
            >
              {t('dashboard.openLot')} {urgentLot.lot_id} →
            </Link>
          </div>
          <button
            type="button"
            onClick={() => speak(t(urgentMeta.stepKey))}
            aria-label={t('dashboard.hearInstructions')}
            style={{ background: 'none', border: 'none', fontSize: '1.3rem', cursor: 'pointer' }}
          >🔊</button>
        </div>
      )}

      {/* ── Earnings Row ────────────────────────────────────────── */}
      <section style={{ marginBottom: 'var(--space-6)' }}>
        {loadingE ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '12px' }}>
            {[0,1,2].map(i => <SkeletonCard key={i} />)}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '12px' }}>
            {earningCards.map(({ icon, label, value, color, bg, speakText }) => (
              <button
                key={label}
                type="button"
                onClick={() => speak(speakText)}
                style={{
                  background: bg, border: `2px solid ${color}30`,
                  borderRadius: '14px', padding: '16px 10px',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px',
                  cursor: 'pointer', boxShadow: 'none', width: '100%',
                }}
                aria-label={`${label}: ${value}. ${t('dashboard.tapToHear')}`}
              >
                <span style={{ fontSize: '1.8rem' }}>{icon}</span>
                <span style={{ fontWeight: '800', fontSize: '1.25rem', color }}>{value}</span>
                <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', textAlign: 'center' }}>{label}</span>
                <span style={{ fontSize: '0.65rem', color, opacity: 0.7 }}>🔊 {t('dashboard.tapToHear')}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* ── Main CTA — big "Sell My Scrap" button ───────────────── */}
      <Link
        to="/collector/create-lot"
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '14px',
          background: 'linear-gradient(135deg, #16a34a 0%, #15803d 100%)',
          color: '#fff', borderRadius: '18px',
          padding: '20px 24px', marginBottom: 'var(--space-5)',
          textDecoration: 'none', fontWeight: '800', fontSize: '1.2rem',
          boxShadow: '0 4px 20px #16a34a40',
        }}
        aria-label={t('dashboard.sellScrap')}
      >
        <span style={{ fontSize: '2.2rem' }}>📸</span>
        <div>
          <div>{t('dashboard.sellScrap')}</div>
          <div style={{ fontWeight: '400', fontSize: '0.82rem', opacity: 0.88 }}>
            {t('dashboard.sellScrapHint')}
          </div>
        </div>
        <span style={{ fontSize: '1.8rem', marginLeft: 'auto' }}>→</span>
      </Link>

      {/* ── Quick Actions Grid ──────────────────────────────────── */}
      <section style={{ marginBottom: 'var(--space-6)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: '700', margin: 0 }}>
            {t('dashboard.whatCanIDo')}
          </h2>
          <button
            type="button"
            onClick={() => speak(t('dashboard.hearOptions'))}
            style={{ background: 'none', border: 'none', fontSize: '1.1rem', cursor: 'pointer', color: 'var(--color-primary)' }}
            aria-label={t('dashboard.hearInstructions')}
          >🔊</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
          <ActionCard
            to="/collector/prices"
            emoji="📊"
            label={t('dashboard.todayPrices')}
            hint={t('dashboard.todayPricesHint')}
            speakText={t('dashboard.todayPricesVoice')}
            onSpeak={speak}
            color="#2563eb"
            tHear={t('dashboard.hearInstructions')}
          />
          <ActionCard
            to="/collector/find-recyclers"
            emoji="🏭"
            label={t('dashboard.findRecyclers')}
            hint={t('dashboard.findRecyclersDesc')}
            speakText={t('dashboard.findRecyclersVoice')}
            onSpeak={speak}
            color="#7c3aed"
            tHear={t('dashboard.hearInstructions')}
          />
          <ActionCard
            to="/collector/earnings"
            emoji="💳"
            label={t('dashboard.myPayments')}
            hint={t('dashboard.myPaymentsHint')}
            speakText={t('dashboard.myPaymentsVoice')}
            onSpeak={speak}
            color="#b45309"
            tHear={t('dashboard.hearInstructions')}
          />
          <ActionCard
            to="/collector/profile"
            emoji="👤"
            label={t('dashboard.myProfile')}
            hint={t('dashboard.myProfileHint')}
            speakText={t('dashboard.myProfileVoice')}
            onSpeak={speak}
            color="#374151"
            tHear={t('dashboard.hearInstructions')}
          />
        </div>
      </section>

      {/* ── Recent Lots ─────────────────────────────────────────── */}
      <section>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: '700', margin: 0 }}>
            📋 {t('dashboard.myRecentLots')}
          </h2>
          <button
            type="button"
            onClick={() => {
              if (lots.length === 0) { speak(t('dashboard.noLotsVoice')); return; }
              const summary = lots.slice(0, 3).map((l, i) => {
                const meta = STATUS_META[l.transaction_status] || STATUS_META.quoted;
                return `${i + 1}. ${l.category} — ${t(meta.labelKey)}.`;
              }).join(' ');
              speak(summary);
            }}
            style={{ background: 'none', border: 'none', fontSize: '1.1rem', cursor: 'pointer', color: 'var(--color-primary)' }}
            aria-label={t('dashboard.hearInstructions')}
          >🔊</button>
        </div>

        {loadingL ? (
          <PageLoader />
        ) : lots.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '32px 20px' }}>
            <div style={{ fontSize: '3rem', marginBottom: '12px' }}>📭</div>
            <p style={{ fontWeight: '700', fontSize: '1rem', marginBottom: '8px' }}>{t('dashboard.noLots')}</p>
            <p style={{ color: 'var(--color-text-muted)', fontSize: '0.88rem', marginBottom: '16px' }}>
              {t('dashboard.noLotsDesc')}
            </p>
            <Link to="/collector/create-lot" className="btn btn-primary">
              📸 {t('dashboard.startSelling')}
            </Link>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {lots.map((lot) => {
              const status = lot.transaction_status || lot.payment_status || 'quoted';
              const meta   = STATUS_META[status] || STATUS_META.quoted;
              const stepText = meta.stepKey ? t(meta.stepKey) : '';
              const lotLabel = t(meta.labelKey) || status;

              return (
                <Link
                  key={lot.lot_id}
                  to={`/collector/lots/${lot.lot_id}`}
                  className="card card-clickable"
                  style={{ textDecoration: 'none', color: 'inherit', padding: '14px 16px' }}
                  aria-label={`${lot.category} — ${lotLabel}`}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    {/* Big status emoji */}
                    <div style={{
                      width: '48px', height: '48px', borderRadius: '12px',
                      background: meta.bg, display: 'flex', alignItems: 'center',
                      justifyContent: 'center', fontSize: '1.6rem', flexShrink: 0,
                    }}>
                      {meta.emoji}
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: '700', fontSize: '0.92rem', marginBottom: '4px' }}>
                        {lot.category}
                      </div>
                      <StatusPill status={status} t={t} />
                      {stepText && (
                        <div style={{ fontSize: '0.73rem', color: 'var(--color-text-muted)', marginTop: '5px', lineHeight: '1.3' }}>
                          👉 {stepText}
                        </div>
                      )}
                    </div>

                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontWeight: '800', fontSize: '1rem', color: 'var(--color-primary)' }}>
                        {fmt(lot.estimated_value)}
                      </div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
                        {lot.approx_weight_kg ?? lot.weight_kg ?? '?'} {t('common.kg')} · {fmtDate(lot.created_at, lang)}
                      </div>
                      {/* Per-lot speak button */}
                      <button
                        type="button"
                        onClick={e => {
                          e.preventDefault();
                          const msg = t('dashboard.lotVoice', {
                            category: lot.category,
                            weight: lot.approx_weight_kg ?? lot.weight_kg ?? '?',
                            status: lotLabel,
                            nextStep: stepText,
                          });
                          speak(msg);
                        }}
                        style={{ background: 'none', border: 'none', fontSize: '0.9rem', cursor: 'pointer', color: 'var(--color-primary)', marginTop: '4px', padding: '2px' }}
                        aria-label={`${t('dashboard.hearInstructions')} — ${lot.category}`}
                      >
                        🔊
                      </button>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
