import { useState, useEffect, useMemo, useRef } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const CATEGORY_COLORS = {
  'PCB':                    '#7C3AED',
  'Battery':                '#16A34A',
  'CRT':                    '#2563EB',
  'LCD':                    '#D97706',
  'Cable':                  '#DB2777',
  'Cables':                 '#DB2777',
  'Motors':                 '#0891B2',
  'Motor/Magnet Assembly':  '#0891B2',
  'Plastics':               '#65A30D',
  'Mixed Plastic':          '#65A30D',
  'Mixed E-Scrap':          '#9333EA',
  'Unknown':                '#64748B',
};

const STATUS_COLORS = {
  'confirmed':   '#10B981',
  'COMPLETED':   '#10B981',
  'completed':   '#10B981',
  'quoted':      '#F59E0B',
  'PENDING':     '#F59E0B',
  'pending':     '#F59E0B',
  'in_progress': '#3B82F6',
  'IN_PROGRESS': '#3B82F6',
  'cancelled':   '#EF4444',
  'CANCELLED':   '#EF4444',
};

const REGION_CENTERS = {
  karnataka:   { center: [12.9716, 77.5946], zoom: 11, label: 'Bengaluru / Karnataka' },
  all:         { center: [20.5937, 78.9629], zoom: 5,  label: 'All India' },
  maharashtra: { center: [19.0760, 72.8777], zoom: 9,  label: 'Mumbai / Maharashtra' },
  delhi:       { center: [28.6139, 77.2090], zoom: 9,  label: 'Delhi NCR' },
  tamilnadu:   { center: [13.0827, 80.2707], zoom: 9,  label: 'Chennai / Tamil Nadu' },
  hyderabad:   { center: [17.3850, 78.4867], zoom: 9,  label: 'Hyderabad' },
  kolkata:     { center: [22.5726, 88.3639], zoom: 9,  label: 'Kolkata' },
};

// ── Map View Controller: ensures map updates smoothly on focus changes ────────
function MapViewController({ center, zoom }) {
  const map = useMap();
  useEffect(() => {
    if (map && center) {
      map.setView(center, zoom, { animate: true });
    }
  }, [map, center, zoom]);
  return null;
}

// ── Native Canvas Heatmap Layer (100% reliable, zero external plugin quirks) ─
function CanvasHeatmapLayer({ points, radius = 52, blur = 28, minOpacity = 0.45 }) {
  const map = useMap();
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!map || !points?.length) return;

    const pane = map.getPane('overlayPane');
    if (!pane) return;

    const canvas = L.DomUtil.create('canvas', 'leaflet-heatmap-layer');
    canvas.style.pointerEvents = 'none';
    canvas.style.position = 'absolute';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.zIndex = '350';
    pane.appendChild(canvas);
    canvasRef.current = canvas;

    // Pre-render gradient palette (256x1 canvas)
    const gradCanvas = document.createElement('canvas');
    gradCanvas.width = 1;
    gradCanvas.height = 256;
    const gCtx = gradCanvas.getContext('2d');
    const grad = gCtx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0.0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.2, '#3B82F6'); // Cool blue (low density)
    grad.addColorStop(0.4, '#06B6D4'); // Cyan
    grad.addColorStop(0.6, '#10B981'); // Green
    grad.addColorStop(0.78, '#F59E0B'); // Amber/Orange
    grad.addColorStop(1.0, '#EF4444'); // Blazing red (high density)
    gCtx.fillStyle = grad;
    gCtx.fillRect(0, 0, 1, 256);
    const gradData = gCtx.getImageData(0, 0, 1, 256).data;

    // Pre-render radial alpha circle template
    const r = radius + blur;
    const circleCanvas = document.createElement('canvas');
    circleCanvas.width = circleCanvas.height = r * 2;
    const cCtx = circleCanvas.getContext('2d');
    const radGrad = cCtx.createRadialGradient(r, r, 0, r, r, r);
    radGrad.addColorStop(0, 'rgba(0,0,0,1)');
    radGrad.addColorStop(0.4, 'rgba(0,0,0,0.6)');
    radGrad.addColorStop(1, 'rgba(0,0,0,0)');
    cCtx.fillStyle = radGrad;
    cCtx.fillRect(0, 0, r * 2, r * 2);

    function redraw() {
      if (!canvas || !map) return;
      const size = map.getSize();
      const bounds = map.getPixelBounds();
      const topLeft = bounds.min;

      canvas.width = size.x;
      canvas.height = size.y;
      L.DomUtil.setPosition(canvas, topLeft);

      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, size.x, size.y);

      // Step 1: Draw grayscale alpha stamps
      points.forEach((p) => {
        if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return;
        const pt = map.latLngToLayerPoint([p.lat, p.lng]);
        const relX = pt.x - topLeft.x;
        const relY = pt.y - topLeft.y;
        const intensity = Math.min(1.0, Math.max(0.35, p.intensity || 0.6));

        ctx.globalAlpha = intensity;
        ctx.drawImage(circleCanvas, relX - r, relY - r);
      });

      // Step 2: Colorize alpha channels using thermal gradient
      try {
        const imgData = ctx.getImageData(0, 0, size.x, size.y);
        const pixels = imgData.data;
        for (let i = 0; i < pixels.length; i += 4) {
          const alpha = pixels[i + 3];
          if (alpha > 0) {
            const offset = alpha * 4;
            pixels[i]     = gradData[offset];
            pixels[i + 1] = gradData[offset + 1];
            pixels[i + 2] = gradData[offset + 2];
            pixels[i + 3] = Math.min(240, Math.max(minOpacity * 255, alpha * 1.1));
          }
        }
        ctx.putImageData(imgData, 0, 0);
      } catch (e) {
        console.warn('Heatmap canvas colorize notice:', e);
      }
    }

    redraw();

    map.on('moveend', redraw);
    map.on('zoomend', redraw);
    map.on('resize', redraw);

    return () => {
      map.off('moveend', redraw);
      map.off('zoomend', redraw);
      map.off('resize', redraw);
      if (canvasRef.current && canvasRef.current.parentNode) {
        canvasRef.current.parentNode.removeChild(canvasRef.current);
        canvasRef.current = null;
      }
    };
  }, [map, points, radius, blur, minOpacity]);

  return null;
}

