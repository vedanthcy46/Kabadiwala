import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getNearbyRecyclers, DEFAULT_LAT, DEFAULT_LNG } from '../api/client';
import { getSession } from '../services/auth';
import { StatusBadge } from '../components/StatusBadge';
import { LoadingSpinner } from '../components/LoadingSpinner';
import RecyclersMap from './RecyclersMap';
import { useTranslation } from '../i18n/config.js';
import './FindRecyclers.css';

const PRESET_CITIES = [
  { name: 'Bengaluru', lat: 12.9716, lng: 77.5946 },
  { name: 'Mumbai', lat: 19.0760, lng: 72.8777 },
  { name: 'Delhi-NCR', lat: 28.6139, lng: 77.2090 },
  { name: 'Hyderabad', lat: 17.3850, lng: 78.4867 },
  { name: 'Chennai', lat: 13.0827, lng: 80.2707 },
  { name: 'Pune', lat: 18.5204, lng: 73.8567 },
  { name: 'Kolkata', lat: 22.5726, lng: 88.3639 },
  { name: 'Ahmedabad', lat: 23.0225, lng: 72.5714 },
];

const RADIUS_OPTIONS = [25, 50, 100, 250, 500];

const MATERIALS = [
  { id: 'all', label: 'All Materials' },
  { id: 'PCB', label: 'PCB (Circuit Boards)' },
  { id: 'Battery', label: 'Batteries' },
  { id: 'Cable', label: 'Cables & Wires' },
  { id: 'LCD', label: 'LCD Screens' },
  { id: 'CRT', label: 'CRT Monitors' },
  { id: 'Motor', label: 'Motors & Magnets' },
  { id: 'Plastic', label: 'E-Plastics' },
];

