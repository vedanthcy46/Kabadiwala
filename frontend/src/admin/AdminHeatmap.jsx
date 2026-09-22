import { useState, useEffect, useMemo, useRef } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
// Ensure window.L is defined before leaflet.heat loads
if (typeof window !== 'undefined' && !window.L) {
  window.L = L;
}

// Region coordinates for quick navigation
const REGION_CENTERS = {
  all: { center: [21.5937, 78.9629], zoom: 5, label: 'All India' },
  maharashtra: { center: [19.7515, 75.7139], zoom: 7, label: 'Maharashtra (140)' },
  up: { center: [26.8467, 80.9462], zoom: 7, label: 'Uttar Pradesh (121)' },
  karnataka: { center: [13.2, 76.8], zoom: 7, label: 'Karnataka (72)' },
  haryana: { center: [28.7, 76.9], zoom: 8, label: 'Delhi-NCR / Haryana (43)' },
  tamilnadu: { center: [11.1271, 78.6569], zoom: 7, label: 'Tamil Nadu (42)' },
  gujarat: { center: [22.2587, 71.1924], zoom: 7, label: 'Gujarat (41)' },
};

// Heatmap Leaflet layer controller
function HeatmapLayer({ points, options }) {
  const map = useMap();
  const heatLayerRef = useRef(null);

  useEffect(() => {
    if (!map || !points || points.length === 0) return;

    function renderHeat() {
      if (heatLayerRef.current) {
        map.removeLayer(heatLayerRef.current);
        heatLayerRef.current = null;
      }
      try {
        if (typeof L !== 'undefined' && typeof L.heatLayer === 'function') {
          const heatData = points.map((p) => [p.lat, p.lng, p.intensity || 0.6]);
          const layer = L.heatLayer(heatData, {
            radius: options?.radius ?? 28,
            blur: options?.blur ?? 18,
            maxZoom: 14,
            max: 1.0,
            minOpacity: 0.35,
            gradient: {
              0.2: '#3B82F6', // Blue (low density)
              0.4: '#06B6D4', // Cyan
              0.6: '#10B981', // Emerald green
              0.8: '#F59E0B', // Amber
              1.0: '#EF4444', // Hot red (high density cluster)
            },
          });
          layer.addTo(map);
          heatLayerRef.current = layer;
        }
      } catch (err) {
        console.warn('Leaflet.heat failed to render:', err);
      }
    }

    if (typeof L !== 'undefined' && typeof L.heatLayer !== 'function') {
      if (!document.getElementById('leaflet-heat-script')) {
        const script = document.createElement('script');
        script.id = 'leaflet-heat-script';
        script.src = 'https://unpkg.com/leaflet.heat@0.2.0/dist/leaflet-heat.js';
        script.onload = () => renderHeat();
        document.body.appendChild(script);
      } else {
        const scriptEl = document.getElementById('leaflet-heat-script');
        scriptEl.addEventListener('load', renderHeat, { once: true });
      }
    } else {
      renderHeat();
    }

    return () => {
      if (heatLayerRef.current && map) {
        map.removeLayer(heatLayerRef.current);
        heatLayerRef.current = null;
      }
    };
  }, [map, points, options?.radius, options?.blur]);

  return null;
}

// Controller to animate map pan/zoom when region changes
function MapCameraController({ center, zoom }) {
  const map = useMap();
  useEffect(() => {
    if (!map || !center) return;
    map.flyTo(center, zoom, { duration: 1.2, easeLinearity: 0.25 });
  }, [map, center, zoom]);
  return null;
}

