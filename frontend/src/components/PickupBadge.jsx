/**
 * PickupBadge — renders the recycler's pickup availability as a clear,
 * colour-coded indicator with a one-line explanation.
 *
 * DB values (pickup_availability):
 *   'daily'      → AVAILABLE  (🟢)
 *   'weekly'     → SCHEDULED  (🟡)
 *   'on_request' → SCHEDULED  (🟡)
 *   anything else / null → NOT_AVAILABLE (🔴)
 *
 * The component also accepts "compact" mode for list rows.
 */

const STATUS = {
  AVAILABLE:     { dot: '🟢', label: 'Pickup Available',        hint: 'Recycler can arrange pickup for this lot.',                      color: '#16a34a' },
  SCHEDULED:     { dot: '🟡', label: 'Pickup by Appointment',   hint: 'Pickup is available after coordinating with the recycler.',      color: '#d97706' },
  NOT_AVAILABLE: { dot: '🔴', label: 'Pickup Not Available',    hint: 'You will need to transport the material to the facility.',       color: '#dc2626' },
};

function resolveStatus(raw) {
  if (!raw) return 'NOT_AVAILABLE';
  const v = String(raw).toLowerCase().trim();
  if (v === 'daily') return 'AVAILABLE';
  if (v === 'weekly' || v === 'on_request' || v === 'on request') return 'SCHEDULED';
  return 'NOT_AVAILABLE';
}

/**
 * @param {{ value: string, compact?: boolean }} props
 *   value   — raw DB value for pickup_availability
 *   compact — if true, show only the dot + label (no hint text)
 */
export default function PickupBadge({ value, compact = false }) {
  const key = resolveStatus(value);
  const { dot, label, hint, color } = STATUS[key];

  if (compact) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.82rem', fontWeight: '600', color }}>
        {dot} {label}
      </span>
    );
  }

  return (
    <div>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.85rem', fontWeight: '700', color }}>
        {dot} {label}
      </span>
      <p style={{ margin: '2px 0 0 0', fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
        {hint}
      </p>
    </div>
  );
}