export default function FindRecyclers() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const session = getSession();

  // Initial coordinates from collector session or default city (Bengaluru)
  const initialLat = session?.latitude != null ? Number(session.latitude) : DEFAULT_LAT;
  const initialLng = session?.longitude != null ? Number(session.longitude) : DEFAULT_LNG;

  const [lat, setLat] = useState(initialLat);
  const [lng, setLng] = useState(initialLng);
  const [locationName, setLocationName] = useState(session?.operating_location || 'Bengaluru');
  const [mapCenter, setMapCenter] = useState([initialLat, initialLng]);
  const [radiusKm, setRadiusKm] = useState(100);
  const [selectedMaterial, setSelectedMaterial] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedId, setSelectedId] = useState(null);

  const [detectingGps, setDetectingGps] = useState(false);
  const [gpsSource, setGpsSource] = useState(session?.latitude ? 'Profile City' : 'Default Location');
  const [gpsError, setGpsError] = useState('');

  const [recyclers, setRecyclers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // ── Fetch nearby authorized recyclers by GPS proximity (no prices) ─────────
  const fetchRecyclers = useCallback(async (searchLat, searchLng, searchRadius, searchMat, searchQ) => {
    setLoading(true);
    setError('');
    try {
      const res = await getNearbyRecyclers({
        lat: searchLat,
        lng: searchLng,
        radiusKm: searchRadius,
        material: searchMat !== 'all' ? searchMat : undefined,
        search: searchQ || undefined,
        limit: 100,
      });

      let list = Array.isArray(res.data) ? res.data : [];

      // Auto-expand search radius if none found within local radius
      if (list.length === 0 && searchRadius < 500 && !searchQ && searchMat === 'all') {
        try {
          const resWide = await getNearbyRecyclers({
            lat: searchLat,
            lng: searchLng,
            radiusKm: 500,
            limit: 100,
          });
          if (Array.isArray(resWide.data) && resWide.data.length > 0) {
            list = resWide.data;
            setRadiusKm(500);
          }
        } catch {
          // ignore wide search failure
        }
      }

      setRecyclers(list);

      if (res.center?.lat != null && res.center?.lng != null) {
        setMapCenter([res.center.lat, res.center.lng]);
      }
    } catch (err) {
      setError(err.message || 'Failed to load nearby authorized recyclers');
      setRecyclers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRecyclers(lat, lng, radiusKm, selectedMaterial, searchTerm);
  }, [lat, lng, radiusKm, selectedMaterial, searchTerm, fetchRecyclers]);

  // ── Trigger Live Geolocation ───────────────────────────────────────────────
  const handleDetectGps = () => {
    if (!navigator.geolocation) {
      setGpsError('Geolocation is not supported by your browser.');
      return;
    }

    setDetectingGps(true);
    setGpsError('');

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        const latNum = parseFloat(latitude.toFixed(6));
        const lngNum = parseFloat(longitude.toFixed(6));
        setLat(latNum);
        setLng(lngNum);
        setMapCenter([latNum, lngNum]);
        setGpsSource(`Live GPS (±${Math.round(accuracy)}m)`);
        setLocationName(`GPS: ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`);
        setDetectingGps(false);
      },
      (err) => {
        setDetectingGps(false);
        let msg = 'Could not acquire GPS fix. Please select a city below.';
        if (err.code === 1) msg = 'Location access denied. Enable permissions or select a city.';
        else if (err.code === 2) msg = 'Location unavailable. Please select a city below.';
        else if (err.code === 3) msg = 'GPS acquisition timed out. Please try again.';
        setGpsError(msg);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  // ── City Preset Selection ──────────────────────────────────────────────────
  const handleSelectCity = (cityObj) => {
    setLat(cityObj.lat);
    setLng(cityObj.lng);
    setMapCenter([cityObj.lat, cityObj.lng]);
    setLocationName(cityObj.name);
    setGpsSource(`City Hub: ${cityObj.name}`);
    setGpsError('');
  };

  return (
    <div className="container find-recyclers-page">
      {/* Back Link & Title */}
      <div className="find-recyclers__header animate-fade-in">
        <button
          type="button"
          className="btn btn-ghost btn-sm find-recyclers__back-btn"
          onClick={() => navigate(-1)}
        >
          ← {t('common.back')}
        </button>
        <div className="find-recyclers__titles">
          <h1 className="section-title">{t('dashboard.findRecyclers')}</h1>
          <p className="section-subtitle">
            {t('dashboard.findRecyclersDesc')} — Government authorized buyers mapped strictly by proximity.
          </p>
        </div>
      </div>

      {/* GPS & Filter Control Panel */}
      <div className="find-recyclers__control-panel card animate-slide-up">
        <div className="find-recyclers__gps-row">
          <div className="find-recyclers__gps-info">
            <span className="find-recyclers__gps-badge">
              📍 {gpsSource}
            </span>
            <span className="find-recyclers__coords font-mono">
              {lat.toFixed(4)}° N, {lng.toFixed(4)}° E
            </span>
            {locationName && (
              <span className="find-recyclers__city-name">
                ({locationName})
              </span>
            )}
          </div>

          <button
            type="button"
            className="btn btn-primary find-recyclers__gps-btn"
            onClick={handleDetectGps}
            disabled={detectingGps}
          >
            {detectingGps ? (
              <>
                <LoadingSpinner size="sm" /> Acquiring GPS fix…
              </>
            ) : (
              '📍 Use Detect GPS'
            )}
          </button>
        </div>

        {gpsError && (
          <div className="find-recyclers__gps-alert">
            ⚠️ {gpsError}
          </div>
        )}

        {/* Quick City Selector */}
        <div className="find-recyclers__cities-row">
          <span className="find-recyclers__label">Quick Hubs:</span>
          <div className="find-recyclers__chips">
            {PRESET_CITIES.map((c) => (
              <button
                key={c.name}
                type="button"
                className={`chip ${locationName === c.name ? 'chip--active' : ''}`}
                onClick={() => handleSelectCity(c)}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>

        {/* Radius and Material Filters */}
        <div className="find-recyclers__filters-grid">
          <div className="find-recyclers__filter-col">
            <label className="find-recyclers__label">Search Proximity Radius:</label>
            <div className="find-recyclers__chips">
              {RADIUS_OPTIONS.map((rad) => (
                <button
                  key={rad}
                  type="button"
                  className={`chip ${radiusKm === rad ? 'chip--active' : ''}`}
                  onClick={() => setRadiusKm(rad)}
                >
                  {rad} km
                </button>
              ))}
            </div>
          </div>

          <div className="find-recyclers__filter-col">
            <label className="find-recyclers__label" htmlFor="material-filter">
              Filter by Material:
            </label>
            <select
              id="material-filter"
              className="form-input form-select"
              value={selectedMaterial}
              onChange={(e) => setSelectedMaterial(e.target.value)}
            >
              {MATERIALS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          <div className="find-recyclers__filter-col">
            <label className="find-recyclers__label" htmlFor="search-recycler">
              Search by Name / Area:
            </label>
            <input
              id="search-recycler"
              type="text"
              className="form-input"
              placeholder="Search facility name or location…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Main Content Area: Map and Recycler Directory */}
      <div className="find-recyclers__results-header">
        <h2 className="section-title" style={{ fontSize: 'var(--text-lg)' }}>
          Nearest Authorized Facilities ({recyclers.length})
        </h2>
        <span className="text-muted" style={{ fontSize: 'var(--text-sm)' }}>
          Sorted strictly by straight-line distance from your position
        </span>
      </div>

      {error && (
        <div className="alert alert-error" style={{ marginBottom: 'var(--space-4)' }}>
          {error}
        </div>
      )}

      {/* Interactive Map (Prices completely hidden) */}
      <div className="find-recyclers__map-card card">
        <RecyclersMap
          recyclers={recyclers}
          center={mapCenter}
          radiusKm={radiusKm}
          selectedId={selectedId}
          onSelect={(id) => setSelectedId(id)}
          showPrice={false}
        />
      </div>

      {/* Recyclers List */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 'var(--space-8)' }}>
          <LoadingSpinner size="md" />
          <p style={{ marginTop: 'var(--space-2)', color: 'var(--color-text-muted)' }}>
            Finding nearest authorized buyers…
          </p>
        </div>
      ) : recyclers.length === 0 ? (
        <div className="card find-recyclers__empty-state">
          <div style={{ fontSize: '2.5rem', marginBottom: 'var(--space-2)' }}>🏢</div>
          <h3>No authorized recyclers found within {radiusKm} km</h3>
          <p style={{ color: 'var(--color-text-muted)', marginTop: 'var(--space-1)', maxWidth: '420px', margin: 'auto' }}>
            Try expanding the search radius or choosing a nearby metropolitan hub.
          </p>
          <div style={{ marginTop: 'var(--space-4)', display: 'flex', gap: 'var(--space-2)', justifyContent: 'center' }}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => setRadiusKm(500)}
            >
              Expand to 500 km
            </button>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => {
                setSelectedMaterial('all');
                setSearchTerm('');
              }}
            >
              Reset Filters
            </button>
          </div>
        </div>
      ) : (
        <div className="find-recyclers__cards-grid">
          {recyclers.map((r) => {
            const isSelected = selectedId === r.id;
            const materials = Array.isArray(r.materials_accepted)
              ? r.materials_accepted
              : typeof r.materials_accepted === 'string'
              ? (() => { try { return JSON.parse(r.materials_accepted); } catch { return []; } })()
              : [];

            return (
              <div
                key={r.id}
                id={`recycler-${r.id}`}
                className={`card find-recycler-card ${isSelected ? 'find-recycler-card--selected' : ''}`}
                onClick={() => setSelectedId(r.id)}
              >
                <div className="find-recycler-card__top">
                  <div className="find-recycler-card__titles">
                    <h3 className="find-recycler-card__name">{r.name}</h3>
                    <div className="find-recycler-card__badges">
                      <StatusBadge status={r.authorization_status || 'authorized'} size="sm" />
                      {r.distance_km != null && (
                        <span className="find-recycler-card__dist-badge">
                          🚗 {Number(r.distance_km).toFixed(1)} km away
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="find-recycler-card__details">
                  {r.facility_location && (
                    <div className="find-recycler-card__row">
                      <span className="find-recycler-card__icon">🏢</span>
                      <span className="find-recycler-card__text">{r.facility_location}</span>
                    </div>
                  )}

                  {r.service_area && r.service_area !== r.facility_location && (
                    <div className="find-recycler-card__row">
                      <span className="find-recycler-card__icon">🌐</span>
                      <span className="find-recycler-card__text">Service Area: {r.service_area}</span>
                    </div>
                  )}

                  {r.pickup_availability && (
                    <div className="find-recycler-card__row">
                      <span className="find-recycler-card__icon">🚚</span>
                      <span className="find-recycler-card__text">Pickup: {r.pickup_availability}</span>
                    </div>
                  )}

                  {r.contact_details && (
                    <div className="find-recycler-card__row">
                      <span className="find-recycler-card__icon">📞</span>
                      <span className="find-recycler-card__text">
                        {typeof r.contact_details === 'object'
                          ? [r.contact_details.phone, r.contact_details.email].filter(Boolean).join(' · ') || JSON.stringify(r.contact_details)
                          : String(r.contact_details)}
                      </span>
                    </div>
                  )}
                </div>

                {materials.length > 0 && (
                  <div className="find-recycler-card__materials">
                    <span className="find-recycler-card__mat-title">Authorized Materials:</span>
                    <div className="find-recycler-card__mat-chips">
                      {materials.map((m) => (
                        <span key={m} className="mat-tag">
                          {m}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {r.latitude != null && r.longitude != null && (
                  <div className="find-recycler-card__footer">
                    <a
                      href={`https://www.google.com/maps/dir/?api=1&destination=${r.latitude},${r.longitude}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-outline btn-sm find-recycler-card__dir-btn"
                      onClick={(e) => e.stopPropagation()}
                    >
                      🧭 Open in Google Maps
                    </a>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
