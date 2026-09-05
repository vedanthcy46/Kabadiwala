import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  getHandoversByLot, initiateHandover, confirmHandover,
  updatePayment, checkTransactionAnomaly,
  getOffersByLot, getLotsByRecycler, getLotImages, getInstantValuation, quoteLot,
} from '../api/client';
import { resolveRecyclerId } from '../services/auth';
import { StatusBadge } from '../components/StatusBadge';
import LotQR from '../components/LotQR';
import { PageLoader, LoadingSpinner } from '../components/LoadingSpinner';
import { useTranslation } from '../i18n/config.js';
import './LotDetail.css';

function fmtDate(d, lang) {
  if (!d) return '—';
  const locale = lang === 'hi' ? 'hi-IN' : lang === 'mr' ? 'mr-IN' : 'en-IN';
  return new Date(d).toLocaleString(locale, {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  });
}

// Map backend traceability status to timeline step index
function statusToStep(status) {
  if (status === 'confirmed') return 2;
  if (status === 'pending_confirmation') return 1;
  return 0;
}

// Was this handover confirmed through a QR physical→digital scan?
function hasScanEvidence(h) {
  return Boolean(
    h?.scan_verified
    || h?.confirmed_at
    || (Array.isArray(h.photo_refs) && h.photo_refs.some((p) => typeof p === 'string' && p.startsWith('data:image'))),
  );
}

// Original collection photograph — the immutable evidence the recycler compares
// against the physical material (per the SIH image-lifecycle spec).
function collectionImgUrl(h) {
  const cand = h?.collection_image || h?.image_ref;
  if (!cand) return null;
  return cand;
}

