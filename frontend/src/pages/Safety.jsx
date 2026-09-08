/**
 * Safety Guidance Page — /safety
 *
 * Static content — NO API call required.
 * Renders fully offline once the JS bundle is cached.
 * Designed for field use: large text, short bullets, visible warnings.
 *
 * Available to both Collector and Recycler portals.
 * Phase 5: All section content comes from the locale JSON (en/hi/mr).
 */

import { useTranslation } from '../i18n/config.js';
import './Safety.css';

const SECTION_META = [
  { id: 'general',   icon: '', color: 'blue',   warning: false, hasDoNot: false },
  { id: 'ppe',       icon: '', color: 'purple',  warning: false, hasDoNot: false },
  { id: 'materials', icon: '', color: 'green',   warning: false, hasDoNot: false },
  { id: 'sharp',     icon: '', color: 'amber',   warning: true,  hasDoNot: true  },
  { id: 'ewaste',    icon: '', color: 'purple',  warning: true,  hasDoNot: true  },
  { id: 'chemical',  icon: '', color: 'red',     warning: true,  hasDoNot: true  },
  { id: 'emergency', icon: '', color: 'red',     warning: true,  hasDoNot: true  },
];

const COLOR_MAP = {
  blue:   { bg: 'var(--color-info-light)',        border: 'var(--color-info)',        icon: 'var(--color-info)' },
  green:  { bg: 'var(--color-success-light)',     border: 'var(--color-success)',     icon: 'var(--color-success)' },
  purple: { bg: 'var(--color-primary-light)',     border: 'var(--color-primary)',     icon: 'var(--color-primary)' },
  amber:  { bg: 'var(--color-warning-light)',     border: 'var(--color-warning)',     icon: 'var(--color-warning)' },
  red:    { bg: 'var(--color-destructive-light)', border: 'var(--color-destructive)', icon: 'var(--color-destructive)' },
};

function SafetySection({ sectionId, icon, color, warning, hasDoNot, t }) {
  const colors = COLOR_MAP[color] ?? COLOR_MAP.blue;
  const titleKey = `safety.sections.${sectionId}.title`;
  const itemsKey = `safety.sections.${sectionId}.items`;
  const doNotKey = `safety.sections.${sectionId}.doNot`;

  const title = t(titleKey);
  const items = t(itemsKey);
  const doNot = hasDoNot ? t(doNotKey) : null;

  const safeItems = Array.isArray(items) ? items : [];
  const safeDoNot = Array.isArray(doNot) ? doNot : [];

  return (
    <article
      className={`safety-card ${warning ? 'safety-card--warning' : ''}`}
      style={{
        borderColor: colors.border,
        '--section-icon-color': colors.icon,
      }}
      aria-labelledby={`safety-${sectionId}-heading`}
    >
      <div className="safety-card__header">
        <div
          className="safety-card__icon-wrap"
          style={{ background: colors.bg }}
          aria-hidden="true"
        >
          {icon}
        </div>
        <h2
          id={`safety-${sectionId}-heading`}
          className="safety-card__title"
        >
          {title}
        </h2>
        {warning && (
          <span className="safety-warning-badge" aria-label={t('safety.warningBadge')}>
            {t('safety.warningBadge')}
          </span>
        )}
      </div>

      {safeItems.length > 0 && (
        <ul className="safety-card__list" aria-label={`${title} guidelines`}>
          {safeItems.map((item, i) => (
            <li key={i} className="safety-card__item">
              <span className="safety-card__bullet" aria-hidden="true">•</span>
              {item}
            </li>
          ))}
        </ul>
      )}

      {safeDoNot.length > 0 && (
        <div className="safety-donot-block" role="note">
          <p className="safety-donot-block__heading" aria-label="Do not do the following">
             {t('safety.doNot')}
          </p>
          <ul className="safety-donot-block__list">
            {safeDoNot.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}

export default function SafetyGuidance() {
  const { t } = useTranslation();

  return (
    <div className="container">
      {/* Page Header */}
      <div className="safety-header animate-fade-in">
        <div className="safety-header__icon" aria-hidden="true"></div>
        <div>
          <h1 className="section-title">{t('safety.title')}</h1>
          <p className="section-subtitle">{t('safety.subtitle')}</p>
        </div>
      </div>

      {/* Offline notice — page works offline */}
      <div className="safety-offline-notice animate-fade-in" role="note">
        
        <span>{t('safety.offlineNotice')}</span>
      </div>

      {/* Quick jump nav — useful on mobile for long pages */}
      <nav className="safety-jumpnav animate-fade-in" aria-label={t('safety.jumpNavLabel')}>
        {SECTION_META.map((s) => (
          <a
            key={s.id}
            href={`#safety-${s.id}-heading`}
            className="safety-jumpnav__link"
          >
            <span aria-hidden="true">{s.icon}</span>
            {t(`safety.sections.${s.id}.title`)}
          </a>
        ))}
      </nav>

      {/* Sections */}
      <div className="safety-sections animate-fade-in">
        {SECTION_META.map((s) => (
          <SafetySection
            key={s.id}
            sectionId={s.id}
            icon={s.icon}
            color={s.color}
            warning={s.warning}
            hasDoNot={s.hasDoNot}
            t={t}
          />
        ))}
      </div>

      {/* Footer reminder */}
      <div className="safety-footer animate-fade-in" role="contentinfo">
        <p>{t('safety.footer')}</p>
      </div>
    </div>
  );
}
