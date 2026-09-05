import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  getLotsByCollector,
  getHandoversByLot,
  getOffersByLot,
  getLotEvents,
  getLotImages,
  acceptOffer,
  rejectOffer,
  DEMO_COLLECTOR_ID,
} from '../api/client';
import { currentCollectorId } from '../services/auth';
import { StatusBadge } from '../components/StatusBadge';
import LotQR from '../components/LotQR';
import { PageLoader } from '../components/LoadingSpinner';
import { useTranslation } from '../i18n/config.js';
import './LotDetail.css';

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  });
}

function fmt(n) {
  if (n == null) return '—';
  return `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

export default function CollectorLotDetail() {
  const { lotId } = useParams();
  const { t } = useTranslation();

  // Lot metadata comes from the collector lots endpoint
  const [lot, setLot] = useState(null);
  const [handovers, setHandovers] = useState([]);
  const [offers, setOffers] = useState([]);
  const [lotEventTypes, setLotEventTypes] = useState(new Set()); // set of fired event_type strings
  const [lotImages, setLotImages] = useState([]);
  const [offerBusy, setOfferBusy] = useState(null);
  const [offersError, setOffersError] = useState('');
  const [quoteToast, setQuoteToast] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const collectorId = currentCollectorId() ?? DEMO_COLLECTOR_ID;
      const [lotsRes, handoversRes, offersRes, eventsRes, imagesRes] = await Promise.all([
        getLotsByCollector(collectorId),
        getHandoversByLot(lotId),
        getOffersByLot(lotId),
        getLotEvents(lotId).catch(() => null), // non-blocking — events table may not exist yet
        getLotImages(lotId).catch(() => ({ data: [] })),
      ]);

      const allLots = Array.isArray(lotsRes.data) ? lotsRes.data : [];
      const foundLot = allLots.find(l => l.lot_id === lotId) ?? null;
      setLot(foundLot);
      setHandovers(Array.isArray(handoversRes.data) ? handoversRes.data : []);
      setOffers(Array.isArray(offersRes.data) ? offersRes.data : []);
      setLotImages(Array.isArray(imagesRes.data) ? imagesRes.data : []);

      // Build a set of event types that have actually fired, for the checklist
      const evData = eventsRes?.data ?? eventsRes;
      const fired = Array.isArray(evData?.events) ? evData.events : [];
      setLotEventTypes(new Set(fired.map(e => e.event_type)));
    } catch {
      setError(t('lotDetail.loadError'));
    } finally {
      setLoading(false);
    }
  }, [lotId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  const latestHandover = handovers[0] ?? null;
  const acceptedOffer = offers.find(o => o.offer_status === 'accepted') ?? null;
  const openOffers = offers.filter(o => o.offer_status === 'offered');
  const collectionImages = lotImages.filter((image) => image.image_type === 'COLLECTION');
  const confirmationImages = lotImages.filter((image) => image.image_type === 'RECYCLER_CONFIRMATION');

  // ── Handover checklist ────────────────────────────────────────────────────
  // Each step is satisfied by either a lot_events entry (preferred — direct
  // evidence) or a fallback inference from lot/handover status fields (for
  // lots created before the events table existed).
  const ev = lotEventTypes; // Set<string>
  const checklist = [
    {
      key: 'collection',
      label: t('checklist.collection'),
      done: ev.has('LOT_CREATED') || Boolean(lot?.created_at),
    },
    {
      key: 'photo',
      label: t('checklist.photo'),
      done: ev.has('IMAGE_UPLOADED') || Boolean(lot?.image_ref),
    },
    {
      key: 'priceEstimated',
      label: t('checklist.priceEstimated'),
      done: ev.has('PRICE_ESTIMATED') || lot?.estimated_value != null,
    },
    {
      key: 'matched',
      label: t('checklist.matched'),
      done: ev.has('RECYCLER_MATCHED') || ['matched', 'accepted', 'handed_over', 'confirmed'].includes(lot?.transaction_status),
    },
    {
      key: 'quoteAccepted',
      label: t('checklist.quoteAccepted'),
      done: ev.has('QUOTE_ACCEPTED') || acceptedOffer !== null,
    },
    {
      key: 'qrScanned',
      label: t('checklist.qrScanned'),
      done: ev.has('QR_SCANNED') || latestHandover?.scan_verified === true,
    },
    {
      key: 'weightVerified',
      label: t('checklist.weightVerified'),
      done: ev.has('FINAL_WEIGHT_RECORDED') || latestHandover?.weight_kg != null,
    },
    {
      key: 'handover',
      label: t('checklist.handover'),
      done: ev.has('HANDOVER_CONFIRMED') || Boolean(latestHandover?.handover_reference_number || latestHandover?.handover_reference),
    },
    {
      key: 'recyclerConfirmed',
      label: t('checklist.recyclerConfirmed'),
      done: ev.has('HANDOVER_CONFIRMED') || latestHandover?.status === 'confirmed',
    },
    {
      key: 'payment',
      label: t('checklist.payment'),
      done: ev.has('PAYMENT_COMPLETED') || lot?.payment_status === 'paid',
    },
  ];
  const checklistDone = checklist.filter((c) => c.done).length;

  async function handleOfferAction(offerId, decision) {
    setOfferBusy(offerId);
    setQuoteToast('');
    setOffersError('');
    try {
      if (decision === 'accept') {
        await acceptOffer(offerId);
        setQuoteToast(t('quotes.accepted'));
      } else {
        await rejectOffer(offerId);
        setQuoteToast(t('quotes.rejected'));
      }
      load();
      setTimeout(() => setQuoteToast(''), 4500);
    } catch (err) {
      setOffersError(err.message || t('quotes.actionFail'));
    } finally {
      setOfferBusy(null);
    }
  }

  function getCurrentStep() {
    if (latestHandover?.status === 'confirmed') return 4;
    if (latestHandover?.handover_reference_number) return 3;
    if (lot?.transaction_status === 'matched' || lot?.transaction_status === 'accepted') return 2;
    if (lot?.estimated_value != null) return 1;
    return 0;
  }

  const currentStep = lot ? getCurrentStep() : -1;

  const TIMELINE_STEPS = [
    {
      label: t('traceability.created'),
      sub: lot ? `${fmtDate(lot.created_at)}` : '',
      icon: '',
    },
    {
      label: t('createLot.valuation.instantEstimate'),
      sub: lot?.estimated_value ? `${t('lotDetail.estimatedValue')}: ${fmt(lot.estimated_value)}` : t('common.noData'),
      icon: '₹',
    },
    {
      label: t('traceability.matched'),
      sub: latestHandover?.recycler_name || lot?.recycler_name || t('status.pending'),
      icon: '',
    },
    {
      label: t('traceability.handoverInitiated'),
      sub: (latestHandover?.handover_reference_number || latestHandover?.handover_reference)
        ? `${t('lotDetail.handoverRef')}: ${latestHandover.handover_reference_number || latestHandover.handover_reference}`
        : t('lotDetail.noHandover'),
      icon: '',
    },
    {
      label: t('traceability.handoverConfirmed'),
      sub: latestHandover?.confirmation_timestamp
        ? fmtDate(latestHandover.confirmation_timestamp)
        : t('status.pending'),
      icon: '',
    },
  ];

  if (loading) return <div className="container"><PageLoader /></div>;

  return (
    <div className="container">
      {/* Header */}
      <div className="animate-fade-in" style={{ marginBottom: 'var(--space-6)' }}>
        <Link to="/collector" className="back-link">{t('common.back')}</Link>
        <div style={{ marginTop: 'var(--space-3)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
          <div>
            <h1 className="section-title">{t('lotDetail.title')}</h1>
            <p className="section-subtitle font-mono">{lotId}</p>
          </div>
          {lot?.transaction_status && (
            <StatusBadge status={lot.transaction_status} size="md" />
          )}
        </div>
      </div>

      {error && (
        <div className="alert-banner alert-banner--warn animate-fade-in" role="alert">
          {error}
          <button className="btn btn-ghost btn-sm" onClick={load} style={{ marginLeft: 'auto' }}>
            {t('common.retry')}
          </button>
        </div>
      )}

      {quoteToast && (
        <div className="alert-banner alert-banner--success animate-fade-in" role="status">
          {quoteToast}
        </div>
      )}

      {offersError && (
        <div className="alert-banner alert-banner--warn animate-fade-in" role="alert">
          {offersError}
        </div>
      )}

      {!lot && !loading ? (
        <div className="empty-state card">

          <p style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-semibold)' }}>
            {t('lotDetail.loadError')}
          </p>
          <p>{t('common.noData')}</p>
          <Link to="/collector/create-lot" className="btn btn-primary">{t('dashboard.createFirstLot')}</Link>
        </div>
      ) : lot ? (
        <div className="cdash-layout">

          {/* Lot QR — the recycler scans this at pickup to verify & confirm the lot */}
          <section className="card animate-scale-in" aria-labelledby="collector-qr-heading">
            <div className="collector-qr-row">
              <LotQR value={lotId} />
              <div>
                <h2 id="collector-qr-heading" className="detail-section-title">{t('checklist.qrTitle')}</h2>
                <p className="text-muted text-sm" style={{ margin: 'var(--space-2) 0 0' }}>
                  {t('checklist.qrDesc')}
                </p>
              </div>
            </div>
          </section>

          {/* Handover checklist — live progress of the physical pickup flow */}
          <section className="card animate-scale-in" aria-labelledby="checklist-heading">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-4)', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
              <h2 id="checklist-heading" className="detail-section-title" style={{ marginBottom: 0 }}>
                {t('checklist.title')}
              </h2>
              <span className="checklist-count">
                {t('checklist.progress', { done: checklistDone, total: checklist.length })}
              </span>
            </div>
            <ol className="checklist">
              {checklist.map((c) => (
                <li key={c.key} className={`checklist-step ${c.done ? 'checklist-step--done' : ''}`}>
                  <span className="checklist-step__dot" aria-hidden="true">{c.done ? '\u2713' : ''}</span>
                  <span className="checklist-step__label">{c.label}</span>
                </li>
              ))}
            </ol>
            {checklistDone === checklist.length && (
              <div className="confirmed-banner" role="status" style={{ marginTop: 'var(--space-4)' }}>
                {t('checklist.complete')}
              </div>
            )}
          </section>

          {/* Lot Info Card */}
          <section className="card animate-scale-in" aria-labelledby="lot-info-heading">
            <h2 id="lot-info-heading" className="detail-section-title">{t('lotDetail.title')}</h2>
            <div className="detail-grid">
              <div className="detail-item">
                <p className="detail-item__label">{t('lotDetail.category')}</p>
                <p className="detail-item__value">{lot.category}</p>
              </div>
              {lot.sub_category && (
                <div className="detail-item">
                  <p className="detail-item__label">{t('lotDetail.subCategory')}</p>
                  <p className="detail-item__value">{lot.sub_category}</p>
                </div>
              )}
              <div className="detail-item">
                <p className="detail-item__label">{t('lotDetail.weight')}</p>
                <div>
                  <p className="detail-item__value">{lot.approx_weight_kg ?? '—'} {t('common.kg')}</p>
                  {latestHandover?.weight_kg != null && Number(latestHandover.weight_kg) !== Number(lot.approx_weight_kg) && (
                    <p className="detail-item__delta">
                      Final: {latestHandover.weight_kg} {t('common.kg')}
                      ({Number(latestHandover.weight_kg) > Number(lot.approx_weight_kg) ? '+' : ''}
                      {(Number(latestHandover.weight_kg) - Number(lot.approx_weight_kg)).toFixed(1)} {t('common.kg')})
                    </p>
                  )}
                </div>
              </div>
              <div className="detail-item">
                <p className="detail-item__label">{t('lotDetail.estimatedValue')}</p>
                <p className="detail-item__value" style={{ color: 'var(--color-accent)' }}>
                  {fmt(lot.estimated_value)}
                </p>
              </div>
              <div className="detail-item">
                <p className="detail-item__label">{t('lotDetail.status')}</p>
                <StatusBadge status={lot.transaction_status || 'quoted'} />
              </div>
              <div className="detail-item">
                <p className="detail-item__label">{t('earnings.filterPaid')}</p>
                <StatusBadge status={lot.payment_status || 'pending'} />
              </div>
              {lot.payment_status === 'paid' && latestHandover?.final_price != null && (
                <div className="detail-item">
                  <p className="detail-item__label">{t('lotDetail.payFinalPrice')}</p>
                  <p className="detail-item__value" style={{ color: 'var(--color-accent)', fontWeight: 'var(--weight-bold)' }}>
                    {fmt(latestHandover.final_price)}
                  </p>
                </div>
              )}
              {lot.payment_status === 'paid' && latestHandover?.payment_method && (
                <div className="detail-item">
                  <p className="detail-item__label">{t('lotDetail.payMethod')}</p>
                  <p className="detail-item__value">{t(`lotDetail.payMethods.${latestHandover.payment_method}`)}</p>
                </div>
              )}
              {lot.recycler_name && (
                <div className="detail-item">
                  <p className="detail-item__label">{t('recyclerDash.incomingLots')}</p>
                  <p className="detail-item__value">{lot.recycler_name}</p>
                </div>
              )}
              <div className="detail-item">
                <p className="detail-item__label">{t('lotDetail.createdAt')}</p>
                <p className="detail-item__value" style={{ fontSize: 'var(--text-sm)' }}>
                  {fmtDate(lot.created_at)}
                </p>
              </div>
            </div>
            {collectionImages.length > 0 ? (
              <section className="collection-evidence" aria-label="Collection photo evidence">
                <p className="detail-item__label">Collection photos ({collectionImages.length})</p>
                <div className="collection-evidence__grid">
                  {collectionImages.map((image, index) => (
                    <figure key={image.id} className="collection-photo">
                      <img src={image.image_url} alt={`Collection evidence photo ${index + 1}`} loading="lazy" />
                      <figcaption className="text-muted text-sm">Collection photo {index + 1}</figcaption>
                    </figure>
                  ))}
                </div>
              </section>
            ) : lot.image_ref && (
              <figure className="collection-photo" style={{ marginTop: 'var(--space-4)' }}>
                <img src={lot.image_ref} alt={t('verify.collectionPhotoAlt')} />
                <figcaption className="text-muted text-sm">{t('verify.collectionPhotoLabel')}</figcaption>
              </figure>
            )}
          </section>

          {/* Quotes / marketplace card */}
          <section className="card animate-scale-in" aria-labelledby="quotes-heading">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-4)', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
              <h2 id="quotes-heading" className="detail-section-title" style={{ marginBottom: 0 }}>
                {t('quotes.title')}
              </h2>
              {acceptedOffer && <StatusBadge status="accepted" size="md" />}
            </div>

            {acceptedOffer ? (
              <div className="confirmed-banner" role="status">
                {t('quotes.acceptedBanner', {
                  recycler: acceptedOffer.recycler_name,
                  price: fmt(acceptedOffer.offered_price),
                })}
              </div>
            ) : openOffers.length > 0 ? (
              <>
                <ul className="quote-list">
                  {openOffers.map((o) => (
                    <li key={o.id} className="quote-item">
                      <div className="quote-item__main">
                        <div className="quote-item__name">{o.recycler_name}</div>
                        <div className="quote-item__status">
                          <strong>{fmt(o.offered_price)}</strong> {t('quotes.totalOffer')}
                        </div>
                      </div>
                      <div className="quote-item__actions">
                        <button
                          className="btn btn-accent btn-sm"
                          disabled={!!offerBusy}
                          onClick={() => handleOfferAction(o.id, 'accept')}
                          aria-busy={offerBusy === o.id}
                        >
                          {t('quotes.accept')}
                        </button>
                        <button
                          className="btn btn-outline btn-sm"
                          disabled={!!offerBusy}
                          onClick={() => handleOfferAction(o.id, 'reject')}
                        >
                          {t('quotes.reject')}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            ) : lot?.transaction_status === 'quoted' ? (
              <div>
                <p className="quote-section__empty">{t('quotes.noQuotesYet')}</p>
                <Link
                  to="/collector/matched-recyclers"
                  state={{ category: lot.category, lotId: lot.lot_id }}
                  className="btn btn-primary"
                  style={{ marginTop: 'var(--space-4)' }}
                >
                  {t('quotes.requestPage')}
                </Link>
              </div>
            ) : (
              <p className="quote-section__empty">{t('quotes.noQuotesYet')}</p>
            )}
          </section>

          {/* Traceability Timeline */}
          <section className="card animate-scale-in" aria-labelledby="trace-heading">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-5)', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
              <h2 id="trace-heading" className="detail-section-title" style={{ marginBottom: 0 }}>
                {t('traceability.title')}
              </h2>
              <Link
                to={`/collector/lots/${lotId}/trace`}
                className="btn btn-outline btn-sm"
                id={`trace-detail-${lotId}`}
              >
                {t('lotDetail.viewTraceability')} →
              </Link>
            </div>

            <div className="cdash-timeline" aria-label="Lot lifecycle timeline">
              {TIMELINE_STEPS.map((step, idx) => {
                const isDone = idx <= currentStep;
                const isCurrent = idx === currentStep;
                return (
                  <div
                    key={step.label}
                    className={`cdash-timeline-step ${isDone ? 'cdash-timeline-step--done' : ''} ${isCurrent ? 'cdash-timeline-step--current' : ''}`}
                  >
                    <div className="cdash-timeline-step__connector" />
                    <div className="cdash-timeline-step__dot" aria-hidden="true">
                      {isDone ? '' : step.icon}
                    </div>
                    <div className="cdash-timeline-step__content">
                      <p className="cdash-timeline-step__label">{step.label}</p>
                      <p className="cdash-timeline-step__sub">{step.sub}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Handover Reference Card — shown when a handover exists */}
          {(latestHandover?.handover_reference_number || latestHandover?.handover_reference) && (
            <section className="card animate-fade-in" aria-labelledby="handover-ref-heading">
              <h2 id="handover-ref-heading" className="detail-section-title">{t('lotDetail.handoverRef')}</h2>
              <div className="ref-display">
                <p className="ref-display__label">{t('lotDetail.handoverRef')}</p>
                <p className="ref-display__value font-mono">
                  {latestHandover.handover_reference_number || latestHandover.handover_reference}
                </p>
              </div>
              <div className="detail-grid" style={{ marginTop: 'var(--space-5)' }}>
                <div className="detail-item">
                  <p className="detail-item__label">{t('lotDetail.handoverStatus')}</p>
                  <StatusBadge status={latestHandover.status || 'pending_confirmation'} size="md" />
                </div>
                <div className="detail-item">
                  <p className="detail-item__label">{t('traceability.handoverInitiated')}</p>
                  <p className="detail-item__value" style={{ fontSize: 'var(--text-sm)' }}>
                    {fmtDate(latestHandover.event_timestamp)}
                  </p>
                </div>
                {latestHandover.confirmation_timestamp && (
                  <div className="detail-item">
                    <p className="detail-item__label">{t('traceability.handoverConfirmed')}</p>
                    <p className="detail-item__value" style={{ fontSize: 'var(--text-sm)' }}>
                      {fmtDate(latestHandover.confirmation_timestamp)}
                    </p>
                  </div>
                )}
                {latestHandover.weight_kg != null && (
                  <div className="detail-item">
                    <p className="detail-item__label">{t('lotDetail.weight')}</p>
                    <p className="detail-item__value">{latestHandover.weight_kg} {t('common.kg')}</p>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Digital handover record — shown to collector once recycler confirms */}
          {latestHandover?.status === 'confirmed' && (
            <section className="card animate-scale-in" aria-labelledby="collector-record-heading">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-4)', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
                <h2 id="collector-record-heading" className="detail-section-title" style={{ marginBottom: 0 }}>
                  {t('verify.recordTitle')}
                </h2>
                <StatusBadge status="confirmed" size="md" />
              </div>
              <div className="detail-grid">
                <div className="detail-item">
                  <p className="detail-item__label">{t('traceability.details.ref')}</p>
                  <p className="detail-item__value font-mono" style={{ fontSize: 'var(--text-sm)' }}>
                    {latestHandover.handover_reference_number || latestHandover.handover_reference}
                  </p>
                </div>
                <div className="detail-item">
                  <p className="detail-item__label">{t('verify.collectionWeight')}</p>
                  <p className="detail-item__value">{latestHandover.approx_weight_kg ?? '—'} {t('common.kg')}</p>
                </div>
                <div className="detail-item">
                  <p className="detail-item__label">{t('verify.finalWeight')}</p>
                  <p className="detail-item__value">{latestHandover.weight_kg ?? '—'} {t('common.kg')}</p>
                </div>
                <div className="detail-item">
                  <p className="detail-item__label">{t('verify.timestamp')}</p>
                  <p className="detail-item__value" style={{ fontSize: 'var(--text-sm)' }}>
                    {fmtDate(latestHandover.confirmed_at || latestHandover.confirmation_timestamp)}
                  </p>
                </div>
                <div className="detail-item">
                  <p className="detail-item__label">GPS</p>
                  <p className="detail-item__value" style={{ fontSize: 'var(--text-sm)' }}>
                    {latestHandover.gps_lat != null && latestHandover.gps_lng != null
                      ? `${Number(latestHandover.gps_lat).toFixed(4)}, ${Number(latestHandover.gps_lng).toFixed(4)}`
                      : t('verify.notRecorded')}
                  </p>
                </div>
                <div className="detail-item">
                  <p className="detail-item__label">{t('verify.qrScanLabel')}</p>
                  <p className="detail-item__value">
                    {latestHandover.scan_verified ? ` ${t('verify.qrScanned')}` : t('verify.qrManual')}
                  </p>
                </div>
                <div className="detail-item">
                  <p className="detail-item__label">{t('verify.photoLabel')}</p>
                  {confirmationImages.length > 0 ? (
                    <img
                      src={confirmationImages[confirmationImages.length - 1].image_url}
                      alt={t('verify.photoCapturedAlt')}
                      className="verify-photo-preview verify-photo-preview--lg"
                    />
                  ) : (
                    <p className="detail-item__value">{t('verify.notRecorded')}</p>
                  )}
                </div>
              </div>
              <div className="confirmed-banner" role="status" style={{ marginTop: 'var(--space-4)' }}>
                {t('verify.recordComplete')}
              </div>
            </section>
          )}

          {/* No handover yet — prompt collector to initiate */}
          {handovers.length === 0 && lot?.transaction_status === 'quoted' && (
            <div className="empty-state card animate-fade-in">

              <p style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-semibold)' }}>
                {t('lotDetail.noHandover')}
              </p>
              <p>{t('recyclers.noMatchDesc')}</p>
              <Link
                to="/collector/matched-recyclers"
                state={{ category: lot.category, lotId: lot.lot_id }}
                className="btn btn-primary"
              >
                {t('recyclers.title')}
              </Link>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
