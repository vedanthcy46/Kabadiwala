import { useState, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

// Fix for default Leaflet marker icons in React
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

function LocationMarker({ position, setPosition }) {
  const map = useMap();
  
  useMapEvents({
    click(e) {
      setPosition(e.latlng);
      map.flyTo(e.latlng, map.getZoom());
    },
  });

  const markerRef = useRef(null);
  
  return position === null ? null : (
    <Marker
      position={position}
      draggable={true}
      ref={markerRef}
      eventHandlers={{
        dragend() {
          const marker = markerRef.current;
          if (marker != null) {
            setPosition(marker.getLatLng());
            map.flyTo(marker.getLatLng(), map.getZoom());
          }
        },
      }}
    />
  );
}

export default function MapPicker({ lat, lng, onChange }) {
  // Default to a central location (e.g., India center) if none provided
  const defaultCenter = { lat: 20.5937, lng: 78.9629 };
  const initialPosition = lat && lng ? { lat: Number(lat), lng: Number(lng) } : null;
  const mapCenter = initialPosition || defaultCenter;
  const zoom = initialPosition ? 14 : 4;

  const [position, setPosition] = useState(initialPosition);

  useEffect(() => {
    if (position && onChange) {
      onChange(position.lat, position.lng);
    }
  }, [position]); // eslint-disable-line

  return (
    <div style={{ height: '300px', width: '100%', borderRadius: '8px', overflow: 'hidden', border: '1.5px solid var(--color-border)', position: 'relative', zIndex: 1 }}>
      <MapContainer 
        center={mapCenter} 
        zoom={zoom} 
        style={{ height: '100%', width: '100%' }}
        scrollWheelZoom={true}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; OpenStreetMap'
        />
        <LocationMarker position={position} setPosition={setPosition} />
      </MapContainer>
      <div style={{
        position: 'absolute',
        bottom: '10px',
        left: '10px',
        right: '10px',
        background: 'rgba(255, 255, 255, 0.95)',
        padding: '8px 12px',
        borderRadius: '6px',
        fontSize: '0.8rem',
        fontWeight: '600',
        zIndex: 400,
        boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <span>{position ? `${position.lat.toFixed(5)}, ${position.lng.toFixed(5)}` : 'Tap on the map to drop a pin'}</span>
        <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>Drag pin to adjust</span>
      </div>
    </div>
  );
}
