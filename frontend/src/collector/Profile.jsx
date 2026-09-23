import { useEffect, useState } from 'react';
import { getCollector, updateCollector } from '../api/client';
import { currentCollectorId, getSession } from '../services/auth';
import { PageLoader, LoadingSpinner } from '../components/LoadingSpinner';
import { useTranslation } from '../i18n/config.js';

const LANGUAGES = [
  { value: 'hi',  label: '🇮🇳 Hindi' },
  { value: 'mr',  label: '🇮🇳 Marathi' },
  { value: 'en',  label: '🇬🇧 English' },
];

const LOCATIONS = ['Bengaluru', 'Delhi', 'Mumbai', 'Hyderabad', 'Chennai', 'Pune', 'Kolkata', 'Ahmedabad', 'Jaipur'];

export default function CollectorProfile() {
  const { t } = useTranslation();
  const collectorId = currentCollectorId();

  const [collector, setCollector] = useState(null);
  const [form, setForm] = useState(null);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (!collectorId) { setLoading(false); return; }
    getCollector(collectorId)
      .then(r => { setCollector(r.data); setForm(r.data); })
      .catch(() => setError('Could not load profile.'))
      .finally(() => setLoading(false));
  }, [collectorId]);

  function handleField(key, value) {
    setForm(f => ({ ...f, [key]: value }));
  }

  async function handleSave() {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const r = await updateCollector(collectorId, {
        name: form.name?.trim(),
        phone: form.phone?.trim(),
        operating_location: form.operating_location?.trim(),
        preferred_language: form.preferred_language,
      });
      setCollector(r.data);
      setForm(r.data);
      setEditing(false);
      setSuccess('Profile updated successfully!');
    } catch (err) {
      setError(err.message || 'Could not save profile.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <PageLoader />;

  const session = getSession();
  const memberSince = collector?.created_at
    ? new Date(collector.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
    : '—';

  return (
    <div className="container" style={{ maxWidth: '680px', margin: '0 auto', padding: 'var(--space-5) var(--space-4)' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-5)', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
        <div>
          <h1 className="section-title" style={{ marginBottom: '4px' }}>My Profile</h1>
          <p className="section-subtitle" style={{ margin: 0 }}>Manage your collector account details</p>
        </div>
        {!editing ? (
          <button className="btn btn-primary" onClick={() => { setEditing(true); setSuccess(''); setError(''); }}>
            ✏️ Edit Profile
          </button>
        ) : (
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn btn-ghost" onClick={() => { setEditing(false); setForm(collector); setError(''); }} disabled={saving}>
              Cancel
            </button>
            <button className="btn btn-accent" onClick={handleSave} disabled={saving} aria-busy={saving}>
              {saving ? <><LoadingSpinner size="sm" /> Saving…</> : '💾 Save Changes'}
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="alert-banner alert-banner--error animate-fade-in" style={{ marginBottom: 'var(--space-4)' }}>
          {error}
        </div>
      )}
      {success && (
        <div className="alert-banner alert-banner--success animate-fade-in" style={{ marginBottom: 'var(--space-4)' }}>
          ✅ {success}
        </div>
      )}

      {/* Identity Card */}
      <section className="card animate-scale-in" style={{ marginBottom: 'var(--space-4)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: 'var(--space-4)' }}>
          <div style={{
            width: '60px', height: '60px', borderRadius: '50%',
            background: 'var(--color-primary)', color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '1.5rem', fontWeight: '700', flexShrink: 0,
          }}>
            {collector?.name?.charAt(0)?.toUpperCase() || '?'}
          </div>
          <div>
            <div style={{ fontWeight: '700', fontSize: '1.15rem' }}>{collector?.name || '—'}</div>
            <div className="text-muted text-sm">Collector · Member since {memberSince}</div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--space-4)' }}>
          {/* Name */}
          <div className="form-group">
            <label className="form-label">Full Name</label>
            {editing ? (
              <input
                className="form-input"
                value={form?.name || ''}
                onChange={e => handleField('name', e.target.value)}
                placeholder="Your name"
              />
            ) : (
              <p className="profile-value" style={{ margin: '4px 0 0', fontWeight: '500' }}>{collector?.name || '—'}</p>
            )}
          </div>

          {/* Phone */}
          <div className="form-group">
            <label className="form-label">Phone Number</label>
            {editing ? (
              <input
                className="form-input"
                value={form?.phone || ''}
                onChange={e => handleField('phone', e.target.value)}
                placeholder="+91 XXXXX XXXXX"
                inputMode="tel"
              />
            ) : (
              <p className="profile-value" style={{ margin: '4px 0 0', fontWeight: '500' }}>{collector?.phone || '—'}</p>
            )}
          </div>

          {/* Operating Location */}
          <div className="form-group">
            <label className="form-label">Operating City</label>
            <p className="text-muted text-xs" style={{ margin: '0 0 6px' }}>City where you collect scrap material</p>
            {editing ? (
              <select
                className="form-input"
                value={form?.operating_location || ''}
                onChange={e => handleField('operating_location', e.target.value)}
              >
                <option value="">Select city…</option>
                {LOCATIONS.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            ) : (
              <p className="profile-value" style={{ margin: '4px 0 0', fontWeight: '500' }}>📍 {collector?.operating_location || '—'}</p>
            )}
          </div>

          {/* Preferred Language */}
          <div className="form-group">
            <label className="form-label">Preferred Language</label>
            <p className="text-muted text-xs" style={{ margin: '0 0 6px' }}>Used for notifications and the app UI</p>
            {editing ? (
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {LANGUAGES.map(({ value, label }) => {
                  const selected = form?.preferred_language === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => handleField('preferred_language', value)}
                      aria-pressed={selected}
                      style={{
                        flex: '1 1 90px',
                        padding: '8px 10px',
                        borderRadius: '8px',
                        border: selected ? '2px solid var(--color-primary)' : '1.5px solid var(--color-border)',
                        background: selected ? 'var(--color-primary-light, #eff6ff)' : 'var(--color-surface-alt)',
                        fontWeight: selected ? '700' : '500',
                        fontSize: '0.82rem',
                        color: selected ? 'var(--color-primary)' : 'var(--color-text-primary)',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                        outline: 'none',
                        textAlign: 'center',
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="profile-value" style={{ margin: '4px 0 0', fontWeight: '500' }}>
                {LANGUAGES.find(l => l.value === collector?.preferred_language)?.label || collector?.preferred_language || '—'}
              </p>
            )}
          </div>
        </div>
      </section>

      {/* Account Info */}
      <section className="card animate-scale-in">
        <h2 className="detail-section-title" style={{ marginBottom: 'var(--space-3)' }}>Account Information</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--space-3)' }}>
          <div>
            <span className="detail-item__label" style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>Collector ID</span>
            <p className="font-mono" style={{ margin: '2px 0 0', fontSize: '0.85rem', fontWeight: '500' }}>{collector?.id || '—'}</p>
          </div>
          <div>
            <span className="detail-item__label" style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>Account Role</span>
            <p style={{ margin: '2px 0 0', fontWeight: '600' }}>♻️ Scrap Collector</p>
          </div>
          <div>
            <span className="detail-item__label" style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>GPS Coordinates</span>
            <p className="font-mono" style={{ margin: '2px 0 0', fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>
              {collector?.latitude && collector?.longitude
                ? `${Number(collector.latitude).toFixed(5)}, ${Number(collector.longitude).toFixed(5)}`
                : 'Not set'}
            </p>
          </div>
          <div>
            <span className="detail-item__label" style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>Member Since</span>
            <p style={{ margin: '2px 0 0', fontWeight: '500' }}>{memberSince}</p>
          </div>
        </div>
      </section>
    </div>
  );
}
