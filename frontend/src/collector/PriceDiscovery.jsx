import { useEffect, useState, useRef, useCallback } from 'react';
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, PointElement, LineElement,
  Title, Tooltip, Legend, Filler,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import {
  getPriceTrends, getRecyclerRateBoard, getInstantValuation,
  getMarketPulse, refreshMarketPrices,
  MATERIAL_CATEGORIES, DEFAULT_LOCATION,
} from '../api/client';
import { PageLoader, SkeletonCard, LoadingSpinner } from '../components/LoadingSpinner';
import { useTranslation } from '../i18n/config.js';
import './PriceDiscovery.css';
import './PriceDiscoveryP2.css';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler);

const LOCATIONS = [
  'Bengaluru', 'Delhi', 'Mumbai', 'Hyderabad', 'Chennai', 'Pune', 'Kolkata', 'Ahmedabad', 'Jaipur',
  'Surat', 'Lucknow', 'Kanpur', 'Nagpur', 'Indore', 'Bhopal', 'Patna', 'Vadodara', 'Ghaziabad',
  'Ludhiana', 'Agra', 'Nashik', 'Faridabad', 'Meerut', 'Rajkot', 'Varanasi', 'Coimbatore',
  'Vijayawada', 'Chandigarh', 'Kochi', 'Noida', 'Gurugram', 'Mysuru', 'Visakhapatnam', 'Guwahati'
];

const BENCHMARK_HUBS = [
  { name: 'Bengaluru', lat: 12.9716, lng: 77.5946 },
  { name: 'Chennai', lat: 13.0827, lng: 80.2707 },
  { name: 'Hyderabad', lat: 17.3850, lng: 78.4867 },
  { name: 'Mumbai', lat: 19.0760, lng: 72.8777 },
  { name: 'Pune', lat: 18.5204, lng: 73.8567 },
  { name: 'Delhi', lat: 28.6139, lng: 77.2090 },
  { name: 'Jaipur', lat: 26.9124, lng: 75.7873 },
  { name: 'Ahmedabad', lat: 23.0225, lng: 72.5714 },
  { name: 'Kolkata', lat: 22.5726, lng: 88.3639 },
];

const SAMPLE_WEIGHT = 1;

function calcDistanceKm(lat1, lon1, lat2, lon2) {
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return null;
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10;
}