export default function AdminHeatmap({ heatmapData, loading }) {
  const [activeLayer, setActiveLayer] = useState('combined'); // 'heat' | 'pins' | 'combined'
  const [statusFilter, setStatusFilter] = useState('all'); // 'all' | 'authorized' | 'pending' | 'unauthorized'
  const [selectedRegion, setSelectedRegion] = useState('all');
  const [selectedPoint, setSelectedPoint] = useState(null);
  const [showStateList, setShowStateList] = useState(false);

  const rawPoints = heatmapData?.points || [];
  const regionalSummary = heatmapData?.regionalSummary || [];

  // Filter points based on selected status
  const filteredPoints = useMemo(() => {
    if (statusFilter === 'all') return rawPoints;
    return rawPoints.filter((p) => p.status === statusFilter);
  }, [rawPoints, statusFilter]);

  const currentRegion = REGION_CENTERS[selectedRegion] || REGION_CENTERS.all;

  // Key stats
  const totalRecyclers = rawPoints.length;
  const authorizedCount = rawPoints.filter((p) => p.status === 'authorized').length;
  const pendingCount = rawPoints.filter((p) => p.status === 'pending').length;
  const unauthorizedCount = rawPoints.filter((p) => p.status === 'unauthorized').length;

  return (
    <section className="admin-heatmap-section card animate-fade-in" aria-label="National Recycler & E-Waste Heatmap">
      {/* Header */}
      <div className="admin-heatmap-header">
        <div>
          <div className="admin-heatmap-title-row">
            <h2 className="admin-chart-title">National E-Waste Infrastructure Heatmap</h2>
            <span className="admin-heat-live-pill">
              <span className="live-pulse-dot" /> Live Geo-Registry
            </span>
          </div>
          <p className="admin-chart-sub">
            Geospatial density of 570+ authorized &amp; formalizing recycling facilities across India, highlighting last-mile collection access
          </p>
        </div>

        {/* Quick stat chips */}
        <div className="admin-heatmap-quickstats">
          <div className="heat-stat-chip">
            <span className="heat-stat-val">{totalRecyclers}</span>
            <span className="heat-stat-lbl">Mapped Facilities</span>
          </div>
          <div className="heat-stat-chip heat-stat-chip--green">
            <span className="heat-stat-val">{authorizedCount}</span>
            <span className="heat-stat-lbl">SPCB Authorized</span>
          </div>
          {pendingCount > 0 && (
            <div className="heat-stat-chip heat-stat-chip--amber">
              <span className="heat-stat-val">{pendingCount}</span>
              <span className="heat-stat-lbl">Pending Review</span>
            </div>
          )}
          {unauthorizedCount > 0 && (
            <div className="heat-stat-chip heat-stat-chip--red">
              <span className="heat-stat-val">{unauthorizedCount}</span>
              <span className="heat-stat-lbl">Unauthorized</span>
            </div>
          )}
        </div>
      </div>

      {/* Controls Bar */}
      <div className="admin-heatmap-toolbar">
        {/* Layer Mode Switch */}
        <div className="heatmap-control-group">
          <span className="heatmap-control-label">Layer:</span>
          <div className="btn-group">
            <button
              type="button"
              className={`btn btn-sm ${activeLayer === 'combined' ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setActiveLayer('combined')}
            >
              🔥 Combined
            </button>
            <button
              type="button"
              className={`btn btn-sm ${activeLayer === 'heat' ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setActiveLayer('heat')}
            >
              🌡️ Heat Only
            </button>
            <button
              type="button"
              className={`btn btn-sm ${activeLayer === 'pins' ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setActiveLayer('pins')}
            >
              📍 Facilities Only
            </button>
          </div>
        </div>

        {/* Status Filter */}
        <div className="heatmap-control-group">
          <span className="heatmap-control-label">Status:</span>
          <select
            className="form-input heatmap-select"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">All Facilities ({totalRecyclers})</option>
            <option value="authorized">Authorized Only ({authorizedCount})</option>
            {pendingCount > 0 && <option value="pending">Pending Queue ({pendingCount})</option>}
            {unauthorizedCount > 0 && <option value="unauthorized">Unauthorized / Unverified ({unauthorizedCount})</option>}
          </select>
        </div>

        {/* Region Quick Zoom */}
        <div className="heatmap-control-group">
          <span className="heatmap-control-label">Focus Region:</span>
          <select
            className="form-input heatmap-select"
            value={selectedRegion}
            onChange={(e) => setSelectedRegion(e.target.value)}
          >
            {Object.entries(REGION_CENTERS).map(([key, cfg]) => (
              <option key={key} value={key}>
                {cfg.label}
              </option>
            ))}
          </select>
        </div>

        {/* Toggle regional stats */}
        <button
          type="button"
          className={`btn btn-sm ${showStateList ? 'btn-accent' : 'btn-outline'}`}
          onClick={() => setShowStateList(!showStateList)}
        >
          📊 State Distribution {showStateList ? '▲' : '▼'}
        </button>
      </div>

      {/* Regional summary breakdown collapse */}
      {showStateList && regionalSummary.length > 0 && (
        <div className="admin-heatmap-regions-drawer animate-fade-in">
          <div className="drawer-header">
            <strong>State-Wise E-Waste Facility Density</strong>
            <span className="text-muted" style={{ fontSize: '0.85em' }}>
              Showing top regional hubs participating in Extended Producer Responsibility (EPR)
            </span>
          </div>
          <div className="regions-grid">
            {regionalSummary.slice(0, 10).map((r) => {
              const pct = totalRecyclers > 0 ? Math.round((r.recycler_count / totalRecyclers) * 100) : 0;
              return (
                <div key={r.state} className="region-stat-box">
                  <div className="region-stat-top">
                    <span className="region-stat-name">{r.state}</span>
                    <strong className="region-stat-count">{r.recycler_count} facilities</strong>
                  </div>
                  <div className="region-bar-track">
                    <div
                      className="region-bar-fill"
                      style={{ width: `${Math.min(100, pct * 3)}%` }}
                    />
                  </div>
                  <div className="region-stat-bottom">
                    <span>{r.authorized_count} authorized</span>
                    <span>{pct}% share</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Map Canvas Container */}
      <div className="admin-heatmap-container" style={{ position: 'relative', height: '480px', width: '100%', borderRadius: '12px', overflow: 'hidden' }}>
        {loading ? (
          <div className="heatmap-loading-overlay">
            <span className="loading-spinner" />
            <span>Loading nationwide spatial data...</span>
          </div>
        ) : (
          <MapContainer
            center={currentRegion.center}
            zoom={currentRegion.zoom}
            scrollWheelZoom={true}
            style={{ height: '100%', width: '100%' }}
          >
            {/* Clean OpenStreetMap Tile Layer (No API Key Required) */}
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />

            <MapCameraController center={currentRegion.center} zoom={currentRegion.zoom} />

            {/* Continuous Heatmap Layer */}
            {(activeLayer === 'heat' || activeLayer === 'combined') && (
              <HeatmapLayer
                points={filteredPoints}
                options={{
                  radius: 32,
                  blur: 20,
                }}
              />
            )}

            {/* Individual Interactive Facility Circles */}
            {(activeLayer === 'pins' || activeLayer === 'combined') &&
              filteredPoints.map((p) => {
                const isAuthorized = p.status === 'authorized';
                const isPending = p.status === 'pending';
                const color = isAuthorized ? '#10B981' : isPending ? '#F59E0B' : '#EF4444';

                return (
                  <CircleMarker
                    key={`point-${p.id}`}
                    center={[p.lat, p.lng]}
                    radius={activeLayer === 'combined' ? 4.5 : 6}
                    pathOptions={{
                      color: '#ffffff',
                      weight: 1.2,
                      fillColor: color,
                      fillOpacity: activeLayer === 'combined' ? 0.75 : 0.9,
                    }}
                    eventHandlers={{
                      click: () => setSelectedPoint(p),
                    }}
                  >
                    <Tooltip direction="top" offset={[0, -6]} opacity={0.9}>
                      <strong>{p.name}</strong>
                      <br />
                      <span style={{ fontSize: '0.85em', color: color }}>
                        ● {p.status.toUpperCase()}
                      </span>
                    </Tooltip>

                    <Popup>
                      <div className="heatmap-popup-content">
                        <div className="heatmap-popup-badge" style={{ background: `${color}1a`, color }}>
                          {isAuthorized ? '✓ SPCB AUTHORIZED' : isPending ? '⏳ PENDING REVIEW' : '✕ UNAUTHORIZED'}
                        </div>
                        <h4 className="heatmap-popup-title">{p.name}</h4>
                        {p.facilityLocation && (
                          <div className="heatmap-popup-loc">
                            📍 {p.facilityLocation}
                          </div>
                        )}
                        {p.serviceArea && (
                          <div className="heatmap-popup-meta">
                            <strong>Service Area:</strong> {p.serviceArea}
                          </div>
                        )}
                        {p.txnCount > 0 && (
                          <div className="heatmap-popup-meta">
                            <strong>Transactions:</strong> {p.txnCount} handovers ({p.totalKg} kg)
                          </div>
                        )}
                        {p.materialsAccepted && (
                          <div className="heatmap-popup-materials">
                            <strong>Materials Accepted:</strong>
                            <div className="materials-tags">
                              {Array.isArray(p.materialsAccepted) ? (
                                p.materialsAccepted.map((m) => (
                                  <span key={m} className="material-tag">
                                    {m}
                                  </span>
                                ))
                              ) : (
                                <span className="material-tag">E-Waste Streams</span>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </Popup>
                  </CircleMarker>
                );
              })}
          </MapContainer>
        )}

        {/* Floating Map Legend */}
        <div className="heatmap-map-legend">
          <div className="legend-title">Density &amp; Status</div>
          <div className="legend-gradient-bar">
            <span>Low</span>
            <div className="gradient-track" />
            <span>High Density</span>
          </div>
          <div className="legend-status-items">
            <span className="legend-status-dot dot-authorized">
              <span className="dot" /> Authorized ({authorizedCount})
            </span>
            {pendingCount > 0 && (
              <span className="legend-status-dot dot-pending">
                <span className="dot" /> Pending ({pendingCount})
              </span>
            )}
            {unauthorizedCount > 0 && (
              <span className="legend-status-dot dot-unauthorized">
                <span className="dot" /> Unauthorized ({unauthorizedCount})
              </span>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
