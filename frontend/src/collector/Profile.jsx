import { useEffect, useState } from 'react';
import { getCollector, updateCollector } from '../api/client';
import { currentCollectorId, getSession, updateSession } from '../services/auth';
import { PageLoader, LoadingSpinner } from '../components/LoadingSpinner';
import { useTranslation } from '../i18n/config.js';
import MapPicker from '../components/MapPicker.jsx';

const LANGUAGES = [
  { value: 'hi',  label: '🇮🇳 Hindi' },
  { value: 'mr',  label: '🇮🇳 Marathi' },
  { value: 'en',  label: '🇬🇧 English' },
  { value: 'kn',  label: '🇮🇳 Kannada' },
  { value: 'ta',  label: '🇮🇳 Tamil' },
  { value: 'te',  label: '🇮🇳 Telugu' },
  { value: 'ml',  label: '🇮🇳 Malayalam' },
  { value: 'bn',  label: '🇮🇳 Bengali' }
];

const LOCATIONS = ['Bengaluru', 'Delhi', 'Mumbai', 'Hyderabad', 'Chennai', 'Pune', 'Kolkata', 'Ahmedabad', 'Jaipur'];

export default function CollectorProfile() {
  const { t, lang, setLang } = useTranslation();
  const collectorId = currentCollectorId();

  const [collector, setCollector] = useState(null);
  const [form, setForm] = useState(null);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [gettingLoc, setGettingLoc] = useState(false);
  const [showMap, setShowMap] = useState(false);

  useEffect(() => {
    if (!collectorId) { setLoading(false); return; }
    getCollector(collectorId)
      .then(r => { setCollector(r.data); setForm(r.data); })
      .catch(() => setError(t('profile.loadError') || 'Could not load profile.'))
      .finally(() => setLoading(false));
  }, [collectorId, t]);

  function handleField(key, value) {
    setForm(f => ({ ...f, [key]: value }));
  }

  function handleGetLocation() {
    if (!navigator.geolocation) {
      setError(t('profile.locationError') || 'Geolocation not supported.');
      return;
    }
    setGettingLoc(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        handleField('latitude', pos.coords.latitude);
        handleField('longitude', pos.coords.longitude);
        setGettingLoc(false);
        setSuccess('Location updated. Save changes to keep it.');
      },
      (err) => {
        setGettingLoc(false);
        setError(t('profile.locationError') || 'Could not get location. Check permissions.');
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  async function handleSave() {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const payload = {
        name: form.name?.trim(),
        phone: form.phone?.trim(),
        operating_location: form.operating_location?.trim(),
        preferred_language: form.preferred_language,
      };
      
      // Allow saving coordinates if they were updated
      if (form.latitude !== collector.latitude || form.longitude !== collector.longitude) {
        payload.latitude = form.latitude;
        payload.longitude = form.longitude;
      }

      const r = await updateCollector(collectorId, payload);
      setCollector(r.data);
      setForm(r.data);
      setEditing(false);
      setShowMap(false);
      setSuccess(t('profile.updateSuccess') || 'Profile updated successfully!');
      
      // Update session and i18n language in real-time
      if (r.data.preferred_language && r.data.preferred_language !== lang) {
        setLang(r.data.preferred_language);
      }
      if (r.data.name || r.data.preferred_language) {
        updateSession({ 
          name: r.data.name, 
          preferred_language: r.data.preferred_language 
        });
      }
    } catch (err) {
      setError(err.message || t('profile.updateError') || 'Could not save profile.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <PageLoader />;

  const session = getSession();
  const locale = lang === 'hi' ? 'hi-IN' : lang === 'mr' ? 'mr-IN' : lang === 'kn' ? 'kn-IN' : lang === 'ta' ? 'ta-IN' : lang === 'te' ? 'te-IN' : lang === 'ml' ? 'ml-IN' : lang === 'bn' ? 'bn-IN' : 'en-IN';
  
  const formattedDate = collector?.created_at
    ? new Date(collector.created_at).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' })
    : t('profile.notSet') || '—';
    
  const memberSince = t('profile.memberSince', { date: formattedDate }) || `Member since ${formattedDate}`;

  return (
    <div className="container" style={{ maxWidth: '680px', margin: '0 auto', padding: 'var(--space-5) var(--space-4)' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-5)', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
        <div>
          <h1 className="section-title" style={{ marginBottom: '4px' }}>{t('profile.title') || 'My Profile'}</h1>
          <p className="section-subtitle" style={{ margin: 0 }}>{t('profile.subtitle') || 'Manage your collector account details'}</p>
        </div>
        {!editing ? (
          <button className="btn btn-primary" onClick={() => { setEditing(true); setSuccess(''); setError(''); }}>
            ✏️ {t('profile.editProfile') || 'Edit Profile'}
          </button>
        ) : (
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn btn-ghost" onClick={() => { setEditing(false); setShowMap(false); setForm(collector); setError(''); setSuccess(''); }} disabled={saving}>
              {t('profile.cancel') || 'Cancel'}
            </button>
            <button className="btn btn-accent" onClick={handleSave} disabled={saving} aria-busy={saving}>
              {saving ? <><LoadingSpinner size="sm" /> {t('profile.saving') || 'Saving…'}</> : `💾 ${t('profile.saveChanges') || 'Save Changes'}`}
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
            <div className="text-muted text-sm">{t('nav.collector') || 'Collector'} · {memberSince}</div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--space-4)' }}>
          {/* Name */}
          <div className="form-group">
            <label className="form-label">{t('profile.fullName') || 'Full Name'}</label>
            {editing ? (
              <input
                className="form-input"
                value={form?.name || ''}
                onChange={e => handleField('name', e.target.value)}
                placeholder={t('profile.namePlaceholder') || 'Your name'}
              />
            ) : (
              <p className="profile-value" style={{ margin: '4px 0 0', fontWeight: '500' }}>{collector?.name || '—'}</p>
            )}
          </div>

          {/* Phone */}
          <div className="form-group">
            <label className="form-label">{t('profile.phone') || 'Phone Number'}</label>
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
            <label className="form-label">{t('profile.operatingCity') || 'Operating City'}</label>
            <p className="text-muted text-xs" style={{ margin: '0 0 6px' }}>{t('profile.cityHint') || 'City where you collect scrap material'}</p>
            {editing ? (
              <select
                className="form-input"
                value={form?.operating_location || ''}
                onChange={e => handleField('operating_location', e.target.value)}
              >
                <option value="">{t('profile.selectCity') || 'Select city…'}</option>
                {LOCATIONS.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            ) : (
              <p className="profile-value" style={{ margin: '4px 0 0', fontWeight: '500' }}>📍 {collector?.operating_location || '—'}</p>
            )}
          </div>

          {/* Preferred Language */}
          <div className="form-group">
            <label className="form-label">{t('profile.preferredLanguage') || 'Preferred Language'}</label>
            <p className="text-muted text-xs" style={{ margin: '0 0 6px' }}>{t('profile.langHint') || 'Used for notifications and the app UI'}</p>
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
        <h2 className="detail-section-title" style={{ marginBottom: 'var(--space-3)' }}>{t('profile.accountInfo') || 'Account Information'}</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--space-3)' }}>
          <div>
            <span className="detail-item__label" style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>{t('profile.collectorId') || 'Collector ID'}</span>
            <p className="font-mono" style={{ margin: '2px 0 0', fontSize: '0.85rem', fontWeight: '500' }}>{collector?.id || '—'}</p>
          </div>
          <div>
            <span className="detail-item__label" style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>{t('profile.accountRole') || 'Account Role'}</span>
            <p style={{ margin: '2px 0 0', fontWeight: '600' }}>♻️ {t('profile.collectorRole') || 'Scrap Collector'}</p>
          </div>
          <div>
            <span className="detail-item__label" style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>{t('profile.gpsCoords') || 'GPS Coordinates'}</span>
            <p className="font-mono" style={{ margin: '2px 0 0', fontSize: '0.82rem', color: 'var(--color-text-muted)', marginBottom: editing ? '12px' : '0' }}>
              {form?.latitude && form?.longitude
                ? `${Number(form.latitude).toFixed(5)}, ${Number(form.longitude).toFixed(5)}`
                : (t('profile.notSet') || 'Not set')}
            </p>
            {editing && !showMap && (
              <button
                className="btn btn-outline btn-sm"
                style={{ width: '100%' }}
                onClick={() => setShowMap(true)}
              >
                ✏️ Change Coordinates
              </button>
            )}
            {editing && showMap && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <MapPicker 
                  lat={form?.latitude} 
                  lng={form?.longitude} 
                  onChange={(lat, lng) => {
                    handleField('latitude', lat);
                    handleField('longitude', lng);
                  }}
                />
                <button 
                  className="btn btn-outline btn-sm" 
                  style={{ width: '100%' }}
                  onClick={handleGetLocation}
                  disabled={gettingLoc}
                  title="Use Device GPS"
                >
                  {gettingLoc ? <LoadingSpinner size="sm" /> : '📍'} 
                  {gettingLoc ? (t('profile.gettingLocation') || 'Getting location...') : (t('profile.updateGPS') || 'Update to Current Location')}
                </button>
              </div>
            )}
          </div>
          <div>
            <span className="detail-item__label" style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>{t('profile.memberSince') ? t('profile.memberSince', { date: formattedDate }) : 'Member Since'}</span>
            <p style={{ margin: '2px 0 0', fontWeight: '500' }}>{formattedDate}</p>
          </div>
        </div>
      </section>
    </div>
  );
}