function fmt(n) {
  if (n == null) return '—';
  return `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function pctChange(arr) {
  if (!arr || arr.length < 2) return null;
  const first = Number(arr[0].buying_price);
  const last = Number(arr[arr.length - 1].buying_price);
  if (!first) return null;
  return ((last - first) / first) * 100;
}

function trendStats(arr) {
  if (!arr || arr.length === 0) return null;
  const prices = arr.map(t => Number(t.buying_price));
  return {
    min: Math.min(...prices),
    max: Math.max(...prices),
    avg: prices.reduce((a, b) => a + b, 0) / prices.length,
    latest: prices[prices.length - 1],
    change: pctChange(arr),
    count: prices.length,
  };
}

export default function PriceDiscovery() {
  const { t } = useTranslation();
  const [category, setCategory] = useState(MATERIAL_CATEGORIES[2].id);
  const [location, setLocation] = useState(DEFAULT_LOCATION);
  const [days, setDays] = useState(90);

  const [trends, setTrends] = useState([]);
  const [rateRows, setRateRows] = useState([]);
  const [recyclerSearch, setRecyclerSearch] = useState('');
  const [priceCards, setPriceCards] = useState({});
  const [marketPulse, setMarketPulse] = useState(null);
  const [syncingPrices, setSyncingPrices] = useState(false);
  const [syncToast, setSyncToast] = useState('');

  const [userCoords, setUserCoords] = useState(null);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsError, setGpsError] = useState('');

  const [loadingTrend, setLoadingTrend] = useState(true);
  const [loadingRec, setLoadingRec] = useState(true);
  const [loadingCards, setLoadingCards] = useState(true);
  const [error, setError] = useState('');

  const [speaking, setSpeaking] = useState(false);
  const synthRef = useRef(window.speechSynthesis);

  const stats = trendStats(trends);
  const catLabel = MATERIAL_CATEGORIES.find(c => c.id === category)?.label;

  const loadCards = useCallback(() => {
    setLoadingCards(true);
    Promise.allSettled(
      MATERIAL_CATEGORIES.map(cat =>
        getInstantValuation({ category: cat.id, location, weight: SAMPLE_WEIGHT })
          .then(r => ({ id: cat.id, data: r.data }))
          .catch(() => ({ id: cat.id, data: null }))
      )
    ).then(results => {
      const map = {};
      results.forEach(r => {
        if (r.status === 'fulfilled') map[r.value.id] = r.value.data;
      });
      setPriceCards(map);
    }).finally(() => setLoadingCards(false));
  }, [location]);

  useEffect(() => {
    loadCards();
  }, [loadCards]);

  useEffect(() => {
    getMarketPulse(location)
      .then(r => setMarketPulse(r))
      .catch(() => {});
  }, [location]);

  const fetchTrends = useCallback(() => {
    setLoadingTrend(true);
    setError('');
    getPriceTrends({ category, location, days })
      .then(r => setTrends(Array.isArray(r.data) ? r.data : []))
      .catch(() => { setTrends([]); setError(t('prices.loadError')); })
      .finally(() => setLoadingTrend(false));
  }, [category, location, days, t]);

  useEffect(() => { fetchTrends(); }, [fetchTrends]);

  const fetchRecyclerRates = useCallback(() => {
    setLoadingRec(true);
    getRecyclerRateBoard({ category, location })
      .then(r => setRateRows(Array.isArray(r.data) ? r.data : []))
      .catch(() => setRateRows([]))
      .finally(() => setLoadingRec(false));
  }, [category, location]);

  useEffect(() => {
    fetchRecyclerRates();
  }, [fetchRecyclerRates]);

  async function handleSyncLiveMarket() {
    setSyncingPrices(true);
    setSyncToast('');
    setError('');
    try {
      await refreshMarketPrices(days);
      setSyncToast('Market rates synchronized with live commodity scrap indices.');
      fetchTrends();
      loadCards();
      fetchRecyclerRates();
      getMarketPulse(location).then(r => setMarketPulse(r)).catch(() => {});
      setTimeout(() => setSyncToast(''), 4000);
    } catch (err) {
      setError('Could not refresh market prices. Using cached indexes.');
    } finally {
      setSyncingPrices(false);
    }
  }

  function speakPrice() {
    if (!synthRef.current) return;
    synthRef.current.cancel();
    const price = stats?.latest;
    const txt = price
      ? `Current ${catLabel} price in ${location} is Rupees ${Math.round(price)} per kilogram. ${
          stats.change != null ? `Price has ${stats.change > 0 ? 'increased' : 'decreased'} by ${Math.abs(stats.change).toFixed(1)} percent over the last ${days} days.` : ''
        }`
      : `No price data available for ${catLabel} in ${location}.`;
    const utt = new SpeechSynthesisUtterance(txt);
    utt.lang = 'en-IN';
    utt.rate = 0.9;
    utt.onstart = () => setSpeaking(true);
    utt.onend = () => setSpeaking(false);
    utt.onerror = () => setSpeaking(false);
    synthRef.current.speak(utt);
  }

  function stopSpeaking() {
    synthRef.current?.cancel();
    setSpeaking(false);
  }

  const chartLabels = trends.map(t =>
    new Date(t.price_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
  );

  const hasRange = trends.some(t => t.market_range_low != null && t.market_range_high != null);

  const chartDatasets = [
    ...(hasRange ? [{
      label: t('priceDiscovery.marketHigh'),
      data: trends.map(t => Number(t.market_range_high)),
      borderColor: 'rgba(167,139,250,0.4)',
      backgroundColor: 'rgba(167,139,250,0.12)',
      borderWidth: 1,
      borderDash: [4, 4],
      pointRadius: 0,
      tension: 0.4,
      fill: '+1',
    }] : []),
    ...(hasRange ? [{
      label: t('priceDiscovery.marketLow'),
      data: trends.map(t => Number(t.market_range_low)),
      borderColor: 'rgba(167,139,250,0.4)',
      backgroundColor: 'rgba(167,139,250,0.12)',
      borderWidth: 1,
      borderDash: [4, 4],
      pointRadius: 0,
      tension: 0.4,
      fill: false,
    }] : []),
    {
      label: `${catLabel} ${t('priceDiscovery.buyingPrice')} (₹/kg)`,
      data: trends.map(t => Number(t.buying_price)),
      borderColor: '#7C3AED',
      backgroundColor: 'rgba(124,58,237,0.08)',
      borderWidth: 2.5,
      pointRadius: trends.length > 30 ? 0 : 4,
      pointHoverRadius: 7,
      pointBackgroundColor: '#7C3AED',
      tension: 0.4,
      fill: false,
    },
  ];

  const chartData = { labels: chartLabels, datasets: chartDatasets };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: {
        display: hasRange,
        position: 'bottom',
        labels: { boxWidth: 12, font: { size: 12 }, color: '#6B7280' },
        filter: item => item.text !== t('priceDiscovery.marketLow'),
      },
      tooltip: {
        callbacks: {
          label: ctx => {
            if (ctx.dataset.label === t('priceDiscovery.marketLow')) return null;
            return `${ctx.dataset.label}: ₹${ctx.parsed.y.toLocaleString('en-IN')}/kg`;
          },
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { maxTicksLimit: 8, color: '#6B7280', font: { size: 12 } },
      },
      y: {
        grid: { color: 'rgba(124,58,237,0.05)' },
        ticks: {
          color: '#6B7280',
          font: { size: 12 },
          callback: v => `₹${v}`,
        },
      },
    },
  };

  function handleDetectGPS() {
    if (!navigator.geolocation) {
      setGpsError('Geolocation is not supported by your browser.');
      return;
    }
    setGpsLoading(true);
    setGpsError('');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        let closestHub = 'Bengaluru';
        let minDist = Infinity;
        for (const hub of BENCHMARK_HUBS) {
          const dist = calcDistanceKm(lat, lng, hub.lat, hub.lng);
          if (dist != null && dist < minDist) {
            minDist = dist;
            closestHub = hub.name;
          }
        }
        setUserCoords({ lat, lng, closestHub, distanceToHub: minDist });
        setLocation(closestHub);
        setGpsLoading(false);
      },
      (err) => {
        setGpsError(err.message || 'Unable to retrieve your GPS location.');
        setGpsLoading(false);
      },
      { timeout: 10000, enableHighAccuracy: true }
    );
  }

  const filteredRecyclers = [...rateRows]
    .filter(r => {
      const mats = r.materials_accepted || [];
      if (mats.includes(category)) return true;
      if (category === 'Plastic' && (mats.includes('Mixed Plastic') || mats.includes('Plastics') || mats.includes('Mixed Plastics'))) return true;
      if (category === 'Mixed Plastic' && (mats.includes('Plastic') || mats.includes('Plastics'))) return true;
      if (category === 'Motor' && (mats.includes('Motor/Magnet Assembly') || mats.includes('Motors'))) return true;
      if (category === 'Motor/Magnet Assembly' && (mats.includes('Motor') || mats.includes('Motors'))) return true;
      if (category === 'LCD' && (mats.includes('LCD Panel') || mats.includes('LCD Panels'))) return true;
      if (category === 'LCD Panel' && (mats.includes('LCD') || mats.includes('LCD Panels'))) return true;
      return false;
    })
    .map(r => {
      const distance = userCoords
        ? calcDistanceKm(userCoords.lat, userCoords.lng, r.latitude, r.longitude)
        : null;
      return { ...r, distance };
    })
    .filter(r => {
      if (!recyclerSearch.trim()) return true;
      const q = recyclerSearch.toLowerCase().trim();
      const name = (r.name || '').toLowerCase();
      const addr = (r.facility_location || r.service_area || '').toLowerCase();
      return name.includes(q) || addr.includes(q);
    })
    .sort((a, b) => {
      if (userCoords && a.distance != null && b.distance != null) {
        return a.distance - b.distance;
      }
      return (b.offered_rate || 0) - (a.offered_rate || 0);
    });
  const rateAsOf = rateRows.reduce((best, r) =>
    r.rate_date && (!best || r.rate_date > best) ? r.rate_date : best, null);

  const currentPulseItem = (marketPulse?.data || []).find(p => p.category === category);

  return (
    <div className="container">
      <div className="animate-fade-in" style={{ marginBottom: 'var(--space-6)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 'var(--space-4)' }}>
        <div>
          <h1 className="section-title">{t('dashboard.priceBoard')}</h1>
          <p className="section-subtitle">{t('priceDiscovery.subtitle')}</p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
          <button
            className="btn btn-outline"
            onClick={handleSyncLiveMarket}
            disabled={syncingPrices}
            title="Fetch latest e-waste commodity benchmark rates across India"
          >
            {syncingPrices ? <><LoadingSpinner size="sm" /> Syncing…</> : '⚡ Sync Live Market Rates'}
          </button>
        </div>
      </div>

      {syncToast && (
        <div className="alert-banner alert-banner--success animate-fade-in" style={{ marginBottom: 'var(--space-4)' }}>
          ✅ {syncToast}
        </div>
      )}

      {currentPulseItem && (
        <div className="card animate-fade-in" style={{ background: 'linear-gradient(135deg, rgba(124, 58, 237, 0.05) 0%, rgba(31, 120, 200, 0.05) 100%)', border: '1px solid rgba(124, 58, 237, 0.15)', padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius-md)', marginBottom: 'var(--space-4)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <span style={{ fontSize: '1.1rem' }}>📈</span>
            <span style={{ fontSize: 'var(--text-sm)' }}>
              <strong>Market Driver:</strong> {currentPulseItem.commodity_driver}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
            <span className="status-badge status-badge--success" style={{ fontSize: 'var(--text-xs)' }}>
              Demand: {currentPulseItem.regional_demand}
            </span>
            <span className="status-badge" style={{ fontSize: 'var(--text-xs)' }}>
              {currentPulseItem.hub}
            </span>
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="p2-pd-controls animate-fade-in">
        <div className="form-group" style={{ flex: 1, minWidth: 200 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-1)' }}>
            <label className="form-label" htmlFor="pd-location" style={{ marginBottom: 0 }}>{t('prices.location')}</label>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={handleDetectGPS}
              disabled={gpsLoading}
              style={{ fontSize: 'var(--text-xs)', padding: '2px 8px', borderColor: 'var(--color-primary)', color: 'var(--color-primary)' }}
              title="Detect your exact GPS coordinates and match closest pricing hub"
            >
              {gpsLoading ? '📍 Locating…' : '📍 Use GPS'}
            </button>
          </div>
          <select
            id="pd-location"
            className="form-input form-select"
            value={location}
            onChange={e => { setLocation(e.target.value); setUserCoords(null); }}
          >
            {LOCATIONS.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
          {userCoords && (
            <span className="text-xs text-muted" style={{ display: 'block', marginTop: '4px' }}>
              📍 GPS: {userCoords.lat.toFixed(4)}, {userCoords.lng.toFixed(4)} ({userCoords.distanceToHub.toFixed(1)} km to {userCoords.closestHub} hub)
            </span>
          )}
          {gpsError && (
            <span className="text-xs text-danger" style={{ display: 'block', marginTop: '4px', color: 'var(--color-danger)' }}>
              ⚠️ {gpsError}
            </span>
          )}
        </div>
        <div className="form-group" style={{ flex: 1, minWidth: 130 }}>
          <label className="form-label" htmlFor="pd-days">{t('prices.days')}</label>
          <select
            id="pd-days"
            className="form-input form-select"
            value={days}
            onChange={e => setDays(Number(e.target.value))}
          >
            <option value={30}>{t('prices.day30')}</option>
            <option value={60}>{t('prices.day60')}</option>
            <option value={90}>{t('prices.day90')}</option>
          </select>
        </div>
      </div>

      {/* Section 1 — Price Cards */}
      <section className="animate-fade-in" aria-labelledby="regional-prices-heading">
        <div className="p2-section-row">
          <h2 id="regional-prices-heading" className="section-title" style={{ fontSize: 'var(--text-xl)' }}>
            {t('priceDiscovery.regionalPrices')}
          </h2>
          <span className="text-sm text-muted">
            {t('prices.priceCard', { category: '', location }).replace(' — ', '')} · {t('prices.buyingPrice').toLowerCase()}
          </span>
        </div>

        <div className="p2-price-cards-grid">
          {loadingCards
            ? MATERIAL_CATEGORIES.map(c => <SkeletonCard key={c.id} />)
            : MATERIAL_CATEGORIES.map((cat, i) => {
                const card = priceCards[cat.id];
                const isSelected = category === cat.id;
                return (
                  <button
                    key={cat.id}
                    className={`p2-price-card stagger-item ${isSelected ? 'p2-price-card--active' : ''} ${!card ? 'p2-price-card--nodata' : ''}`}
                    style={{ animationDelay: `${i * 50}ms` }}
                    onClick={() => setCategory(cat.id)}
                    aria-pressed={isSelected}
                  >
                    <div className="p2-price-card__icon" aria-hidden="true">{cat.icon}</div>
                    <div className="p2-price-card__label">{cat.label}</div>
                    <div className="region-card__row">
                      <span>{t('priceDiscovery.unitPrice')}</span>
                      <span className="region-card__val font-mono">{card ? fmt(card.unit_price) : t('common.noData')} <span className="text-muted">/ {t('common.kg')}</span></span>
                    </div>
                    {card && (
                      <div className="region-card__row">
                        <span>{t('priceDiscovery.marketRange')}</span>
                        <span className="region-card__val font-mono">{fmt(card.market_range_low)}–{fmt(card.market_range_high)}</span>
                      </div>
                    )}
                    {isSelected && (
                      <div className="p2-price-card__active-bar" aria-hidden="true" />
                    )}
                  </button>
                );
              })
          }
        </div>
      </section>

      {/* Section 2 — Hero + Speak */}
      <div className="p2-hero-row animate-fade-in">
        <div className="cat-tabs" role="tablist" aria-label={t('prices.selectCategory')}>
          {MATERIAL_CATEGORIES.map(cat => (
            <button
              key={cat.id}
              role="tab"
              aria-selected={category === cat.id}
              className={`cat-tab ${category === cat.id ? 'cat-tab--active' : ''}`}
              onClick={() => setCategory(cat.id)}
            >
              <span aria-hidden="true">{cat.icon}</span>
              <span>{cat.label}</span>
            </button>
          ))}
        </div>

        <div className="price-hero card">
          <div className="price-hero__info">
            <p className="price-hero__label">
              {t('prices.priceCard', { category: catLabel, location })}
            </p>
            <div className="price-main-stat__content">
              <span className="price-main-stat__value">{stats?.latest ? fmt(stats.latest) : loadingTrend ? '…' : t('common.noData')}</span>
              {stats?.latest && <span className="price-main-stat__unit">/ {t('common.kg')}</span>}
            </div>
            {stats?.change != null && (
              <p className={`p2-price-change ${stats.change >= 0 ? 'p2-price-change--up' : 'p2-price-change--down'}`}>
                <span aria-hidden="true">{stats.change >= 0 ? '▲' : '▼'}</span>
                {Math.abs(stats.change).toFixed(1)}% vs {days}d ago
              </p>
            )}
          </div>
          <button
            className={`speak-btn ${speaking ? 'speak-btn--active' : ''}`}
            onClick={speaking ? stopSpeaking : speakPrice}
            aria-label={speaking ? t('priceDiscovery.stopAudio') : t('priceDiscovery.speakPrice')}
          >
            <span aria-hidden="true">{speaking ? '' : ''}</span>
            <span>{speaking ? t('priceDiscovery.stopAudio') : t('priceDiscovery.speakPrice')}</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="alert-banner alert-banner--warn animate-fade-in">
           {error}
        </div>
      )}

      {/* Section 3 — Trend Chart */}
      <section className="card animate-fade-in" aria-labelledby="chart-heading">
        <div className="chart-header">
          <h2 id="chart-heading" className="section-title" style={{ fontSize: 'var(--text-xl)' }}>
            {t('prices.trendChart')} — {catLabel}
          </h2>
          <span className="text-sm text-muted">{days} {t('prices.days')} · {location}</span>
        </div>

        {stats && !loadingTrend && (
          <div className="p2-stat-chips">
            <div className="p2-stat-chip">
              <span className="p2-stat-chip__label">{t('prices.min')}</span>
              <span className="p2-stat-chip__value">{fmt(stats.min)}</span>
            </div>
            <div className="p2-stat-chip p2-stat-chip--accent">
              <span className="p2-stat-chip__label">{t('prices.latest')}</span>
              <span className="p2-stat-chip__value">{fmt(stats.latest)}</span>
            </div>
            <div className="p2-stat-chip">
              <span className="p2-stat-chip__label">{t('prices.avg')}</span>
              <span className="p2-stat-chip__value">{fmt(Math.round(stats.avg))}</span>
            </div>
            <div className="p2-stat-chip">
              <span className="p2-stat-chip__label">{t('prices.max')}</span>
              <span className="p2-stat-chip__value">{fmt(stats.max)}</span>
            </div>
            <div className={`p2-stat-chip ${stats.change != null ? (stats.change >= 0 ? 'p2-stat-chip--up' : 'p2-stat-chip--down') : ''}`}>
              <span className="p2-stat-chip__label">{t('prices.change')}</span>
              <span className="p2-stat-chip__value">
                {stats.change != null
                  ? `${stats.change >= 0 ? '+' : ''}${stats.change.toFixed(1)}%`
                  : '—'}
              </span>
            </div>
          </div>
        )}

        {loadingTrend ? (
          <PageLoader />
        ) : trends.length === 0 ? (
          <div className="empty-state" style={{ minHeight: 200 }}>
            
            <p style={{ fontWeight: 'var(--weight-semibold)' }}>
              {t('prices.noTrendData')}
            </p>
          </div>
        ) : (
          <div
            className="chart-wrap"
            role="img"
            aria-label={`Price trend for ${catLabel} in ${location} over ${days} days. Current price: ${fmt(stats?.latest)}/kg`}
          >
            <Line data={chartData} options={chartOptions} />
          </div>
        )}

        {trends.length > 0 && (
          <details className="chart-table-details">
            <summary className="chart-table-summary">
              {t('prices.trendChartDesc')} ({trends.length} {t('prices.dataPoints')})
            </summary>
            <div style={{ overflowX: 'auto', marginTop: 'var(--space-4)' }}>
              <table className="price-table" aria-label="Price history data">
                <thead>
                  <tr>
                    <th>{t('dashboard.date')}</th>
                    <th>{t('prices.location')}</th>
                    <th>{t('prices.buyingPrice')}</th>
                    <th>{t('prices.min')}</th>
                    <th>{t('prices.max')}</th>
                  </tr>
                </thead>
                <tbody>
                  {[...trends].reverse().slice(0, 30).map((t, i) => (
                    <tr key={i}>
                      <td>{new Date(t.price_date).toLocaleDateString('en-IN')}</td>
                      <td>{location}</td>
                      <td style={{ fontWeight: 'var(--weight-semibold)', color: 'var(--color-primary)' }}>
                        {fmt(t.buying_price)}/kg
                      </td>
                      <td>{fmt(t.market_range_low)}</td>
                      <td>{fmt(t.market_range_high)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
      </section>

      {/* Section 4 — Recycler Rates */}
      <section className="card animate-fade-in" aria-labelledby="rates-heading">
        <h2 id="rates-heading" className="section-title" style={{ fontSize: 'var(--text-xl)', marginBottom: 'var(--space-4)' }}>
          {t('prices.recyclerRates')} — {catLabel}
        </h2>
        <p className="section-subtitle" style={{ marginBottom: 'var(--space-5)' }}>
          {t('prices.currentRatesDesc')}
        </p>
        {rateAsOf && (
          <p className="text-sm text-muted" style={{ marginBottom: 'var(--space-4)' }}>
            {t('prices.rateAsOf', { date: rateAsOf })}
          </p>
        )}

        {/* Search filter for recycler rates */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-4)', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: '1 1 240px', minWidth: '220px' }}>
            <span style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', opacity: 0.6, fontSize: '0.9rem' }} aria-hidden="true">🔍</span>
            <input
              type="text"
              className="form-input"
              placeholder="Filter by recycler name or address…"
              value={recyclerSearch}
              onChange={(e) => setRecyclerSearch(e.target.value)}
              style={{ paddingLeft: '32px', paddingRight: recyclerSearch ? '32px' : '10px', fontSize: 'var(--text-sm)' }}
              aria-label="Filter recyclers by name or address"
            />
            {recyclerSearch && (
              <button
                type="button"
                onClick={() => setRecyclerSearch('')}
                style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', opacity: 0.6, fontSize: '1rem', padding: '2px 6px' }}
                title="Clear filter"
                aria-label="Clear filter"
              >
                ✕
              </button>
            )}
          </div>
          {recyclerSearch && (
            <span className="text-xs text-muted">
              Showing {filteredRecyclers.length} of {rateRows.filter(r => (r.materials_accepted || []).includes(category)).length} recyclers
            </span>
          )}
        </div>

        {loadingRec ? (
          <PageLoader />
        ) : filteredRecyclers.length === 0 ? (
          <div className="empty-state" style={{ minHeight: 100 }}>
            <p>{recyclerSearch ? `No recyclers match "${recyclerSearch}".` : t('prices.noRecyclers')}</p>
            {recyclerSearch && (
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => setRecyclerSearch('')}
                style={{ marginTop: 'var(--space-2)' }}
              >
                Clear Filter
              </button>
            )}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="price-table" aria-label="Authorized recycler rates">
              <thead>
                <tr>
                  <th>{t('prices.recyclerName')}</th>
                  <th>{t('prices.location')}</th>
                  {userCoords && <th>Distance</th>}
                  <th>{t('prices.offered')}</th>
                  <th>{t('prices.pickup')}</th>
                  <th>vs {t('prices.buyingPrice')}</th>
                </tr>
              </thead>
              <tbody>
                {filteredRecyclers
                  .map((r, i) => {
                    const marketPrice = priceCards[category]?.unit_price;
                    const vsMkt = marketPrice && r.offered_rate
                      ? ((r.offered_rate - marketPrice) / marketPrice * 100).toFixed(1)
                      : null;
                    return (
                      <tr key={r.recycler_id}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                            {i === 0 && r.offered_rate && (
                              <span className="p2-best-badge" title="Best rate"></span>
                            )}
                            <span style={{ fontWeight: 'var(--weight-semibold)' }}>{r.name}</span>
                          </div>
                        </td>
                        <td style={{ color: 'var(--color-text-muted)' }}>
                          {r.facility_location}
                        </td>
                        {userCoords && (
                          <td style={{ color: 'var(--color-primary)', fontWeight: 'var(--weight-medium)' }}>
                            {r.distance != null ? `📍 ${r.distance} km` : '—'}
                          </td>
                        )}
                        <td style={{ fontWeight: 'var(--weight-bold)', color: 'var(--color-accent)' }}>
                          {r.offered_rate ? `${fmt(r.offered_rate)}/kg` : '—'}
                        </td>
                        <td>
                          <span style={{ color: r.pickup_availability === 'daily' ? 'var(--color-success)' : 'var(--color-text-muted)' }}>
                            {r.pickup_availability === 'daily' ? ` ${t('prices.yes')}` : ` ${t('prices.no')}`}
                          </span>
                        </td>
                        <td>
                          {vsMkt != null ? (
                            <span className={`p2-vs-market ${Number(vsMkt) >= 0 ? 'p2-vs-market--up' : 'p2-vs-market--down'}`}>
                              {Number(vsMkt) >= 0 ? '+' : ''}{vsMkt}%
                            </span>
                          ) : '—'}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