export default function AdminHeatmap({ heatmapData, loading }) {
  const [activeLayer,    setActiveLayer]    = useState('combined');  // 'heat' | 'pins' | 'combined'
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusFilter,   setStatusFilter]   = useState('all');
  const [selectedRegion, setSelectedRegion] = useState('karnataka');
  const [showRegions,    setShowRegions]    = useState(false);

  const rawPoints         = heatmapData?.points            || [];
  const categoryBreakdown = heatmapData?.categoryBreakdown || [];
  const regionalSummary   = heatmapData?.regionalSummary   || [];

  const filteredPoints = useMemo(() => {
    return rawPoints.filter((p) => {
      if (categoryFilter !== 'all' && p.category !== categoryFilter) return false;
      if (statusFilter   !== 'all' && p.status   !== statusFilter)   return false;
      return true;
    });
  }, [rawPoints, categoryFilter, statusFilter]);

  const totalTxns   = rawPoints.length;
  const totalKg     = rawPoints.reduce((s, p) => s + (p.weightKg || 0), 0);
  const completedKg = rawPoints.filter((p) => p.status === 'confirmed' || p.status === 'COMPLETED').reduce((s, p) => s + (p.weightKg || 0), 0);
  const gpsCount    = rawPoints.filter((p) => p.gpsSource === 'gps').length;

  const currentRegion = REGION_CENTERS[selectedRegion] || REGION_CENTERS.karnataka;
  const categories    = [...new Set(rawPoints.map((p) => p.category).filter(Boolean))];
  const statuses      = [...new Set(rawPoints.map((p) => p.status).filter(Boolean))];

  return (
    <section className="admin-heatmap-section card animate-fade-in" aria-label="E-Waste Transaction Heatmap">

      {/* Header */}
      <div className="admin-heatmap-header">
        <div>
          <div className="admin-heatmap-title-row">
            <h2 className="admin-chart-title">🗺️ E-Waste Transaction Heatmap</h2>
            <span className="admin-heat-live-pill">
              <span className="live-pulse-dot" /> Live Transaction Data
            </span>
          </div>
          <p className="admin-chart-sub">
            Real e-waste collection transactions weighted by material volume (kg).
            Continuous thermal gradient shows high-throughput collection zones across urban centers.
          </p>
        </div>

        {/* Summary quick stats */}
        <div className="admin-heatmap-quickstats">
          <div className="heat-stat-chip">
            <span className="heat-stat-val">{totalTxns}</span>
            <span className="heat-stat-lbl">Transactions</span>
          </div>
          <div className="heat-stat-chip heat-stat-chip--green">
            <span className="heat-stat-val">{totalKg.toFixed(1)} kg</span>
            <span className="heat-stat-lbl">Total E-Waste</span>
          </div>
          <div className="heat-stat-chip heat-stat-chip--amber">
            <span className="heat-stat-val">{gpsCount}</span>
            <span className="heat-stat-lbl">Exact GPS Points</span>
          </div>
          {completedKg > 0 && (
            <div className="heat-stat-chip" style={{ background: 'rgba(124,58,237,0.1)', borderColor: 'rgba(124,58,237,0.3)' }}>
              <span className="heat-stat-val" style={{ color: '#7C3AED' }}>{completedKg.toFixed(1)} kg</span>
              <span className="heat-stat-lbl">Confirmed Processed</span>
            </div>
          )}
        </div>
      </div>

      {/* Controls toolbar */}
      <div className="admin-heatmap-toolbar">
        {/* Layer selector */}
        <div className="heatmap-control-group">
          <span className="heatmap-control-label">Layer:</span>
          <div className="btn-group">
            {[['combined','🔥 Combined'],['heat','🌡️ Heat'],['pins','📍 Points']].map(([k,lbl]) => (
              <button
                key={k}
                type="button"
                className={`btn btn-sm ${activeLayer === k ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => setActiveLayer(k)}
              >
                {lbl}
              </button>
            ))}
          </div>
        </div>

        {/* Category filter */}
        <div className="heatmap-control-group">
          <span className="heatmap-control-label">Category:</span>
          <select
            className="form-input heatmap-select"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
          >
            <option value="all">All Categories ({totalTxns})</option>
            {categories.map((c) => {
              const count = rawPoints.filter((p) => p.category === c).length;
              return <option key={c} value={c}>{c} ({count})</option>;
            })}
          </select>
        </div>

        {/* Status filter */}
        <div className="heatmap-control-group">
          <span className="heatmap-control-label">Status:</span>
          <select
            className="form-input heatmap-select"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">All Statuses</option>
            {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        {/* Region focus */}
        <div className="heatmap-control-group">
          <span className="heatmap-control-label">Focus:</span>
          <select
            className="form-input heatmap-select"
            value={selectedRegion}
            onChange={(e) => setSelectedRegion(e.target.value)}
          >
            {Object.entries(REGION_CENTERS).map(([k, cfg]) => (
              <option key={k} value={k}>{cfg.label}</option>
            ))}
          </select>
        </div>

        <button
          type="button"
          className={`btn btn-sm ${showRegions ? 'btn-accent' : 'btn-outline'}`}
          onClick={() => setShowRegions(!showRegions)}
        >
          📊 Regional Breakdown {showRegions ? '▲' : '▼'}
        </button>
      </div>

      {/* Category volume chips */}
      {categoryBreakdown.length > 0 && (
        <div className="admin-chart-legend-pills" style={{ marginBottom: 'var(--space-3)' }}>
          {categoryBreakdown.map((c) => (
            <button
              key={c.category}
              type="button"
              onClick={() => setCategoryFilter(categoryFilter === c.category ? 'all' : c.category)}
              className="admin-legend-pill"
              style={{
                cursor: 'pointer',
                outline: categoryFilter === c.category ? `2px solid ${CATEGORY_COLORS[c.category] || '#7C3AED'}` : 'none',
              }}
            >
              <span className="admin-legend-dot" style={{ background: CATEGORY_COLORS[c.category] || '#64748B' }} />
              {c.category}
              <strong>{c.txnCount} txns · {c.totalKg.toFixed(0)} kg</strong>
            </button>
          ))}
        </div>
      )}

      {/* Regional breakdown drawer */}
      {showRegions && regionalSummary.length > 0 && (
        <div className="admin-heatmap-regions-drawer animate-fade-in">
          <div className="drawer-header">
            <strong>Area & City-Level E-Waste Transaction Volume</strong>
            <span className="text-muted" style={{ fontSize: '0.85em' }}>
              Ranked by total material weight processed
            </span>
          </div>
          <div className="regions-grid">
            {regionalSummary.map((r) => {
              const pct = totalKg > 0 ? Math.round((r.totalKg / totalKg) * 100) : 0;
              return (
                <div key={r.city} className="region-stat-box">
                  <div className="region-stat-top">
                    <span className="region-stat-name">{r.city}</span>
                    <strong className="region-stat-count">{r.txnCount} txns</strong>
                  </div>
                  <div className="region-bar-track">
                    <div className="region-bar-fill" style={{ width: `${Math.min(100, pct * 5)}%` }} />
                  </div>
                  <div className="region-stat-bottom">
                    <span>{r.totalKg.toFixed(0)} kg</span>
                    <span>{r.completedCount} confirmed · {pct}% share</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loading && rawPoints.length === 0 && (
        <div className="admin-chart-empty" style={{ padding: 'var(--space-8)', textAlign: 'center' }}>
          <div style={{ fontSize: '3rem', marginBottom: 'var(--space-3)' }}>🗺️</div>
          <p style={{ fontWeight: 600, marginBottom: 'var(--space-1)' }}>No transaction geodata yet</p>
          <p className="text-muted" style={{ fontSize: '0.9em' }}>
            The transaction heatmap will populate automatically as collectors create lots and hand over e-waste.
          </p>
        </div>
      )}

      {/* Map container */}
      {(loading || rawPoints.length > 0) && (
        <div style={{ position: 'relative', height: 520, width: '100%', borderRadius: 12, overflow: 'hidden', marginTop: 'var(--space-3)' }}>
          {loading ? (
            <div className="heatmap-loading-overlay">
              <span className="loading-spinner" />
              <span>Loading e-waste transaction geodata…</span>
            </div>
          ) : (
            <MapContainer
              key={selectedRegion}
              center={currentRegion.center}
              zoom={currentRegion.zoom}
              scrollWheelZoom={false}
              style={{ height: '100%', width: '100%' }}
            >
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              <MapViewController center={currentRegion.center} zoom={currentRegion.zoom} />

              {/* Native Continuous Thermal Canvas Heatmap Layer */}
              {(activeLayer === 'heat' || activeLayer === 'combined') && (
                <CanvasHeatmapLayer points={filteredPoints} radius={55} blur={30} minOpacity={0.45} />
              )}

              {/* Individual interactive transaction pins */}
              {(activeLayer === 'pins' || activeLayer === 'combined') &&
                filteredPoints.map((p) => {
                  const color = CATEGORY_COLORS[p.category] || '#64748B';
                  const sColor = STATUS_COLORS[p.status]    || '#64748B';
                  const r = activeLayer === 'combined'
                    ? Math.max(6, Math.min(14, 5 + (p.weightKg / 4)))
                    : Math.max(7, Math.min(18, 6 + (p.weightKg / 3)));

                  return (
                    <CircleMarker
                      key={`t-${p.id}`}
                      center={[p.lat, p.lng]}
                      radius={r}
                      pathOptions={{
                        color: '#ffffff',
                        weight: 2,
                        fillColor: color,
                        fillOpacity: activeLayer === 'combined' ? 0.85 : 0.95,
                      }}
                    >
                      <Tooltip direction="top" offset={[0, -4]} opacity={0.95}>
                        <strong>{p.category} {p.subCategory ? `· ${p.subCategory}` : ''}</strong>
                        <br />
                        <span style={{ fontSize: '0.85em' }}>{p.weightKg} kg · {p.city}</span>
                      </Tooltip>
                      <Popup>
                        <div className="heatmap-popup-content">
                          <div className="heatmap-popup-badge" style={{ background: `${color}20`, color }}>
                            {p.category} {p.subCategory ? `— ${p.subCategory}` : ''}
                          </div>
                          <h4 className="heatmap-popup-title" style={{ marginTop: 6, fontSize: '1.1rem' }}>
                            {p.weightKg} kg
                            {p.gpsSource === 'centroid' && (
                              <span title="Approximate area center" style={{ fontSize: '0.75em', color: '#94A3B8', marginLeft: 6 }}>
                                (~ approx. area)
                              </span>
                            )}
                          </h4>
                          <div className="heatmap-popup-meta">
                            <strong>Status:</strong>{' '}
                            <span style={{ color: sColor, fontWeight: 600 }}>{p.status}</span>
                          </div>
                          {p.collectorName && (
                            <div className="heatmap-popup-meta">
                              <strong>Collector:</strong> {p.collectorName}
                            </div>
                          )}
                          {p.recyclerName && (
                            <div className="heatmap-popup-meta">
                              <strong>Recycler:</strong> {p.recyclerName}
                            </div>
                          )}
                          {p.paymentMethod && (
                            <div className="heatmap-popup-meta">
                              <strong>Payment:</strong> {p.paymentMethod}
                            </div>
                          )}
                          <div className="heatmap-popup-meta" style={{ marginTop: 6, fontSize: '0.8em', color: '#64748B' }}>
                            {new Date(p.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                          </div>
                        </div>
                      </Popup>
                    </CircleMarker>
                  );
                })}
            </MapContainer>
          )}

          {/* Map Legend */}
          <div className="heatmap-map-legend">
            <div className="legend-title">Transaction Density (kg)</div>
            <div className="legend-gradient-bar">
              <span>Low</span>
              <div className="gradient-track" />
              <span>High</span>
            </div>
            <div className="legend-status-items" style={{ marginTop: 8 }}>
              {Object.entries(CATEGORY_COLORS).slice(0, 6).map(([cat, clr]) => (
                <span key={cat} className="legend-status-dot">
                  <span className="dot" style={{ background: clr }} /> {cat}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
