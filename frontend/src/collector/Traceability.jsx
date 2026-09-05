import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getLotEvents } from '../api/client';
import { StatusBadge } from '../components/StatusBadge';
import { PageLoader } from '../components/LoadingSpinner';
import { useTranslation } from '../i18n/config.js';
import './Traceability.css';

// ── Event catalogue ─────────────────────────────────────────────────────────
// Maps each backend event_type to display metadata used by the timeline.
// icon, label key, colour class, and whether the event renders an inline photo.
const EVENT_META = {
  LOT_CREATED: { icon: '📦', labelKey: 'traceability.events.created', colour: 'green' },
  IMAGE_UPLOADED: { icon: '📷', labelKey: 'traceability.events.imageUploaded', colour: 'blue', hasPhoto: true },
  PRICE_ESTIMATED: { icon: '₹', labelKey: 'traceability.events.valued', colour: 'purple' },
  RECYCLER_MATCHED: { icon: '🏭', labelKey: 'traceability.events.matched', colour: 'teal' },
  QUOTE_RECEIVED: { icon: '💬', labelKey: 'traceability.events.quoteReceived', colour: 'amber' },
  QUOTE_ACCEPTED: { icon: '✅', labelKey: 'traceability.events.quoteAccepted', colour: 'green' },
  QR_SCANNED: { icon: '▣', labelKey: 'traceability.events.qrScanned', colour: 'blue' },
  LOT_VERIFIED: { icon: '🔍', labelKey: 'traceability.events.lotVerified', colour: 'teal' },
  FINAL_WEIGHT_RECORDED: { icon: '⚖', labelKey: 'traceability.events.weightRecorded', colour: 'amber' },
  HANDOVER_PHOTO: { icon: '📷', labelKey: 'traceability.events.handoverPhoto', colour: 'blue', hasPhoto: true },
  GPS_CAPTURED: { icon: '📍', labelKey: 'traceability.events.gpsCaptured', colour: 'red' },
  HANDOVER_CONFIRMED: { icon: '✅', labelKey: 'traceability.events.handoverConfirmed', colour: 'green' },
  PAYMENT_COMPLETED: { icon: '💵', labelKey: 'traceability.events.paymentDone', colour: 'green' },
  DISPUTE_RAISED: { icon: '⚠', labelKey: 'traceability.events.dispute', colour: 'red' },
};

// ── Helpers ──────────────────────────────────────────────────────────────────
function fmtDate(d, lang) {
  if (!d) return null;
  const locale = lang === 'hi' ? 'hi-IN' : lang === 'mr' ? 'mr-IN' : 'en-IN';
  return new Date(d).toLocaleString(locale, {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  });
}

