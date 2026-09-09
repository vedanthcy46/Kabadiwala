// Centralised status → UI mapping.
// Must cover ALL enum values from the backend DB schema.
// transaction_status: quoted | matched | handed_over | confirmed
// traceability.status: pending_confirmation | confirmed
// payment_status: pending | paid
// authorization_status: authorized | unauthorized | pending
//
// Phase 5: labels are now resolved from the i18n system.
// The STATUS_MAP keys must remain as backend enum values (never translated).

import { useTranslation } from '../i18n/config.js';

// Visual config (bg/fg/icon) — purely presentational, not translated
const STATUS_VISUAL = {
  quoted:               { bg: 'var(--color-info-light)',        fg: 'var(--color-info)',          icon: '' },
  requested:            { bg: 'var(--color-info-light)',        fg: 'var(--color-info)',          icon: '' },
  offered:              { bg: 'var(--status-in-progress-bg)',   fg: 'var(--status-in-progress)',   icon: '₹' },
  accepted:             { bg: 'var(--status-confirmed-bg)',     fg: 'var(--status-confirmed)',     icon: '✓' },
  rejected:             { bg: 'var(--color-destructive-light)', fg: 'var(--color-destructive)',    icon: '✕' },
  expired:              { bg: 'var(--color-warning-light)',     fg: 'var(--color-warning)',        icon: '◔' },
  matched:              { bg: 'var(--status-in-progress-bg)',   fg: 'var(--status-in-progress)',   icon: '' },
  handed_over:          { bg: 'var(--color-warning-light)',     fg: 'var(--color-warning)',        icon: '' },
  pending_confirmation: { bg: 'var(--color-warning-light)',     fg: 'var(--color-warning)',        icon: '' },
  confirmed:            { bg: 'var(--status-confirmed-bg)',     fg: 'var(--status-confirmed)',     icon: '' },
  pending:              { bg: 'var(--status-pending-bg)',       fg: 'var(--status-pending)',       icon: '' },
  paid:                 { bg: 'var(--status-confirmed-bg)',     fg: 'var(--status-confirmed)',     icon: '₹' },
  partially_paid:       { bg: 'var(--color-warning-light)',     fg: 'var(--color-warning)',        icon: '◑' },
  authorized:           { bg: 'var(--status-confirmed-bg)',     fg: 'var(--status-confirmed)',     icon: '✓' },
  unauthorized:         { bg: 'var(--color-destructive-light)', fg: 'var(--color-destructive)',    icon: '✕' },
  expiring_soon:        { bg: 'var(--color-warning-light)',     fg: 'var(--color-warning)',        icon: '⚠️' },
  renewal_pending:      { bg: 'var(--color-info-light)',        fg: 'var(--color-info)',          icon: '↻' },
  active:               { bg: 'var(--status-confirmed-bg)',     fg: 'var(--status-confirmed)',     icon: '✓' },
  suspended:            { bg: 'var(--color-destructive-light)', fg: 'var(--color-destructive)',    icon: '⛔' },
  in_progress:          { bg: 'var(--status-in-progress-bg)',   fg: 'var(--status-in-progress)',   icon: '↻' },
  cancelled:            { bg: 'rgba(239, 68, 68, 0.15)',        fg: '#ef4444',                     icon: '⊘' },
  default:              { bg: 'var(--color-muted)',             fg: 'var(--color-text-muted)',     icon: '?' },
};

// Map status keys → translation keys or raw fallback labels
const STATUS_LABEL_KEYS = {
  quoted:               'status.quoted',
  requested:            'status.requested',
  offered:              'status.offered',
  accepted:             'status.accepted',
  rejected:             'status.rejected',
  expired:              'status.expired',
  matched:              'status.matched',
  handed_over:          'status.handed_over',
  pending_confirmation: 'status.pending',
  confirmed:            'status.confirmed',
  pending:              'status.pending',
  paid:                 'status.paid',
  partially_paid:       'status.pending',
  authorized:           'recyclerProfile.authorizedYes',
  unauthorized:         'recyclerProfile.authorizedNo',
  expiring_soon:        'Expiring Soon',
  renewal_pending:      'Renewal Pending',
  active:               'Active',
  suspended:            'Suspended',
  in_progress:          'status.initiated',
  cancelled:            'status.cancelled',
  default:              'common.noData',
};

export function StatusBadge({ status, size = 'sm' }) {
  const { t } = useTranslation();
  const key = status?.toLowerCase();
  const visual = STATUS_VISUAL[key] || STATUS_VISUAL.default;
  const rawLabel = STATUS_LABEL_KEYS[key];
  const labelKey = rawLabel || STATUS_LABEL_KEYS.default;
  const label = (rawLabel && !rawLabel.includes('.')) ? rawLabel : t(labelKey);

  const fontSize = size === 'sm' ? 'var(--text-xs)' : 'var(--text-sm)';
  return (
    <span
      className="pill"
      style={{
        background: visual.bg,
        color: visual.fg,
        fontSize,
        fontWeight: 'var(--weight-semibold)',
        lineHeight: '1.6', // Devanagari glyph safety
      }}
      aria-label={`Status: ${label}`}
    >
      <span aria-hidden="true">{visual.icon}</span>
      {label}
    </span>
  );
}