export default function LotDetail() {
  const { lotId } = useParams();
  const { t, lang } = useTranslation();
  const [handovers, setHandovers] = useState([]);
  const [lotMeta, setLotMeta] = useState(null);
  const [offers, setOffers] = useState([]);
  const [lotImages, setLotImages] = useState([]);
  const [marketEstimate, setMarketEstimate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(null); // reference being confirmed
  const [startingPickup, setStartingPickup] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Quote form state
  const [quotePrice, setQuotePrice] = useState('');
  const [quoting, setQuoting] = useState(false);
  const [quoteMsg, setQuoteMsg] = useState('');
  const recyclerId = resolveRecyclerId();

  // Payment recording (PS: cash / UPI / bank are all valid)
  const [payPrice, setPayPrice] = useState('');
  const [payMethod, setPayMethod] = useState('cash');
  const [payChecking, setPayChecking] = useState(false);
  const [payAnomaly, setPayAnomaly] = useState(null);
  const [updatingPay, setUpdatingPay] = useState(false);
  const anomalyTimer = useRef(null);

  // Physical→digital verification (QR scan bridge on handover)
  const [finalWeight, setFinalWeight] = useState('');
  const [verifyPhoto, setVerifyPhoto] = useState(null);
  const [gps, setGps] = useState(null);
  const [gpsState, setGpsState] = useState('idle'); // idle | locating | ok | unavailable

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    // Backend endpoints:
    //  - GET /v1/handover/lot/:lotId → traceability records for this lot
    //  - GET /v1/handover/lots/recycler/:recyclerId → lot meta + open offer
    //  - GET /v1/quotes/lot/:lotId → offers on this lot
    Promise.all([
      getHandoversByLot(lotId),
      getLotsByRecycler(recyclerId),
      getOffersByLot(lotId),
      getLotImages(lotId),
    ])
      .then(([handRes, lotsRes, offersRes, imagesRes]) => {
        setHandovers(Array.isArray(handRes.data) ? handRes.data : []);
        const allLots = Array.isArray(lotsRes.data) ? lotsRes.data : [];
        setLotMeta(allLots.find((l) => l.lot_id === lotId) ?? null);
        setOffers(Array.isArray(offersRes.data) ? offersRes.data : []);
        setLotImages(Array.isArray(imagesRes.data) ? imagesRes.data : []);
      })
      .catch(() => setError(t('lotDetail.loadError')))
      .finally(() => setLoading(false));
  }, [lotId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  const myOffer = offers.find((o) => o.recycler_id === recyclerId) ?? null;
  const openOffer = myOffer && ['requested', 'offered'].includes(myOffer.offer_status)
    ? myOffer
    : (lotMeta?.open_offer_id && ['requested', 'offered'].includes(lotMeta.open_offer_status)
        ? { id: lotMeta.open_offer_id, offer_status: lotMeta.open_offer_status, offered_price: lotMeta.open_offer_price }
        : null);
  const acceptedOffer = myOffer?.offer_status === 'accepted' ? myOffer : null;
  const collectionImages = lotImages.filter((image) => image.image_type === 'COLLECTION');
  const confirmationImages = lotImages.filter((image) => image.image_type === 'RECYCLER_CONFIRMATION');

  // Prefill the quote with a live market estimate for the lot category/weight.
  useEffect(() => {
    if (openOffer?.offer_status === 'requested' && quotePrice === '' && !marketEstimate && lotMeta?.category) {
      getInstantValuation({
        category: lotMeta.category,
        location: lotMeta.collection_location || 'Bengaluru',
        weight: lotMeta.approx_weight_kg || 1,
      })
        .then((r) => {
          const est = Number(r?.data?.estimated_value ?? r?.data?.lot?.estimated_value ?? 0);
          if (est > 0) setMarketEstimate(est);
        })
        .catch(() => {});
    }
  }, [openOffer, quotePrice, marketEstimate, lotMeta]);

  async function handleSubmitQuote() {
    const price = Number(quotePrice);
    if (!price || price <= 0) { setError(t('quotes.validPrice')); return; }
    setQuoting(true);
    setError('');
    setQuoteMsg('');
    try {
      // Reuse the open request, then fill in the price
      await quoteLot({
        lotId,
        recyclerId: recyclerId,
        offeredPrice: price,
        existingOfferId: openOffer?.id,
      });
      setQuoteMsg(t('quotes.quoteSent'));
      load();
      setTimeout(() => setQuoteMsg(''), 4500);
    } catch (err) {
      setError(err.message || t('quotes.quoteSendFail'));
    } finally {
      setQuoting(false);
    }
  }

  async function handleConfirm(reference) {
    setConfirming(reference);
    setError('');
    setSuccess('');

    // Final weighed quantity — defaults to the immutable collection weight.
    const weight = Number(finalWeight) || (firstHandover?.approx_weight_kg != null ? Number(firstHandover.approx_weight_kg) : null);
    if (!weight || weight <= 0) {
      setError(t('verify.validWeight'));
      setConfirming(null);
      return;
    }

    try {
      // Backend: POST /v1/handover/confirm/:reference with verification evidence.
      // scan_verified marks the QR-scan physical→digital bridge.
      await confirmHandover(reference, {
        recycler_id: recyclerId,
        final_weight_kg: weight,
        gps_lat: gps?.lat ?? null,
        gps_lng: gps?.lng ?? null,
        verification_photo: verifyPhoto,
        scan_verified: true,
      });
      setSuccess(t('verify.confirmSuccess', { reference }));
      load(); // refresh to show confirmed state
    } catch (err) {
      setError(err.message || t('recyclerDash.profileUpdateFail').replace('save profile', 'confirm handover'));
    } finally {
      setConfirming(null);
    }
  }

  async function handleStartPickup() {
    if (!gps) {
      setError('Capture the handover location before starting pickup.');
      return;
    }
    if (!lotMeta?.collector_id) {
      setError('The collector record is unavailable. Refresh and try again.');
      return;
    }

    setStartingPickup(true);
    setError('');
    setSuccess('');
    try {
      await initiateHandover({
        lot_id: lotId,
        collector_id: lotMeta.collector_id,
        recycler_id: recyclerId,
        // This is the original estimate, not the final scale reading. The
        // latter is captured during the next confirmation step.
        weight_kg: Number(lotMeta.approx_weight_kg),
        gps_lat: gps.lat,
        gps_lng: gps.lng,
        handover_location: lotMeta.collection_location || 'Pickup location',
        photo_refs: [],
      });
      setSuccess('Pickup started. Record the final weight and handover photo to confirm receipt.');
      load();
    } catch (err) {
      setError(err.message || 'Could not start pickup.');
    } finally {
      setStartingPickup(false);
    }
  }

  function captureGps() {
    if (!navigator.geolocation) { setGpsState('unavailable'); return; }
    setGpsState('locating');
    setError('');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setGpsState('ok');
      },
      () => setGpsState('unavailable'),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }

  function handleVerifyPhoto(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setVerifyPhoto(reader.result);
    reader.readAsDataURL(file);
  }

  // Prefill final price from the quoted price once the lot loads.
  useEffect(() => {
    const first = handovers[0];
    if (first && first.payment_status === 'pending' && first.quoted_price != null && payPrice === '') {
      setPayPrice(String(Number(first.quoted_price).toFixed(2)));
    }
  }, [handovers, payPrice]);

  // AI/ML use case 4 (PS §11-D): flag unusual transaction values — compare the
  // entered final price against category stats + market range before recording.
  const runAnomalyCheck = useCallback(async (price, h) => {
    setPayChecking(true);
    setPayAnomaly(null);
    try {
      const res = await checkTransactionAnomaly({
        lot_id: lotId,
        material_category: h.category,
        quoted_price: h.quoted_price != null ? Number(h.quoted_price) : price,
        final_price: price,
        weight_kg: Number(h.weight_kg || 0),
        recycler_id: recyclerId,
        location: h.collection_location || undefined,
      });
      setPayAnomaly(res.data);
    } catch {
      setPayAnomaly(null);
    } finally {
      setPayChecking(false);
    }
  }, [lotId]);

  function handlePayPriceChange(val) {
    setPayPrice(val);
    const price = Number(val);
    const h = handovers[0];
    if (!price || price <= 0 || !h?.weight_kg) { setPayAnomaly(null); return; }
    clearTimeout(anomalyTimer.current);
    anomalyTimer.current = setTimeout(() => runAnomalyCheck(price, h), 450);
  }

  useEffect(() => () => clearTimeout(anomalyTimer.current), []);

  async function handleRecordPayment() {
    const price = Number(payPrice);
    if (!price || price <= 0) { setError(t('lotDetail.payInvalid')); return; }
    setUpdatingPay(true);
    setError('');
    setSuccess('');
    try {
      // Backend: PATCH /v1/payments/:lotId { payment_status, final_price, payment_method }
      await updatePayment(lotId, { payment_status: 'paid', final_price: price, payment_method: payMethod });
      setSuccess(t('lotDetail.paySuccess'));
      load();
    } catch (err) {
      setError(err.message || t('lotDetail.payFail'));
    } finally {
      setUpdatingPay(false);
    }
  }

  // Use first handover record to populate lot summary (category, weight from traceability)
  const firstHandover = handovers[0];
  const isHandoverConfirmed = handovers.some((h) => h.status === 'confirmed');
  const fmtRupees = (n) => (n == null ? '—' : `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`);

  const PAY_METHOD_ICONS = { cash: '₹', upi: 'UPI', bank_transfer: 'BANK' };

  return (
    <div className="container">
      <div className="animate-fade-in" style={{ marginBottom: 'var(--space-6)' }}>
        <Link to="/recycler?section=lots" className="back-link">{t('common.back')}</Link>
        <h1 className="section-title" style={{ marginTop: 'var(--space-3)' }}>
          {t('lotDetail.title')}
        </h1>
        <p className="section-subtitle font-mono">{lotId}</p>
      </div>

      {error && (
        <div className="alert-banner alert-banner--error animate-fade-in" role="alert">
           {error}
        </div>
      )}
      {success && (
        <div className="alert-banner alert-banner--success animate-fade-in" role="alert">
           {success}
        </div>
      )}
      {quoteMsg && (
        <div className="alert-banner alert-banner--success animate-fade-in" role="status">
          {quoteMsg}
        </div>
      )}

      {loading ? (
        <PageLoader />
      ) : handovers.length === 0 && !openOffer && !acceptedOffer ? (
        <div className="empty-state card">
          
          <p style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-semibold)' }}>
            {t('common.noData')}
          </p>
          <p>{t('traceability.events.awaitingMatch')}</p>
        </div>
      ) : (
        <div className="lot-detail-layout">
          {/* Quote marketplace card — shown when a quote request is open */}
          {openOffer && (
            <section className="card animate-scale-in" aria-labelledby="quote-heading">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-4)', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
                <h2 id="quote-heading" className="detail-section-title" style={{ marginBottom: 0 }}>
                  {t('quotes.submitTitle')}
                </h2>
                <StatusBadge status={openOffer.offer_status} size="md" />
              </div>

              {openOffer.offer_status === 'offered' ? (
                <div className="confirmed-banner" role="status">
                  {t('quotes.offeredBanner', {
                    price: fmtRupees(openOffer.offered_price),
                  })}
                </div>
              ) : (
                <>
                  <p className="quote-section__empty">{t('quotes.submitDesc')}</p>
                  <div className="form-group" style={{ marginTop: 'var(--space-4)' }}>
                    <label className="form-label" htmlFor="quote-price">{t('quotes.yourPrice')}</label>
                    <div className="pay-price-input">
                      <input
                        id="quote-price"
                        type="number"
                        min="0"
                        step="0.01"
                        className="form-input"
                        value={quotePrice}
                        onChange={(e) => setQuotePrice(e.target.value)}
                        aria-describedby="quote-price-hint"
                      />
                      <span className="weight-unit">₹</span>
                    </div>
                    {(marketEstimate || lotMeta?.estimated_value) && (
                      <p id="quote-price-hint" className="form-hint">
                        {t('quotes.marketEstimateHint', {
                          amount: fmtRupees(marketEstimate ?? lotMeta?.estimated_value),
                        })}
                      </p>
                    )}
                  </div>
                  <button
                    className="btn btn-accent btn-full"
                    onClick={handleSubmitQuote}
                    disabled={quoting}
                    aria-busy={quoting}
                  >
                    {quoting
                      ? <><LoadingSpinner size="sm" /> {t('common.loading')}…</>
                      : <> {t('quotes.submitQuote')}</>}
                  </button>
                </>
              )}
            </section>
          )}
          {/* Accepted quote — collector chose this recycler; waiting for handover */}
          {acceptedOffer && (
            <section className="card animate-scale-in" aria-labelledby="accepted-heading">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-4)', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
                <h2 id="accepted-heading" className="detail-section-title" style={{ marginBottom: 0 }}>
                  {t('quotes.accepted')}
                </h2>
                <StatusBadge status={acceptedOffer.offer_status} size="md" />
              </div>
              <div className="confirmed-banner" role="status">
                {t('quotes.acceptedBannerRecycler', {
                  price: fmtRupees(acceptedOffer.offered_price),
                })}
              </div>
              <p className="form-hint" style={{ marginTop: 'var(--space-3)' }}>
                {t('quotes.acceptedBannerRecyclerDesc')}
              </p>
            </section>
          )}
          {/* Accepted quote -> QR scan -> pickup. This is the explicit bridge
              that previously left accepted lots with no next action. */}
          {acceptedOffer && handovers.length === 0 && (
            <section className="card animate-scale-in" aria-labelledby="pickup-heading">
              <h2 id="pickup-heading" className="detail-section-title">Start QR-verified pickup</h2>
              <p className="form-hint" style={{ marginTop: 'var(--space-2)' }}>
                Compare the physical material with the collection photo, capture the pickup location, then start the handover record. Final weight and a fresh handover photo are recorded in the next step.
              </p>
              <div className="verify-photo-row" style={{ marginTop: 'var(--space-4)' }}>
                <button type="button" className="btn btn-outline" onClick={captureGps} disabled={gpsState === 'locating'}>
                  {gpsState === 'locating' ? 'Capturing location…' : gpsState === 'ok' ? 'Location captured' : 'Capture pickup location'}
                </button>
                {gpsState === 'ok' && (
                  <span className="verify-gps-ok">{Number(gps.lat).toFixed(4)}, {Number(gps.lng).toFixed(4)}</span>
                )}
                {gpsState === 'unavailable' && (
                  <span className="text-muted text-sm">Location is required to begin pickup. Enable location access and try again.</span>
                )}
              </div>
              <button
                className="btn btn-accent btn-full"
                style={{ marginTop: 'var(--space-4)' }}
                onClick={handleStartPickup}
                disabled={startingPickup || gpsState !== 'ok'}
                aria-busy={startingPickup}
              >
                {startingPickup ? <><LoadingSpinner size="sm" /> Starting pickup…</> : 'Start pickup'}
              </button>
            </section>
          )}
          {/* Lot QR — printed/stored on the physical lot; the recycler scans it at pickup */}
          <section className="card animate-scale-in lot-qr-card" aria-labelledby="lot-qr-heading">
            <h2 id="lot-qr-heading" className="detail-section-title">{t('verify.qrTitle')}</h2>
            <LotQR value={lotId} />
          </section>
          {/* Lot Summary Card — collection evidence, immutable */}
          <section className="card animate-scale-in" aria-labelledby="lot-sum-heading">
            <h2 id="lot-sum-heading" className="detail-section-title">{t('common.summary')}</h2>
            <div className="detail-grid">
              <div className="detail-item">
                <p className="detail-item__label">{t('common.lotId')}</p>
                <p className="detail-item__value font-mono">{lotId}</p>
              </div>
              <div className="detail-item">
                <p className="detail-item__label">{t('verify.collectionWeight')}</p>
                <p className="detail-item__value">
                  {lotMeta?.approx_weight_kg != null ? `${lotMeta.approx_weight_kg} ${t('common.kg')}` : '—'}
                </p>
              </div>
              <div className="detail-item">
                <p className="detail-item__label">{t('verify.finalWeight')}</p>
                <p className={`detail-item__value ${firstHandover?.weight_kg != null && Number(firstHandover.weight_kg) !== Number(lotMeta?.approx_weight_kg) ? 'detail-item__value--changed' : ''}`}>
                  {firstHandover?.weight_kg != null ? `${firstHandover.weight_kg} ${t('common.kg')}` : t('status.pending')}
                </p>
                {firstHandover?.weight_kg != null && Number(firstHandover.weight_kg) !== Number(lotMeta?.approx_weight_kg) && (
                  <p className="detail-item__delta">
                    {Number(firstHandover.weight_kg) > Number(lotMeta?.approx_weight_kg) ? '+' : ''}
                    {(Number(firstHandover.weight_kg) - Number(lotMeta?.approx_weight_kg)).toFixed(1)} {t('common.kg')}
                  </p>
                )}
              </div>
              <div className="detail-item">
                <p className="detail-item__label">{t('verify.collectionLocation')}</p>
                <p className="detail-item__value">{lotMeta?.collection_location ?? '—'}</p>
              </div>
              <div className="detail-item">
                <p className="detail-item__label">{t('verify.collectedAt')}</p>
                <p className="detail-item__value" style={{ fontSize: 'var(--text-sm)' }}>
                  {fmtDate(lotMeta?.created_at ?? firstHandover?.lot_created_at, lang)}
                </p>
              </div>
              <div className="detail-item">
                <p className="detail-item__label">{t('verify.quotedPrice')}</p>
                <p className="detail-item__value">{fmtRupees(lotMeta?.quoted_price ?? firstHandover?.quoted_price)}</p>
              </div>
              <div className="detail-item">
                <p className="detail-item__label">{t('verify.handover')}</p>
                {(firstHandover?.handover_reference || lotMeta?.handover_reference_number) ? (
                  <StatusBadge status={firstHandover?.status || lotMeta?.traceability_status || 'pending_confirmation'} size="md" />
                ) : (
                  <p className="detail-item__value">{t('lotDetail.noHandover')}</p>
                )}
              </div>
              {firstHandover?.payment_status === 'paid' && (
                <>
                  <div className="detail-item">
                    <p className="detail-item__label">{t('lotDetail.payFinalPrice')}</p>
                    <p className="detail-item__value" style={{ color: 'var(--color-accent)', fontWeight: 'var(--weight-bold)' }}>
                      {fmtRupees(firstHandover.final_price)}
                    </p>
                  </div>
                  <div className="detail-item">
                    <p className="detail-item__label">{t('lotDetail.payMethod')}</p>
                    <p className="detail-item__value">{t(`lotDetail.payMethods.${firstHandover.payment_method ?? 'cash'}`)}</p>
                  </div>
                </>
              )}
            </div>
            {collectionImages.length > 0 ? (
              <section className="collection-evidence" aria-label="Collector collection photos">
                <p className="detail-item__label">Collector collection evidence ({collectionImages.length})</p>
                <div className="collection-evidence__grid">
                  {collectionImages.map((image, index) => (
                    <figure key={image.id} className="collection-photo">
                      <img src={image.image_url} alt={`Collector evidence photo ${index + 1}`} loading="lazy" />
                      <figcaption className="text-muted text-sm">Collection photo {index + 1}</figcaption>
                    </figure>
                  ))}
                </div>
              </section>
            ) : collectionImgUrl(firstHandover ?? lotMeta) && (
              <figure className="collection-photo" style={{ marginTop: 'var(--space-4)' }}>
                <img src={collectionImgUrl(firstHandover ?? lotMeta)} alt={t('verify.collectionPhotoAlt')} />
                <figcaption className="text-muted text-sm">{t('verify.collectionPhotoLabel')}</figcaption>
              </figure>
            )}
          </section>

          {/* Handover Records */}
          <section className="animate-fade-in" aria-labelledby="handovers-heading">
            <h2
              id="handovers-heading"
              className="section-title"
              style={{ marginBottom: 'var(--space-4)', fontSize: 'var(--text-xl)' }}
            >
              {t('traceability.lifecycle')}
            </h2>

            {handovers.map((h, i) => {
              // The list endpoint deliberately aliases the database field to
              // handover_reference; use that stable API contract here.
              const ref = h.handover_reference;
              const step = statusToStep(h.status);
              const isConfirmed = h.status === 'confirmed';

              return (
                <div
                  key={h.id || i}
                  className="handover-card card stagger-item"
                  style={{ animationDelay: `${i * 70}ms`, marginBottom: 'var(--space-4)' }}
                >
                  {/* Reference + Status */}
                  <div className="handover-card__header">
                    <div>
                      <p className="handover-card__ref-label">{t('traceability.details.ref')}</p>
                      <p className="handover-card__ref font-mono">{ref || '—'}</p>
                    </div>
                    <StatusBadge status={h.status || 'pending_confirmation'} size="md" />
                  </div>

                  {/* Meta grid */}
                  <div className="detail-grid" style={{ marginTop: 'var(--space-4)' }}>
                    <div className="detail-item">
                      <p className="detail-item__label">{t('traceability.events.handoverInit')}</p>
                      {/* event_timestamp is the correct field on traceability table */}
                      <p className="detail-item__value" style={{ fontSize: 'var(--text-sm)' }}>
                        {fmtDate(h.event_timestamp, lang)}
                      </p>
                    </div>
                    {isConfirmed && (
                      <div className="detail-item">
                        <p className="detail-item__label">{t('traceability.events.confirmed')}</p>
                        {/* confirmation_timestamp is the correct field */}
                        <p className="detail-item__value" style={{ fontSize: 'var(--text-sm)' }}>
                          {fmtDate(h.confirmation_timestamp, lang)}
                        </p>
                      </div>
                    )}
                    {h.weight_kg != null && (
                      <div className="detail-item">
                        <p className="detail-item__label">{t('lotDetail.weight')}</p>
                        <p className="detail-item__value">{h.weight_kg} {t('common.kg')}</p>
                      </div>
                    )}
                  </div>

                  {/* Traceability Timeline */}
                  <div className="timeline" aria-label="Handover traceability timeline">
                    <div className={`timeline-step ${step >= 0 ? 'timeline-step--done' : ''}`}>
                      <div className="timeline-step__dot" />
                      <div>
                        <span className="timeline-step__label">{t('traceability.events.created')}</span>
                        <span className="timeline-step__sub">{t('status.quoted')}</span>
                      </div>
                    </div>
                    <div className={`timeline-step ${step >= 1 ? 'timeline-step--done' : 'timeline-step--pending'}`}>
                      <div className="timeline-step__dot" />
                      <div>
                        <span className="timeline-step__label">{t('traceability.events.handoverInit')}</span>
                        <span className="timeline-step__sub">
                          {t('traceability.details.ref')}: <span className="font-mono" style={{ fontSize: 'var(--text-xs)' }}>{ref}</span>
                        </span>
                      </div>
                    </div>
                    <div className={`timeline-step ${step >= 2 ? 'timeline-step--done' : 'timeline-step--pending'}`}>
                      <div className="timeline-step__dot" />
                      <div>
                        <span className="timeline-step__label">{t('traceability.events.confirmed')}</span>
                        <span className="timeline-step__sub">
                          {isConfirmed
                            ? `${t('status.confirmed')} ${fmtDate(h.confirmation_timestamp, lang)}`
                            : t('traceability.events.awaitingConfirm')}
                        </span>
                      </div>
                    </div>
                  </div>

{/* Confirm Button — at pickup, confirmation happens via the QR-scan
                      Verify & Confirm workflow below (final weight + photo + GPS). */}
                  {!isConfirmed && ref && (
                    <p className="scan-verify-cta" id={`verify-prompt-${ref}`}>
                      {t('verify.pendingPrompt')}
                    </p>
                  )}

                  {isConfirmed && (
                    <div className="confirmed-banner" role="status">
                      
                      {t('traceability.events.txComplete')}
                    </div>
                  )}
                </div>
              );
            })}
          </section>

          {/* Scan-Verify workflow: pending handover awaiting the recycler's confirmation */}
          {firstHandover && !isHandoverConfirmed && (
            <section className="card animate-scale-in" aria-labelledby="verify-heading">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-4)', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
                <h2 id="verify-heading" className="detail-section-title" style={{ marginBottom: 0 }}>
                  {t('verify.title')}
                </h2>
                <StatusBadge status={firstHandover.status || 'pending_confirmation'} size="md" />
              </div>

              {/* Original evidence — compare the physical material against this,
                  not against anything the QR holds (QR = identifier only) */}
              {collectionImages.length > 0 ? (
                <section className="collection-evidence" aria-label="Collector collection photos for verification" style={{ marginBottom: 'var(--space-4)' }}>
                  <p className="detail-item__label">Compare all collector photos ({collectionImages.length})</p>
                  <div className="collection-evidence__grid">
                    {collectionImages.map((image, index) => (
                      <figure key={image.id} className="collection-photo">
                        <img src={image.image_url} alt={`Collector collection evidence photo ${index + 1}`} loading="lazy" />
                        <figcaption className="text-muted text-sm">Collection photo {index + 1}</figcaption>
                      </figure>
                    ))}
                  </div>
                </section>
              ) : collectionImgUrl(firstHandover ?? lotMeta) && (
                <figure className="collection-photo collection-photo--lg" style={{ marginBottom: 'var(--space-4)' }}>
                  <img src={collectionImgUrl(firstHandover ?? lotMeta)} alt={t('verify.collectionPhotoAlt')} />
                  <figcaption className="text-muted text-sm">{t('verify.collectionPhotoLabel')}</figcaption>
                </figure>
              )}

              {/* Lot facts — served from the backend single source of truth */}
              <div className="detail-grid" style={{ marginBottom: 'var(--space-4)' }}>
                <div className="detail-item">
                  <p className="detail-item__label">{t('lotDetail.category')}</p>
                  <p className="detail-item__value">{firstHandover.category ?? lotMeta?.category ?? '—'}</p>
                </div>
                <div className="detail-item">
                  <p className="detail-item__label">{t('verify.collectionWeight')}</p>
                  <p className="detail-item__value">
                    {firstHandover.approx_weight_kg ?? lotMeta?.approx_weight_kg ?? '—'} {t('common.kg')}
                  </p>
                </div>
                <div className="detail-item">
                  <p className="detail-item__label">{t('verify.collectedAt')}</p>
                  <p className="detail-item__value" style={{ fontSize: 'var(--text-sm)' }}>
                    {fmtDate(firstHandover.lot_created_at ?? lotMeta?.created_at, lang)}
                  </p>
                </div>
                <div className="detail-item">
                  <p className="detail-item__label">{t('verify.collector')}</p>
                  <p className="detail-item__value">{firstHandover.collector_name ?? '—'}</p>
                </div>
                <div className="detail-item">
                  <p className="detail-item__label">{t('verify.collectionLocation')}</p>
                  <p className="detail-item__value">{firstHandover.collection_location ?? lotMeta?.collection_location ?? '—'}</p>
                </div>
                <div className="detail-item">
                  <p className="detail-item__label">{t('verify.quotedPrice')}</p>
                  <p className="detail-item__value">{fmtRupees(firstHandover.quoted_price)}</p>
                </div>
                <div className="detail-item">
                  <p className="detail-item__label">{t('common.lotId')}</p>
                  <p className="detail-item__value font-mono" style={{ fontSize: 'var(--text-sm)' }}>{lotId}</p>
                </div>
              </div>

              {/* Final weighing */}
              <div className="form-group">
                <label className="form-label" htmlFor="verify-weight">
                  {t('verify.finalWeight')} <span className="text-muted">({t('common.kg')})</span>
                </label>
                <div className="pay-price-input">
                  <input
                    id="verify-weight"
                    type="number"
                    min="0"
                    step="0.1"
                    className="form-input"
                    inputMode="decimal"
                    placeholder={(firstHandover.approx_weight_kg ?? lotMeta?.approx_weight_kg) != null ? String(firstHandover.approx_weight_kg ?? lotMeta?.approx_weight_kg) : t('verify.weightPlaceholder')}
                    value={finalWeight}
                    onChange={(e) => setFinalWeight(e.target.value)}
                  />
                  <span className="weight-unit">{t('common.kg')}</span>
                </div>
              </div>

              {/* Handover photograph */}
              <div className="form-group">
                <span className="form-label">{t('verify.photoLabel')}</span>
                <div className="verify-photo-row">
                  <input
                    type="file"
                    id="verify-photo"
                    accept="image/*"
                    capture="environment"
                    className="form-input"
                    style={{ display: 'none' }}
                    onChange={handleVerifyPhoto}
                  />
                  <label htmlFor="verify-photo" className="btn btn-outline">
                    {verifyPhoto ? t('verify.photoChange') : t('verify.photoCapture')}
                  </label>
                  {verifyPhoto ? (
                    <img
                      src={verifyPhoto}
                      alt={t('verify.photoCapturedAlt')}
                      className="verify-photo-preview"
                    />
                  ) : (
                    <span className="text-muted text-sm">{t('verify.photoHint')}</span>
                  )}
                </div>
              </div>

              {/* GPS capture */}
              <div className="form-group">
                <span className="form-label">{t('verify.gpsLabel')}</span>
                <div className="verify-photo-row">
                  <button type="button" className="btn btn-outline" onClick={captureGps} disabled={gpsState === 'locating'}>
                    {gpsState === 'locating' ? t('verify.gpsLocating') : t('verify.gpsCapture')}
                  </button>
                  {gpsState === 'ok' && (
                    <span className="verify-gps-ok">
                       {t('verify.gpsRecorded')} {Number(gps.lat).toFixed(4)}, {Number(gps.lng).toFixed(4)}
                    </span>
                  )}
                  {gpsState === 'unavailable' && (
                    <span className="text-muted text-sm">{t('verify.gpsUnavailable')}</span>
                  )}
                </div>
              </div>

              <p className="text-muted text-sm" style={{ margin: 'var(--space-3) 0', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                 {t('verify.timestampNote')}
              </p>

              <button
                className="btn btn-accent btn-full"
                onClick={() => handleConfirm(firstHandover.handover_reference)}
                disabled={!!confirming}
                aria-busy={!!confirming}
                id="verify-confirm-btn"
              >
                {confirming
                  ? <><LoadingSpinner size="sm" /> {t('common.loading')}…</>
                  : <> {t('verify.confirmHandover')}</>}
              </button>
            </section>
          )}

          {/* Digital handover record — full verification evidence once confirmed */}
          {isHandoverConfirmed && (
            <section className="card animate-scale-in" aria-labelledby="record-heading">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-4)', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
                <h2 id="record-heading" className="detail-section-title" style={{ marginBottom: 0 }}>
                  {t('verify.recordTitle')}
                </h2>
                <StatusBadge status="confirmed" size="md" />
              </div>

              <div className="detail-grid">
                <div className="detail-item">
                  <p className="detail-item__label">{t('traceability.details.ref')}</p>
                  <p className="detail-item__value font-mono" style={{ fontSize: 'var(--text-sm)' }}>
                    {firstHandover.handover_reference}
                  </p>
                </div>
                <div className="detail-item">
                  <p className="detail-item__label">{t('verify.collectionWeight')}</p>
                  <p className="detail-item__value">
                    {firstHandover.approx_weight_kg ?? lotMeta?.approx_weight_kg ?? '—'} {t('common.kg')}
                  </p>
                </div>
                <div className="detail-item">
                  <p className="detail-item__label">{t('verify.finalWeight')}</p>
                  <p className="detail-item__value">{firstHandover.weight_kg} {t('common.kg')}</p>
                </div>
                <div className="detail-item">
                  <p className="detail-item__label">{t('verify.timestamp')}</p>
                  <p className="detail-item__value" style={{ fontSize: 'var(--text-sm)' }}>
                    {fmtDate(firstHandover.confirmed_at || firstHandover.confirmation_timestamp, lang)}
                  </p>
                </div>
                <div className="detail-item">
                  <p className="detail-item__label">GPS</p>
                  <p className="detail-item__value" style={{ fontSize: 'var(--text-sm)' }}>
                    {firstHandover.gps_lat != null && firstHandover.gps_lng != null
                      ? `${Number(firstHandover.gps_lat).toFixed(4)}, ${Number(firstHandover.gps_lng).toFixed(4)}`
                      : t('verify.notRecorded')}
                  </p>
                </div>
                <div className="detail-item">
                  <p className="detail-item__label">{t('verify.qrScanLabel')}</p>
                  <p className="detail-item__value">
                    {firstHandover.scan_verified || hasScanEvidence(firstHandover)
                      ? ` ${t('verify.qrScanned')}`
                      : t('verify.qrManual')}
                  </p>
                </div>
                <div className="detail-item">
                  <p className="detail-item__label">{t('verify.photoLabel')}</p>
                  {confirmationImages.length > 0 ? (
                    <img src={confirmationImages[confirmationImages.length - 1].image_url} alt={t('verify.photoCapturedAlt')} className="verify-photo-preview verify-photo-preview--lg" />
                  ) : (
                    <p className="detail-item__value">{t('verify.notRecorded')}</p>
                  )}
                </div>
              </div>

              {collectionImgUrl(firstHandover ?? lotMeta) && (
                <figure className="collection-photo" style={{ marginTop: 'var(--space-4)' }}>
                  <img src={collectionImgUrl(firstHandover ?? lotMeta)} alt={t('verify.collectionPhotoAlt')} />
                  <figcaption className="text-muted text-sm">{t('verify.collectionPhotoLabel')}</figcaption>
                </figure>
              )}

              <div className="confirmed-banner" role="status" style={{ marginTop: 'var(--space-4)' }}>
                {t('verify.recordComplete')}
              </div>
            </section>
          )}

          {/* Record final price + payment method (PS §14: cash / UPI / bank) */}
          {isHandoverConfirmed && (
            <section className="card animate-scale-in" aria-labelledby="pay-heading">
              <h2 id="pay-heading" className="detail-section-title">{t('lotDetail.payRecord')}</h2>

              {firstHandover?.payment_status === 'paid' ? (
                <div className="confirmed-banner" role="status">
                  
                  {t('lotDetail.payPaid', {
                    amount: fmtRupees(firstHandover.final_price),
                    method: t(`lotDetail.payMethods.${firstHandover.payment_method ?? 'cash'}`),
                  })}
                </div>
              ) : (
                <>
                  <div className="form-group">
                    <label className="form-label" htmlFor="pay-price">{t('lotDetail.payFinalPrice')}</label>
                    <div className="pay-price-input">
                      <input
                        id="pay-price"
                        type="number"
                        min="0"
                        step="0.01"
                        className="form-input"
                        value={payPrice}
                        onChange={(e) => handlePayPriceChange(e.target.value)}
                        aria-describedby="pay-price-hint"
                      />
                      <span className="weight-unit">₹</span>
                    </div>
                    {firstHandover?.quoted_price != null && (
                      <p id="pay-price-hint" className="form-hint">
                        {t('lotDetail.payQuotedHint', { amount: fmtRupees(firstHandover.quoted_price) })}
                      </p>
                    )}
                  </div>

                  {payChecking && (
                    <p className="anomaly-checking">
                      {t('lotDetail.payChecking')}…
                    </p>
                  )}

                  {payAnomaly?.is_anomalous && (
                    <div className="anomaly-banner" role="alert">
                      <div className="anomaly-banner__head">
                        <span className={`anomaly-sev anomaly-sev--${payAnomaly.flags?.[0]?.severity ?? 'medium'}`}>
                          {t(`lotDetail.payAnomalySeverity.${payAnomaly.flags?.[0]?.severity ?? 'medium'}`)}
                        </span>
                        <strong>{t('lotDetail.payAnomalyTitle')}</strong>
                      </div>
                      {payAnomaly.flags?.map((f, i) => (
                        <p key={i} className="anomaly-banner__msg">{f.message}</p>
                      ))}
                      {payAnomaly.market_range && (
                        <p className="anomaly-banner__range">
                          {t('lotDetail.payMarketRange', {
                            low: fmtRupees(payAnomaly.market_range.low),
                            high: fmtRupees(payAnomaly.market_range.high),
                          })}
                        </p>
                      )}
                    </div>
                  )}

                  {!payChecking && !payAnomaly?.is_anomalous && payPrice && Number(payPrice) > 0 && (
                    <p className="anomaly-clear">{t('lotDetail.payCheckedOk')}</p>
                  )}

                  <fieldset className="pay-methods" aria-label={t('lotDetail.payMethod')}>
                    <legend className="form-label">{t('lotDetail.payMethod')}</legend>
                    {['cash', 'upi', 'bank_transfer'].map((m) => (
                      <label
                        key={m}
                        className={`pay-method ${payMethod === m ? 'pay-method--active' : ''}`}
                      >
                        <input
                          type="radio"
                          name="payMethod"
                          value={m}
                          checked={payMethod === m}
                          onChange={() => setPayMethod(m)}
                        />
                        <span className="pay-method__icon" aria-hidden="true">{PAY_METHOD_ICONS[m]}</span>
                        <span>{t(`lotDetail.payMethods.${m}`)}</span>
                      </label>
                    ))}
                  </fieldset>

                  <button
                    className="btn btn-accent btn-full"
                    onClick={handleRecordPayment}
                    disabled={updatingPay || !payPrice || Number(payPrice) <= 0}
                    aria-busy={updatingPay}
                  >
                    {updatingPay
                      ? <><LoadingSpinner size="sm" /> {t('common.loading')}…</>
                      : <> {t('lotDetail.payRecordBtn')}</>}
                  </button>
                </>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
