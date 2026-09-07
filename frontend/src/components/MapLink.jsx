/**
 * MapLink — renders a Google Maps link for a lat/lng pair.
 * Used anywhere GPS coordinates are displayed; opens Google Maps at the marker
 * instead of showing the raw coordinates.
 */
export default function MapLink({ lat, lng, children }) {
  if (lat == null || lng == null) return null;
  const latN = Number(lat);
  const lngN = Number(lng);
  if (Number.isNaN(latN) || Number.isNaN(lngN)) return null;

  return (
    <a
      href={`https://www.google.com/maps?q=${latN},${lngN}`}
      target="_blank"
      rel="noopener noreferrer"
      title={`${latN.toFixed(4)}, ${lngN.toFixed(4)}`}
      style={{ textDecoration: 'underline', textUnderlineOffset: '3px' }}
    >
      {children ??
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
          📍 {latN.toFixed(4)}, {lngN.toFixed(4)}
        </span>}
    </a>
  );
}