function fmtRupees(n) {
  if (n == null) return null;
  return `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

/**
 * Build a human-readable detail line for each event type from its metadata.
 * Falls back gracefully when fields are missing.
 */
function buildDetail(eventType, metadata, t) {
  if (!metadata || typeof metadata !== 'object') return null;
  const m = metadata;

  switch (eventType) {
    case 'LOT_CREATED':
      return [
        m.category,
        m.approx_weight_kg ? `${m.approx_weight_kg} kg` : null,
        m.location,
        m.condition,
      ].filter(Boolean).join(' · ') || null;

    case 'IMAGE_UPLOADED':
      return t('traceability.details.imageType', { type: m.image_type ?? 'COLLECTION' });

    case 'PRICE_ESTIMATED':
      return [
        m.estimated_value != null ? fmtRupees(m.estimated_value) : null,
        m.approx_weight_kg ? `${m.approx_weight_kg} kg` : null,
        m.location,
      ].filter(Boolean).join(' · ') || null;

    case 'RECYCLER_MATCHED':
      return m.recycler_name ?? null;

    case 'QUOTE_RECEIVED':
      return m.offered_price != null
        ? `${fmtRupees(m.offered_price)}${m.recycler_name ? ` — ${m.recycler_name}` : ''}`
        : null;

    case 'QUOTE_ACCEPTED':
      return m.offered_price != null
        ? `${fmtRupees(m.offered_price)}${m.recycler_name ? ` — ${m.recycler_name}` : ''}`
        : null;

    case 'QR_SCANNED':
      return [
        m.handover_reference_number,
        m.recycler_name,
      ].filter(Boolean).join(' · ') || null;

    case 'LOT_VERIFIED':
      return m.recycler_name ?? null;

    case 'FINAL_WEIGHT_RECORDED':
      return [
        m.final_weight_kg != null ? `${m.final_weight_kg} kg` : null,
        m.approx_weight_kg != null ? `(${t('traceability.details.estimated')}: ${m.approx_weight_kg} kg)` : null,
        m.scan_verified ? t('traceability.details.qrVerified') : null,
      ].filter(Boolean).join(' · ') || null;

    case 'HANDOVER_PHOTO':
      return m.image_type
        ? t('traceability.details.imageType', { type: m.image_type })
        : m.photo_count != null
          ? t('traceability.details.photoCount', { count: m.photo_count })
          : null;

    case 'GPS_CAPTURED':
      return m.latitude != null && m.longitude != null
        ? `${Number(m.latitude).toFixed(4)}, ${Number(m.longitude).toFixed(4)}`
        : null;

    case 'HANDOVER_CONFIRMED':
      return [
        m.final_weight_kg != null ? `${m.final_weight_kg} kg` : null,
        m.handover_reference_number,
      ].filter(Boolean).join(' · ') || null;

    case 'PAYMENT_COMPLETED': {
      const parts = [];
      if (m.amount != null) parts.push(fmtRupees(m.amount));
      if (m.payment_method) parts.push(m.payment_method.toUpperCase());
      return parts.length ? parts.join(' · ') : null;
    }

    default:
      return null;
  }
}

/**
 * Pick the image to render inline with a photo-type event.
 * IMAGE_UPLOADED events → find the COLLECTION image
 * HANDOVER_PHOTO events → find the HANDOVER or RECYCLER_CONFIRMATION image
 */
function pickPhoto(event, images) {
  if (!images?.length) return null;
  const meta = event.metadata ?? {};

  if (event.event_type === 'IMAGE_UPLOADED') {
    const imgType = meta.image_type ?? 'COLLECTION';
    return images.find(img => img.image_type === imgType)?.image_url ?? null;
  }

  if (event.event_type === 'HANDOVER_PHOTO') {
    const imgType = meta.image_type ?? 'HANDOVER';
    // Find the image uploaded closest to this event's timestamp
    return images.find(img => img.image_type === imgType)?.image_url ?? null;
  }

  return null;
}

// ── Timeline Event component ──────────────────────────────────────────────────
function TraceEvent({ event, images, isLast, t, lang }) {
  const meta = EVENT_META[event.event_type] ?? {
    icon: '•', labelKey: null, colour: 'grey',
  };

  const label = meta.labelKey ? t(meta.labelKey) : event.event_type.replace(/_/g, ' ');
  const detail = buildDetail(event.event_type, event.metadata, t);
  const photoUrl = meta.hasPhoto ? pickPhoto(event, images) : null;
  const timestamp = fmtDate(event.occurred_at, lang);
  const hasGps = event.latitude != null && event.longitude != null;

  return (
    <li className={`trace-event trace-event--done${isLast ? ' trace-event--last' : ''}`}>
      <div className="trace-event__line" aria-hidden="true" />
      <div className={`trace-event__dot trace-event__dot--${meta.colour}`} aria-hidden="true">
        <span>{meta.icon}</span>
      </div>

      <div className="trace-event__body">
        <p className="trace-event__label">{label}</p>

        {detail && (
          <p className="trace-event__detail">{detail}</p>
        )}

        {/* Actor */}
        {event.actor_name && event.actor_role !== 'system' && (
          <p className="trace-event__actor">
            {event.actor_role === 'collector' ? '👤' : '🏭'} {event.actor_name}
          </p>
        )}

        {/* GPS coordinates */}
        {hasGps && (
          <p className="trace-event__gps">
            📍 {Number(event.latitude).toFixed(4)}, {Number(event.longitude).toFixed(4)}
          </p>
        )}

        {/* Inline photo evidence */}
        {photoUrl && (
          <figure className="trace-event__photo">
            <img
              src={photoUrl}
              alt={label}
              loading="lazy"
            />
            <figcaption className="text-muted text-xs">{t('verify.collectionPhotoLabel')}</figcaption>
          </figure>
        )}

        {timestamp && (
          <p className="trace-event__timestamp">{timestamp}</p>
        )}
      </div>
    </li>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function CollectorTraceability() {
  const { lotId } = useParams();
  const { t, lang } = useTranslation();

  const [data, setData] = useState(null);   // { lot, events, images }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await getLotEvents(lotId);
      setData(res.data ?? res);
    } catch (err) {
      setError(err.message || t('lotDetail.loadError'));
    } finally {
      setLoading(false);
    }
  }, [lotId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  const lot = data?.lot ?? null;
  const events = data?.events ?? [];
  const images = data?.images ?? [];

  // Lot summary values
  const paymentEvent = events.find(e => e.event_type === 'PAYMENT_COMPLETED');
  const weightEvent = events.find(e => e.event_type === 'FINAL_WEIGHT_RECORDED');
  const finalWeight = weightEvent?.metadata?.final_weight_kg ?? lot?.approx_weight_kg;
  const paidAmount = paymentEvent?.metadata?.amount ?? lot?.final_price;

  if (loading) return <div className="container"><PageLoader /></div>;

  return (
    <div className="container">
      {/* Header */}
      <div className="animate-fade-in" style={{ marginBottom: 'var(--space-6)' }}>
        <Link to={`/collector/lots/${lotId}`} className="back-link">
          {t('common.back')}
        </Link>
        <div style={{ marginTop: 'var(--space-3)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
          <div>
            <h1 className="section-title">{t('traceability.title')}</h1>
            {/* Prefer the human-readable display ID; fall back to internal lot_id */}
            <p className="section-subtitle font-mono">
              {lot?.display_lot_id ?? lotId}
            </p>
          </div>
          {lot?.transaction_status && (
            <StatusBadge status={lot.transaction_status} size="md" />
          )}
        </div>
      </div>

      {error && (
        <div className="alert-banner alert-banner--warn animate-fade-in" role="alert">
          ⚠ {error}
          <button className="btn btn-ghost btn-sm" onClick={load} style={{ marginLeft: 'auto' }}>
            {t('common.retry')}
          </button>
        </div>
      )}

      {!lot && !loading ? (
        <div className="empty-state card">
          <p style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-semibold)' }}>
            {t('lotDetail.loadError')}
          </p>
          <Link to="/collector" className="btn btn-primary">{t('common.back')}</Link>
        </div>
      ) : lot ? (
        <div className="trace-layout">

          {/* ── Full lifecycle event timeline ─────────────────────────────── */}
          <section className="card animate-scale-in" aria-labelledby="trace-heading">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-5)', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
              <h2 id="trace-heading" className="detail-section-title" style={{ marginBottom: 0 }}>
                {t('traceability.lifecycle')}
              </h2>
              <span className="checklist-count">
                {events.length} {t('traceability.eventCount', { count: events.length })}
              </span>
            </div>

            {events.length === 0 ? (
              <div className="empty-state">
                <p>{t('traceability.noEvents')}</p>
              </div>
            ) : (
              <ol className="trace-timeline" aria-label={t('traceability.lifecycle')}>
                {events.map((event, idx) => (
                  <TraceEvent
                    key={event.id ?? idx}
                    event={event}
                    images={images}
                    isLast={idx === events.length - 1}
                    t={t}
                    lang={lang}
                  />
                ))}
              </ol>
            )}
          </section>

          {/* ── Evidence photo chain ─────────────────────────────────────── */}
          {images.length > 0 && (
            <section className="card animate-fade-in" aria-labelledby="photos-heading">
              <h2 id="photos-heading" className="detail-section-title">
                {t('traceability.photoEvidence')}
              </h2>
              <p className="text-muted text-sm" style={{ marginBottom: 'var(--space-4)' }}>
                {t('traceability.photoEvidenceDesc')}
              </p>
              <div className="trace-photo-grid">
                {images.map((img) => (
                  <figure key={img.id} className="trace-photo-item">
                    <img
                      src={img.image_url}
                      alt={img.image_type}
                      loading="lazy"
                    />
                    <figcaption>
                      <span className={`trace-photo-badge trace-photo-badge--${img.image_type.toLowerCase()}`}>
                        {img.image_type.replace(/_/g, ' ')}
                      </span>
                      {img.uploader_name && (
                        <span className="text-muted text-xs"> · {img.uploader_name}</span>
                      )}
                      {img.uploaded_at && (
                        <span className="text-muted text-xs"> · {fmtDate(img.uploaded_at, lang)}</span>
                      )}
                    </figcaption>
                  </figure>
                ))}
              </div>
            </section>
          )}

          {/* ── Lot summary ───────────────────────────────────────────────── */}
          <section className="card animate-fade-in" aria-labelledby="trace-summary-heading">
            <h2 id="trace-summary-heading" className="detail-section-title">{t('common.summary')}</h2>
            <div className="detail-grid">
              <div className="detail-item">
                <p className="detail-item__label">{t('common.lotId')}</p>
                <p className="detail-item__value font-mono" style={{ fontSize: 'var(--text-sm)' }}>
                  {lot.display_lot_id ?? lotId}
                </p>
              </div>
              <div className="detail-item">
                <p className="detail-item__label">{t('lotDetail.category')}</p>
                <p className="detail-item__value">{lot.category}</p>
              </div>
              <div className="detail-item">
                <p className="detail-item__label">{t('verify.collectionWeight')}</p>
                <p className="detail-item__value">{lot.approx_weight_kg ?? '—'} {t('common.kg')}</p>
              </div>
              {finalWeight != null && finalWeight !== lot.approx_weight_kg && (
                <div className="detail-item">
                  <p className="detail-item__label">{t('verify.finalWeight')}</p>
                  <p className="detail-item__value" style={{ color: 'var(--color-accent)' }}>
                    {finalWeight} {t('common.kg')}
                  </p>
                </div>
              )}
              <div className="detail-item">
                <p className="detail-item__label">{t('lotDetail.estimatedValue')}</p>
                <p className="detail-item__value">{fmtRupees(lot.estimated_value) ?? '—'}</p>
              </div>
              {paidAmount != null && (
                <div className="detail-item">
                  <p className="detail-item__label">{t('lotDetail.payFinalPrice')}</p>
                  <p className="detail-item__value" style={{ color: 'var(--color-accent)', fontWeight: 'var(--weight-bold)' }}>
                    {fmtRupees(paidAmount)}
                  </p>
                </div>
              )}
              <div className="detail-item">
                <p className="detail-item__label">{t('lotDetail.status')}</p>
                <StatusBadge status={lot.transaction_status || 'quoted'} />
              </div>
              {lot.recycler_name && (
                <div className="detail-item">
                  <p className="detail-item__label">{t('lotDetail.recycler')}</p>
                  <p className="detail-item__value">{lot.recycler_name}</p>
                </div>
              )}
              {lot.collection_location && (
                <div className="detail-item">
                  <p className="detail-item__label">{t('verify.collectionLocation')}</p>
                  <p className="detail-item__value">{lot.collection_location}</p>
                </div>
              )}
              {(lot.collection_lat != null && lot.collection_lng != null) && (
                <div className="detail-item">
                  <p className="detail-item__label">{t('verify.collectionGps')}</p>
                  <p className="detail-item__value" style={{ fontSize: 'var(--text-sm)' }}>
                    📍 {Number(lot.collection_lat).toFixed(4)}, {Number(lot.collection_lng).toFixed(4)}
                  </p>
                </div>
              )}
            </div>
          </section>

        </div>
      ) : null}
    </div>
  );
}
