/**
 * MapLink — renders a Google Maps link for a lat/lng pair.
 * Used anywhere GPS coordinates are displayed; opens Google Maps at the marker
 * instead of showing the raw coordinates.
 */
export default function MapLink({ lat, lng, location, children, onClick }) {
  const hasCoordinates = lat != null && lng != null;
  const latN = Number(lat);
  const lngN = Number(lng);
  const hasValidCoordinates = hasCoordinates && !Number.isNaN(latN) && !Number.isNaN(lngN);
  const mapUrl = hasValidCoordinates
    ? `https://www.google.com/maps?q=${latN},${lngN}`
    : location?.trim()
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location.trim())}`
      : null;

  if (!mapUrl) return null;

  return (
    <a
      href={mapUrl}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onClick}
      title={hasValidCoordinates ? `${latN.toFixed(4)}, ${lngN.toFixed(4)}` : location.trim()}
      style={{ textDecoration: 'underline', textUnderlineOffset: '3px' }}
    >
      {children ??
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
          📍 {hasValidCoordinates ? `${latN.toFixed(4)}, ${lngN.toFixed(4)}` : location.trim()}
        </span>}
    </a>
  );
}