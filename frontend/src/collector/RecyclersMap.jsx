import { MapContainer, TileLayer, Marker, Popup, Circle } from 'react-leaflet';
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
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

// Lightning-fast, concrete dataset of where the actual recyclers are. Each
// matched recycler came from the backend with a real latitude/longitude, so
// plotting them on a Leaflet map mirrors the true search radius and layout.
export default function RecyclersMap({ recyclers, center, radiusKm, selectedId, onSelect }) {
  if (!recyclers || recyclers.length === 0) return null;

  const lat = center?.[0] ?? recyclers[0].latitude;
  const lng = center?.[1] ?? recyclers[0].longitude;

  return (
    <MapContainer
      className="recyclers-map"
      center={[lat, lng]}
      zoom={11}
      scrollWheelZoom
      style={{ height: '100%', width: '100%' }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      {/* Search radius around the collector ("you are here") */}
      {radiusKm > 0 && (
        <Circle
          center={[lat, lng]}
          radius={radiusKm * 1000}
          pathOptions={{ color: 'var(--color-primary)', fillColor: 'rgba(31,120,200,0.06)', fillOpacity: 0.35, weight: 2 }}
        />
      )}

      {/* Collector location pin */}
      <Marker position={[lat, lng]} icon={collectorIcon}>{/* default pin + radius ring mark "you are here" */}</Marker>

      {recyclers.map((r) => {
        if (r.latitude == null || r.longitude == null) return null;
        const id = r.id ?? r.recycler_id;
        const isSelected = selectedId === id;
        return (
          <Marker
            key={`recycler-${id}`}
            position={[r.latitude, r.longitude]}
            title={r.name}
            icon={recyclerIcon}
            zIndexOffset={isSelected ? 2000 : 0}
            eventHandlers={{
              click: () => onSelect?.(id),
            }}
          >
            <Popup offset={[24, -8]} minWidth={210} maxWidth={260}>
              <strong>{r.name}</strong>
              <br />
              <span style={{ fontSize: '0.82em', color: 'var(--color-text-muted)' }}>
                {r.distance_km != null ? `${Number(r.distance_km).toFixed(1)} km away` : ''}
                {r.offered_rate ? ` · ₹${r.offered_rate}/kg` : ''}
              </span>
            </Popup>
          </Marker>
        );
      })}
    </MapContainer>
  );
}