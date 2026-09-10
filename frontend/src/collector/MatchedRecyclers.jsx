import { useEffect, useState, useCallback } from 'react';
import { useLocation, Link } from 'react-router-dom';
import {
  getMatchedRecyclers, initiateHandover,
  requestQuote, acceptOffer, rejectOffer, getOffersByLot,
  DEFAULT_LAT, DEFAULT_LNG, DEMO_COLLECTOR_ID,
} from '../api/client';
import { currentCollectorId, getSession } from '../services/auth';
import { StatusBadge } from '../components/StatusBadge';
import { PageLoader, LoadingSpinner } from '../components/LoadingSpinner';
import RecyclersMap from './RecyclersMap';
import { useTranslation } from '../i18n/config.js';
import './MatchedRecyclers.css';

export default function MatchedRecyclers() {
  const { state } = useLocation();
  const { t } = useTranslation();
  const session = getSession();

  const category    = state?.category || 'PCB';
  const lotId       = state?.lotId;
  const valuation   = state?.valuation;
  const city        = (state?.location || session?.operating_location || '').trim();

  // Coordinates resolution:
  // 1. Coordinates passed explicitly from CreateLot / state
  // 2. Embedded coordinates in location string e.g. "GPS Location (12.9238, 77.5019)"
  // 3. Collector's registered GPS coordinates from account session
  // 4. Defaults
  let initialLat = state?.lat != null ? Number(state.lat) : null;
  let initialLng = state?.lng != null ? Number(state.lng) : null;

  // If coordinates were not passed in state, try to extract from location string
  // e.g. "GPS Location (12.9238, 77.5019)"
  if ((initialLat == null || initialLng == null) && state?.location) {
    const coordsMatch = String(state.location).match(/(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)/);
    if (coordsMatch) {
      initialLat = parseFloat(coordsMatch[1]);
      initialLng = parseFloat(coordsMatch[2]);
    }
  }

  // Fall back to session-registered coordinates (collector's base city)
  if (initialLat == null || initialLng == null) {
    initialLat = session?.latitude != null ? Number(session.latitude) : DEFAULT_LAT;
    initialLng = session?.longitude != null ? Number(session.longitude) : DEFAULT_LNG;
  }

  const [lat, setLat] = useState(initialLat);
  const [lng, setLng] = useState(initialLng);
  const [mapCenter, setMapCenter] = useState([initialLat, initialLng]);
  const [selectedId, setSelectedId] = useState(null);
  const lotWeight = state?.weight || valuation?.weight_kg || valuation?.lot?.approx_weight_kg;

  // NOTE: We deliberately do NOT call navigator.geolocation here.
  // The lot's collection_lat / collection_lng (passed via router state from
  // LotDetail or CreateLot) is the authoritative source for matching distance.
  // Using the user's *current* GPS position would produce different distances
  // every time they reopen the same lot from a different physical location.
  const [detectingGps] = useState(false);

  const [radiusKm, setRadiusKm] = useState(150);
  const [recyclers, setRecyclers] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [offers, setOffers] = useState([]);
  const [offersError, setOffersError] = useState('');
  const [requesting, setRequesting] = useState(null);
  const [quoteToast, setQuoteToast] = useState('');
  const [offerBusy, setOfferBusy] = useState(null);
  const [handingOver, setHandingOver] = useState(null);
  const [handoverResult, setHandoverResult] = useState(null);

  const filteredRecyclers = recyclers.filter((r) => {
    if (!searchTerm.trim()) return true;
    const q = searchTerm.toLowerCase().trim();
    const name = (r.name || '').toLowerCase();
    const location = (r.facility_location || r.service_area || '').toLowerCase();
    return name.includes(q) || location.includes(q);
  });

  const fetchRecyclers = useCallback((searchRadius) => {
    setLoading(true);
    setError('');
    const rad = searchRadius || radiusKm;

    const queryParams = {
      category,
      maxDistanceKm: rad,
      lat,
      lng,
      location: city || undefined,
    };

    getMatchedRecyclers(queryParams)
      .then(async (r) => {
        // Update the map center to the resolved city center if the backend resolved
        // a city name — but do NOT overwrite lat/lng themselves. Those are anchored
        // to the lot's stored collection point and must remain stable.
        if (r.location?.lat != null && r.location?.lng != null) {
          setMapCenter([r.location.lat, r.location.lng]);
        } else if (lat != null && lng != null) {
          setMapCenter([lat, lng]);
        }
        const list = Array.isArray(r.data) ? r.data : [];
        if (list.length === 0 && rad < 1000) {
          // Auto-expand search if no local recyclers found within city radius
          try {
            const res2 = await getMatchedRecyclers({ ...queryParams, maxDistanceKm: 1500 });
            if (Array.isArray(res2.data) && res2.data.length > 0) {
              setRecyclers(res2.data);
              setRadiusKm(1500);
            } else {
              setRecyclers([]);
            }
          } catch {
            setRecyclers([]);
          }
        } else {
          setRecyclers(list);
        }
      })
      .catch(() => setError(t('recyclers.loadError')))
      .finally(() => setLoading(false));
  }, [category, lat, lng, city, radiusKm, t]);

  useEffect(() => {
    fetchRecyclers();
  }, [category, lat, lng, city]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load quote offers for the lot (marketplace state)
  const loadOffers = useCallback(() => {
    if (!lotId) return;
    setOffersError('');
    getOffersByLot(lotId)
      .then(r => setOffers(Array.isArray(r.data) ? r.data : []))
      .catch(() => setOffersError(t('quotes.loadError')));
  }, [lotId]);

  useEffect(() => { loadOffers(); }, [loadOffers]);

  const acceptedOffer = offers.find(o => o.offer_status === 'accepted');
  const openOffers = offers.filter(o => ['requested', 'offered'].includes(o.offer_status));

  async function handleRequestQuote(recycler) {
    if (!lotId) return;
    const recyclerId = recycler.id ?? recycler.recycler_id;
    setRequesting(recyclerId);
    setQuoteToast('');
    setError('');
    try {
      // POST /v1/quotes/request { lot_id, recycler_id }
      await requestQuote(lotId, recyclerId);
      loadOffers();
      setQuoteToast(t('quotes.requestSent'));
    } catch (err) {
      setError(err.message || t('quotes.requestFail'));
    } finally {
      setRequesting(null);
    }
  }

  async function handleOfferAction(offerId, decision) {
    setOfferBusy(offerId);
    setQuoteToast('');
    setError('');
    try {
      if (decision === 'accept') {
        // POST /v1/quotes/:id/accept → binds the lot to the recycler
        await acceptOffer(offerId);
        setQuoteToast(t('quotes.accepted'));
      } else {
        await rejectOffer(offerId);
        setQuoteToast(t('quotes.rejected'));
      }
      loadOffers();
      setTimeout(() => setQuoteToast(''), 4500);
    } catch (err) {
      setError(err.message || t('quotes.actionFail'));
    } finally {
      setOfferBusy(null);
    }
  }

  async function handleSelectRecycler(recycler) {
    if (!lotId) {
      setError('No lot selected. Please create a lot first.');
      return;
    }
    const collectorId = currentCollectorId();
    if (!collectorId) {
      navigate('/login', { replace: true });
      return;
    }
    // The recycler_id from the matching endpoint is returned as `id`
    const recyclerId = recycler.id ?? recycler.recycler_id;
    const weight = valuation?.lot?.approx_weight_kg;
    if (!weight) {
      setError('Lot weight is missing. Cannot initiate handover.');
      return;
    }
    setHandingOver(recyclerId);
    setError('');
    try {
      // POST /v1/handover/initiate
      // ONLINE:  Returns { traceability, handover_reference_number, recycler: { id, name } }
      // OFFLINE: Returns { queued: true, queueItem } — operation saved to IndexedDB for sync later
      const result = await initiateHandover({
        lot_id: lotId,
        collector_id: collectorId,
        recycler_id: recyclerId,
        photo_refs: [],
        weight_kg: weight,
        gps_lat: lat,
        gps_lng: lng,
        handover_location: state?.location || 'Unknown',
      });

      if (result?.queued) {
        // OFFLINE path — operation is queued, NOT confirmed by backend
        // Must show "Saved offline" state, not "completed"
        setHandoverResult({
          queued: true,
          recyclerName: recycler.name,
          reference: null, // no reference until backend processes it
        });
      } else {
        // ONLINE path — backend confirmed, reference is real
        const ref = result?.data?.handover_reference_number;
        setHandoverResult({
          queued: false,
          reference: ref,
          recyclerName: recycler.name,
        });
      }
    } catch (err) {
      setError(err.message || t('recyclerLotDetail.confirmError'));
    } finally {
      setHandingOver(null);
    }
  }

  // Newer API returns suitability (0–100, higher = better). Older clients fall
  // back to inverting the legacy match_score (lower = better).
  function suitabilityOf(r) {
    if (r.suitability != null) return Math.max(0, Math.min(100, Math.round(Number(r.suitability))));
    return Math.max(0, Math.round((1 - Math.min(r.match_score ?? 0.5, 1)) * 100));
  }

  function pctScore(v) {
    return Math.max(0, Math.min(100, Math.round((v ?? 0.5) * 100)));
  }

  function offerForRecycler(recyclerId) {
    return offers.find(o => o.recycler_id === recyclerId);
  }

  // Result panel — shown after initiateHandover returns (online OR offline queued)
  if (handoverResult) {
    // ── OFFLINE / QUEUED path ────────────────────────────────────────────────
    // The handover was saved locally and will sync when connectivity returns.
    // We must NOT claim it is completed — backend has not confirmed it yet.
    if (handoverResult.queued) {
      return (
        <div className="container">
          <div className="handover-success animate-scale-in" style={{ borderColor: 'var(--color-warning)', borderWidth: 2, borderStyle: 'solid' }}>
            <div className="handover-success__icon" aria-hidden="true"></div>
            <h1 className="section-title" style={{ textAlign: 'center' }}>{t('recyclers.savedOffline')}</h1>
            <p className="section-subtitle" style={{ textAlign: 'center' }}>
              {t('recyclers.savedOfflineDesc')}
            </p>

            <div className="handover-success__status-row" style={{ background: 'var(--color-warning-light)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3)' }}>

              <span className="text-sm" style={{ color: 'var(--color-warning)', fontWeight: 'var(--weight-semibold)' }}>
                {t('offline.savedOffline')}
              </span>
            </div>

            <div className="handover-success__actions">
              <Link to="/collector" className="btn btn-primary" id="go-dashboard-offline-btn">
                {t('common.back')}
              </Link>
            </div>
          </div>
        </div>
      );
    }

    // ── ONLINE / CONFIRMED path ──────────────────────────────────────────────
    // Backend confirmed the handover. Reference number is real.
    return (
      <div className="container">
        <div className="handover-success animate-scale-in">
          <div className="handover-success__icon" aria-hidden="true"></div>
          <h1 className="section-title" style={{ textAlign: 'center' }}>{t('recyclers.handoverInitiated')}</h1>
          <p className="section-subtitle" style={{ textAlign: 'center' }}>
            {t('recyclers.handoverRef')}: <strong>{lotId}</strong> → <strong>{handoverResult.recyclerName}</strong>
          </p>

          {handoverResult.reference && (
            <div className="handover-success__ref-card">
              <p className="handover-success__ref-label">{t('lotDetail.handoverRef')}</p>
              <p className="handover-success__ref font-mono" aria-label={`${t('lotDetail.handoverRef')}: ${handoverResult.reference}`}>
                {handoverResult.reference}
              </p>
            </div>
          )}

          <div className="handover-success__status-row">
            <StatusBadge status="pending_confirmation" size="md" />
          </div>

          <div className="handover-success__actions">
            <Link
              to={`/collector/lots/${lotId}`}
              className="btn btn-primary"
              id="view-lot-detail-btn"
            >
               {t('lotDetail.viewTraceability')}
            </Link>
            <Link to="/collector" className="btn btn-outline" id="go-dashboard-btn">
              {t('common.back')}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="animate-fade-in" style={{ marginBottom: 'var(--space-6)' }}>
        <button onClick={() => navigate(-1)} className="back-link btn-link" style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--color-primary)' }}>{t('common.back')}</button>
        <h1 className="section-title" style={{ marginTop: 'var(--space-3)' }}>{t('recyclers.title')}</h1>
        <p className="section-subtitle">
          {t('recyclers.subtitle')}
          {detectingGps && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)', marginLeft: 'var(--space-2)', color: 'var(--color-primary)' }}>
              · <LoadingSpinner size="sm" /> Locating…
            </span>
          )}
          {!detectingGps && lat != null && lng != null && (
            <span style={{ display: 'inline-block', marginLeft: 'var(--space-2)', color: 'var(--color-primary)' }}>
              · 📍 {city && !city.startsWith('GPS Location') ? `${city} (${lat.toFixed(4)}, ${lng.toFixed(4)})` : `GPS (${lat.toFixed(4)}, ${lng.toFixed(4)})`}
            </span>
          )}
        </p>
      </div>

      {/* Lot Summary Banner */}
      {valuation && (
        <div className="lot-summary-banner animate-fade-in" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
          <div>
            <span className="lot-summary-banner__id">{lotId}</span>
            <span className="lot-summary-banner__cat" style={{ marginLeft: '8px' }}>
              {category} {lotWeight ? `· ${lotWeight} kg` : ''}
            </span>
          </div>
          <div className="lot-summary-banner__value">
            <span className="text-muted text-xs" style={{ display: 'block', textTransform: 'uppercase' }}>
              Initial Platform Estimate
            </span>
            <strong>
              Estimated Market Value: ₹{Number(valuation?.lot?.estimated_value || valuation?.estimated_value || 0)
                .toLocaleString('en-IN', { maximumFractionDigits: 0 })}
            </strong>
          </div>
        </div>
      )}

      {error && (
        <div className="alert-banner alert-banner--error animate-fade-in" role="alert">
           {error}
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

      {loading ? (
        <PageLoader />
      ) : recyclers.length === 0 ? (
        <div className="empty-state card">

          <p style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-semibold)' }}>
            {t('recyclers.noMatch')}
          </p>
          <p>{t('recyclers.noMatchDesc')}</p>
        </div>
      ) : (
        <>
          {/* ── Quotes received ─────────────────────────────────────────────── */}
          {lotId && (openOffers.length > 0 || acceptedOffer) && (
            <section className="card quote-section animate-fade-in" aria-labelledby="quotes-heading">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
                <h2 id="quotes-heading" className="detail-section-title" style={{ marginBottom: 0 }}>
                  {t('quotes.receivedTitle')}
                </h2>
                {acceptedOffer && (
                  <StatusBadge status="accepted" size="md" />
                )}
              </div>

              {acceptedOffer ? (
                <div>
                  <div className="confirmed-banner" role="status" style={{ marginBottom: '12px' }}>
                    {t('quotes.acceptedBanner', {
                      recycler: acceptedOffer.recycler_name,
                      price: `₹${Number(acceptedOffer.offered_price).toLocaleString('en-IN')}`,
                    })}
                  </div>

                  <div className="card" style={{ background: 'var(--color-surface-alt, #f8fafc)', padding: '16px', borderRadius: '10px', border: '1px solid var(--color-success, #16a34a)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                      <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: '600', color: 'var(--color-success, #16a34a)' }}>
                        📞 Pickup Coordination & Recycler Contact
                      </h3>
                      <span className="pill" style={{ background: 'var(--status-confirmed-bg)', color: 'var(--status-confirmed)', fontSize: '0.8rem' }}>
                        ✅ Contact Unlocked
                      </span>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginTop: '10px' }}>
                      <div>
                        <span className="detail-item__label" style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>Facility Name</span>
                        <p style={{ margin: '2px 0 0 0', fontWeight: '600' }}>{acceptedOffer.recycler_name}</p>
                      </div>
                      <div>
                        <span className="detail-item__label" style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>Contact Person / Business Phone</span>
                        <p style={{ margin: '2px 0 0 0', fontWeight: '600' }}>
                          {acceptedOffer.contact_details || acceptedOffer.recycler_contact_details ? (
                            <a href={`tel:${acceptedOffer.contact_details || acceptedOffer.recycler_contact_details}`} style={{ color: 'var(--color-primary)', textDecoration: 'underline' }}>
                              📞 {acceptedOffer.contact_details || acceptedOffer.recycler_contact_details}
                            </a>
                          ) : 'Available in dispatch confirmation'}
                        </p>
                      </div>
                      <div>
                        <span className="detail-item__label" style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>Pickup Availability</span>
                        <p style={{ margin: '2px 0 0 0' }}>{acceptedOffer.pickup_availability || 'Daily / On Request'}</p>
                      </div>
                      <div>
                        <span className="detail-item__label" style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>Facility Location</span>
                        <p style={{ margin: '2px 0 0 0' }}>{acceptedOffer.recycler_facility || acceptedOffer.recycler_service_area || 'Bengaluru'}</p>
                      </div>
                    </div>
                  </div>
                </div>
              ) : openOffers.length === 0 ? (
                <p className="quote-section__empty">{t('quotes.noOffersYet')}</p>
              ) : (
                <>
                  <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span>🔐</span>
                    <span>Recycler contact phone & direct details remain protected until you accept a quote.</span>
                  </div>
                  <ul className="quote-list">
                  {openOffers.map((o) => (
                    <li key={o.id} className="quote-item">
                      <div className="quote-item__main">
                        <div className="quote-item__name">{o.recycler_name}</div>
                        <div className="quote-item__status">
                          {o.offer_status === 'offered'
                            ? <><strong>₹{Number(o.offered_price).toLocaleString('en-IN')}</strong> {t('quotes.totalOffer')}</>
                            : <span>{t('quotes.awaitingRecycler')}</span>}
                        </div>
                      </div>
                      {o.offer_status === 'offered' ? (
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
                      ) : (
                        <StatusBadge status="requested" size="md" />
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
            </section>
          )}

          {/* ── Search & Filter Bar ─────────────────────────────────────────── */}
          <div className="search-filter-card card animate-fade-in" style={{ marginBottom: 'var(--space-4)', padding: 'var(--space-3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
              <span style={{ fontSize: '1.1rem', opacity: 0.7 }} aria-hidden="true">🔍</span>
              <input
                type="text"
                className="form-input"
                placeholder={t('recyclers.searchPlaceholder')}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{ flex: 1, padding: 'var(--space-2) var(--space-3)', fontSize: 'var(--text-sm)' }}
                aria-label={t('recyclers.searchPlaceholder')}
              />
              {searchTerm && (
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => setSearchTerm('')}
                  style={{ padding: '0.25rem 0.5rem', fontSize: 'var(--text-xs)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                  title={t('common.clear')}
                  aria-label={t('common.clear')}
                >
                  ✕ {t('common.clear')}
                </button>
              )}
            </div>
            {searchTerm && (
              <div style={{ marginTop: 'var(--space-2)', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                Showing {filteredRecyclers.length} of {recyclers.length} matched recyclers
              </div>
            )}
          </div>

          <div className="map-wrap card">
            <RecyclersMap
              recyclers={filteredRecyclers}
              center={mapCenter}
              radiusKm={radiusKm}
              selectedId={selectedId}
              onSelect={(id) => setSelectedId(id)}
            />
          </div>

          {filteredRecyclers.length === 0 ? (
            <div className="empty-state card" style={{ marginTop: 'var(--space-4)' }}>
              <p style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-semibold)' }}>
                {t('recyclers.noSearchMatch')}
              </p>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => setSearchTerm('')}
                style={{ marginTop: 'var(--space-3)' }}
              >
                Clear Search Filter
              </button>
            </div>
          ) : (
            <div className="recycler-list">
              {filteredRecyclers.map((r, i) => {
            // Matching API returns `id` as the recycler primary key
            const recyclerId = r.id ?? r.recycler_id;
            const isHandingOver = handingOver === recyclerId;
            const isRequesting = requesting === recyclerId;
            const pct = suitabilityOf(r);

            const myOffer = offerForRecycler(recyclerId);
            const isAcceptor = acceptedOffer?.recycler_id === recyclerId;

            return (
              <div
                key={recyclerId}
                className={`recycler-card card card-clickable stagger-item ${selectedId === recyclerId ? 'recycler-card--selected' : ''} ${isAcceptor ? 'recycler-card--chosen' : ''}`}
                style={{ animationDelay: `${i * 70}ms` }}
                onClick={() => setSelectedId(recyclerId)}
              >
                <div className="recycler-card__header">
                  <div className="recycler-card__name-wrap">
                    <div className="recycler-card__avatar" aria-hidden="true"></div>
                    <div>
                      <h2 className="recycler-card__name">{r.name}</h2>
                      <p className="recycler-card__area">{r.service_area || r.facility_location}</p>
                    </div>
                  </div>
                  <StatusBadge status="authorized" />
                </div>

                {/* Suitability Score Bar */}
                <div className="match-score" aria-label={`${t('recyclers.suitability')}: ${pct}%`}>
                  <div className="match-score__label">
                    <span>{t('recyclers.suitability')}</span>
                    <span className="match-score__pct">{pct}%</span>
                  </div>
                  <div
                    className="match-score__bar"
                    role="progressbar"
                    aria-valuenow={pct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <div className="match-score__fill" style={{ width: `${pct}%` }} />
                  </div>
                </div>

                {/* Score breakdown — explainable, per the SIH explainability ask */}
                {(r.score_price != null || r.score_reliability != null) && (
                  <div className="recycler-card__scores" aria-label={t('recyclers.scoreBreakdown')}>
                    <span className="score-chip" title={t('recyclers.scorePrice')}>
                      {t('recyclers.scorePrice')} {pctScore(r.score_price)}%
                    </span>
                    <span className="score-chip" title={t('recyclers.scoreDistance')}>
                      {t('recyclers.scoreDistance')} {pctScore(r.score_distance)}%
                    </span>
                    <span className="score-chip" title={t('recyclers.scorePickup')}>
                      {t('recyclers.scorePickup')} {pctScore(r.score_pickup)}%
                    </span>
                    <span className="score-chip" title={t('recyclers.scoreReliability')}>
                      {t('recyclers.scoreReliability')} {pctScore(r.score_reliability)}%
                    </span>
                  </div>
                )}

                {/* Stats */}
                <div className="recycler-card__stats">
                  <div className="recycler-stat">

                    <div>
                      <p className="recycler-stat__label">{t('recyclers.distance')}</p>
                      <p className="recycler-stat__value">
                        {r.distance_km != null ? `${Number(r.distance_km).toFixed(1)} ${t('recyclers.km')}` : '—'}
                      </p>
                    </div>
                  </div>
                  <div className="recycler-stat">
                    <span className="recycler-stat__icon" aria-hidden="true">₹</span>
                    <div>
                      <p className="recycler-stat__label">Recycler's Offer</p>
                      <p className="recycler-stat__value">
                        {r.offered_rate ? `₹${r.offered_rate} / kg` : '—'}
                      </p>
                      {lotWeight && r.offered_rate ? (
                        <p className="text-xs text-muted" style={{ marginTop: '2px' }}>
                          Est: ₹{Math.round(Number(lotWeight) * Number(r.offered_rate)).toLocaleString('en-IN')}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <div className="recycler-stat">
                    <span className="recycler-stat__icon" aria-hidden="true">✓</span>
                    <div>
                      <p className="recycler-stat__label">{t('recyclers.pickup')}</p>
                      <p className={`recycler-stat__value ${r.pickup_availability === 'daily' ? 'text-success' : 'text-muted'}`}>
                        {r.pickup_availability === 'daily' ? t('recyclers.pickupYes') : t('recyclers.pickupNo')}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Accepted materials */}
                {Array.isArray(r.materials_accepted) && r.materials_accepted.length > 0 && (
                  <div className="recycler-card__materials">
                    {r.materials_accepted.map(m => (
                      <span key={m} className="material-chip">{m}</span>
                    ))}
                  </div>
                )}

                {/* Marketplace CTA — only when a lot exists */}
                {lotId && acceptedOffer && (
                  isAcceptor ? (
                    <div style={{ width: '100%' }}>
                      <div style={{ background: 'var(--color-success-light, #dcfce7)', padding: '6px 10px', borderRadius: '6px', marginBottom: '8px', textAlign: 'center', fontSize: '0.85rem', color: 'var(--color-success, #16a34a)' }}>
                        ✓ <strong>Accepted Recycler Rate:</strong> ₹{acceptedOffer.offered_price} / kg
                        {lotWeight && (
                          <span style={{ display: 'block', fontSize: '0.78rem' }}>
                            Agreed payout at this rate: ₹{Math.round(Number(lotWeight) * Number(acceptedOffer.offered_price)).toLocaleString('en-IN')}
                          </span>
                        )}
                      </div>
                      <button
                        className="btn btn-accent btn-full"
                        onClick={() => handleSelectRecycler(r)}
                        disabled={!!handingOver}
                        aria-busy={isHandingOver}
                        id={`select-recycler-${recyclerId}`}
                      >
                        {isHandingOver
                          ? <><LoadingSpinner size="sm" /> {t('recyclers.handingOver')}…</>
                          : <>Proceed to Handover</>
                        }
                      </button>
                    </div>
                  ) : (
                    <p className="quote-section__empty" style={{ textAlign: 'center', margin: 0 }}>
                      {t('quotes.quoteElsewhere')}
                    </p>
                  )
                )}

                {lotId && !acceptedOffer && (() => {
                  if (!myOffer) {
                    return (
                      <button
                        className="btn btn-primary btn-full"
                        onClick={() => handleRequestQuote(r)}
                        disabled={!!requesting}
                        aria-busy={isRequesting}
                        id={`request-quote-${recyclerId}`}
                      >
                        {isRequesting
                          ? <><LoadingSpinner size="sm" /> {t('quotes.requesting')}…</>
                          : <> {t('quotes.requestQuote')}</>
                        }
                      </button>
                    );
                  }
                  if (myOffer.offer_status === 'requested') {
                    return (
                      <p className="quote-section__empty" style={{ textAlign: 'center', margin: 0 }}>
                        {t('quotes.awaitingRecycler')}
                      </p>
                    );
                  }
                  if (myOffer.offer_status === 'offered') {
                    const quoteRate = Number(myOffer.offered_price);
                    const quotePayout = lotWeight ? Math.round(Number(lotWeight) * quoteRate) : null;
                    return (
                      <div className="quote-item__actions" style={{ justifyContent: 'center', flexDirection: 'column', gap: '8px', padding: 'var(--space-2)' }}>
                        <div style={{ textAlign: 'center' }}>
                          <span className="text-xs text-muted" style={{ display: 'block' }}>Recycler's Offer</span>
                          <strong style={{ fontSize: '1.2rem', color: 'var(--color-primary)' }}>₹{quoteRate.toLocaleString('en-IN')} / kg</strong>
                          {quotePayout != null && (
                            <div className="text-xs text-muted" style={{ marginTop: '2px' }}>
                              Estimated payout at this rate: <strong style={{ color: 'var(--color-text)' }}>₹{quotePayout.toLocaleString('en-IN')}</strong>
                            </div>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                          <button
                            className="btn btn-accent btn-sm"
                            disabled={!!offerBusy}
                            onClick={() => handleOfferAction(myOffer.id, 'accept')}
                            aria-busy={offerBusy === myOffer.id}
                          >
                            ✓ Accept Quote
                          </button>
                          <button
                            className="btn btn-outline btn-sm"
                            disabled={!!offerBusy}
                            onClick={() => handleOfferAction(myOffer.id, 'reject')}
                          >
                            {t('quotes.reject')}
                          </button>
                        </div>
                      </div>
                    );
                  }
                  return (
                    <button
                      className="btn btn-primary btn-full"
                      onClick={() => handleRequestQuote(r)}
                      disabled={!!requesting}
                      aria-busy={isRequesting}
                      id={`request-quote-${recyclerId}`}
                    >
                      {t('quotes.requestQuote')}
                    </button>
                  );
                })()}
              </div>
            );
          })}
          </div>
          )}
        </>
      )}
    </div>
  );
}