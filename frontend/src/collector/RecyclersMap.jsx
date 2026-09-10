import { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Circle, useMap } from 'react-leaflet';
import L from 'leaflet';

const collectorIcon = new L.Icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

const recyclerIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

const selectedRecyclerIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-gold.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [30, 48],
  iconAnchor: [15, 48],
  popupAnchor: [1, -38],
  shadowSize: [48, 48],
});

function MapController({ center, recyclers, selectedId }) {
  const map = useMap();

  useEffect(() => {
    if (!map) return;

    if (selectedId) {
      const sel = (recyclers || []).find(r => (r.id ?? r.recycler_id) === selectedId);
      if (sel && sel.displayLat != null && sel.displayLng != null) {
        map.panTo([sel.displayLat, sel.displayLng], { animate: true, duration: 0.6 });
        return;
      }
    }

    if ((recyclers || []).length > 0 && center) {
      const points = [[center[0], center[1]], ...recyclers.map(r => [r.displayLat, r.displayLng])];
      const bounds = L.latLngBounds(points);
      map.fitBounds(bounds, { padding: [45, 45], maxZoom: 13, animate: true });
    } else if (center) {
      map.setView(center, 12, { animate: true });
    }
  }, [center, recyclers, selectedId, map]);

  return null;
}

export default function RecyclersMap({ recyclers, center, radiusKm, selectedId, onSelect, showPrice = true }) {
  // Disambiguate overlapping recycler locations with a small spiral offset (~150m–500m)
  // so every matched recycler renders as a distinct visible pin on the map.
  const coordCounts = {};
  const processedRecyclers = (recyclers || [])
    .filter(r => r.latitude != null && r.longitude != null && !isNaN(Number(r.latitude)) && !isNaN(Number(r.longitude)))
    .map(r => {
      const origLat = Number(r.latitude);
      const origLng = Number(r.longitude);
      const key = `${origLat.toFixed(3)},${origLng.toFixed(3)}`;

      coordCounts[key] = (coordCounts[key] || 0) + 1;
      const count = coordCounts[key];

      let displayLat = origLat;
      let displayLng = origLng;

      if (count > 1) {
        // Golden ratio spiral offset for overlapping centroids
        const angle = (count - 1) * 2.39996;
        const distance = 0.003 * Math.sqrt(count - 1);
        displayLat = origLat + distance * Math.cos(angle);
        displayLng = origLng + distance * Math.sin(angle);
      }

      return {
        ...r,
        displayLat,
        displayLng,
      };
    });

  const lat = center?.[0] ?? (processedRecyclers[0]?.displayLat || 12.9716);
  const lng = center?.[1] ?? (processedRecyclers[0]?.displayLng || 77.5946);

  return (
    <MapContainer
      className="recyclers-map"
      center={[lat, lng]}
      zoom={11}
      scrollWheelZoom
      style={{ height: '100%', width: '100%', minHeight: '380px', borderRadius: 'var(--radius-lg, 12px)' }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      <MapController center={[lat, lng]} recyclers={processedRecyclers} selectedId={selectedId} />

      {/* Search radius around collector */}
      {radiusKm > 0 && (
        <Circle
          center={[lat, lng]}
          radius={radiusKm * 1000}
          pathOptions={{ color: 'var(--color-primary, #1f78c8)', fillColor: 'rgba(31,120,200,0.08)', fillOpacity: 0.35, weight: 2 }}
        />
      )}

      {/* Collector location pin */}
      <Marker position={[lat, lng]} icon={collectorIcon}>
        <Popup offset={[0, -20]}>
          <strong>📍 Your Location</strong>
          <br />
          <span style={{ fontSize: '0.85em', color: 'var(--color-text-muted, #666)' }}>
            Collector search center
          </span>
        </Popup>
      </Marker>

      {processedRecyclers.map((r) => {
        const id = r.id ?? r.recycler_id;
        const isSelected = selectedId === id;
        return (
          <Marker
            key={`recycler-${id}`}
            position={[r.displayLat, r.displayLng]}
            title={r.name}
            icon={isSelected ? selectedRecyclerIcon : recyclerIcon}
            zIndexOffset={isSelected ? 2000 : 0}
            eventHandlers={{
              click: () => onSelect?.(id),
            }}
          >
            <Popup offset={[0, -20]} minWidth={210} maxWidth={280}>
              <strong style={{ fontSize: '1.05em' }}>{r.name}</strong>
              <br />
              <div style={{ margin: '4px 0', fontSize: '0.85em', color: 'var(--color-text-muted, #666)' }}>
                {r.facility_location && <div>🏢 {r.facility_location}</div>}
                {r.distance_km != null ? `🚗 ${Number(r.distance_km).toFixed(1)} km away` : ''}
                {showPrice && r.offered_rate ? ` · 💰 ₹${r.offered_rate}/kg` : ''}
                {showPrice && r.suitability != null ? ` · ⭐ ${Math.round(Number(r.suitability))}% match` : ''}
              </div>
            </Popup>
          </Marker>
        );
      })}
    </MapContainer>
  );
}