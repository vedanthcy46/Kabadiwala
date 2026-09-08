import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getRecycler, updateRecycler, MATERIAL_CATEGORIES } from '../api/client';
import { resolveRecyclerId } from '../services/auth';
import { StatusBadge } from '../components/StatusBadge';
import { PageLoader, LoadingSpinner } from '../components/LoadingSpinner';
import { useTranslation } from '../i18n/config.js';
import './Profile.css';

export default function RecyclerProfile() {
  const { t } = useTranslation();
  const [recycler, setRecycler] = useState(null);
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [editing, setEditing] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState(null);
  const [avatarFile, setAvatarFile] = useState(null);
  const recyclerId = resolveRecyclerId();

  function fileToDataUrl(file, maxDim = 640, quality = 0.8) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onerror = () => resolve(null);
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => resolve(reader.result);
        img.onload = () => {
          try {
            const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(img.width * scale);
            canvas.height = Math.round(img.height * scale);
            canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL('image/jpeg', quality));
          } catch {
            resolve(reader.result);
          }
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function handleImageChange(e) {
    const file = e.target.files[0];
    if (file) {
      setAvatarFile(file);
      setAvatarPreview(URL.createObjectURL(file));
    }
  }

  useEffect(() => {
    getRecycler(recyclerId)
      .then(r => {
        setRecycler(r.data);
        setForm(r.data);
        if (r.data?.profile_image) {
          setAvatarPreview(r.data.profile_image);
        }
      })
      .catch(() => setError(t('recyclerDash.profileError')))
      .finally(() => setLoading(false));
  }, []);

  function handleField(field, value) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  function toggleMaterial(matId) {
    const current = form.materials_accepted || [];
    const next = current.includes(matId)
      ? current.filter(m => m !== matId)
      : [...current, matId];
    handleField('materials_accepted', next);
  }

  async function handleSave() {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      let profile_image = form.profile_image || recycler?.profile_image;
      if (avatarFile) {
        const dataUrl = await fileToDataUrl(avatarFile);
        if (dataUrl) {
          profile_image = dataUrl;
        }
      }

      const payload = {
        name: form.name ? String(form.name) : undefined,
        facility_location: form.facility_location ? String(form.facility_location) : undefined,
        materials_accepted: form.materials_accepted,
        service_area: form.service_area ? String(form.service_area) : undefined,
        contact_details: form.contact_details != null ? String(form.contact_details) : (form.contact != null ? String(form.contact) : ''),
        pickup_availability: form.pickup_availability,
        ...(profile_image ? { profile_image } : {}),
      };
      const r = await updateRecycler(recyclerId, payload);
      setRecycler(r.data);
      setForm(r.data);
      if (r.data?.profile_image) {
        setAvatarPreview(r.data.profile_image);
      }
      setAvatarFile(null);
      setSuccess(t('recyclerDash.profileUpdated'));
      setEditing(false);
    } catch (err) {
      setError(err.message || t('recyclerDash.profileUpdateFail'));
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    setForm(recycler);
    setAvatarFile(null);
    setAvatarPreview(recycler?.profile_image || null);
    setEditing(false);
    setError('');
  }

  if (loading) return <div className="container"><PageLoader /></div>;

  return (
    <div className="container">
      <div className="animate-fade-in" style={{ marginBottom: 'var(--space-6)' }}>
        <Link to="/recycler" className="back-link">{t('common.back')}</Link>
        <div className="profile-header">
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-2)' }}>
            <div 
              className="profile-avatar" 
              aria-hidden="true"
              style={avatarPreview ? { backgroundImage: `url(${avatarPreview})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}}
            >
              {!avatarPreview && (recycler?.name ? recycler.name.charAt(0).toUpperCase() : '🏭')}
            </div>
            {editing && (
              <label className="btn btn-ghost btn-sm" style={{ cursor: 'pointer' }}>
                <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImageChange} />
                + Add Image
              </label>
            )}
          </div>
          <div>
            <h1 className="section-title">{recycler?.name || t('recyclerDash.myProfile')}</h1>
            <p className="section-subtitle">
              {recycler?.facility_location} · <StatusBadge status={recycler?.authorization_status} />
            </p>
          </div>
          {!editing && (
            <button className="btn btn-outline" onClick={() => setEditing(true)}>
               {t('recyclerDash.editProfile')}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="alert-banner alert-banner--error animate-fade-in">
           {error}
        </div>
      )}
      {success && (
        <div className="alert-banner alert-banner--success animate-fade-in">
           {success}
        </div>
      )}

      {/* Profile Form / View */}
      <div className="profile-layout">
        {/* Basic Info */}
        <section className="card animate-scale-in" aria-labelledby="profile-info-heading">
          <h2 id="profile-info-heading" className="detail-section-title">{t('recyclerDash.basicInfo')}</h2>
          <div className="profile-form">
            <div className="form-group">
              <label className="form-label" htmlFor="p-name">{t('recyclerDash.facilityName')}</label>
              {editing ? (
                <input
                  id="p-name"
                  className="form-input"
                  value={form?.name || ''}
                  onChange={e => handleField('name', e.target.value)}
                />
              ) : (
                <p className="profile-value">{recycler?.name || '—'}</p>
              )}
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="p-location">{t('recyclerDash.facilityLocation')}</label>
              {editing ? (
                <input
                  id="p-location"
                  className="form-input"
                  value={form?.facility_location || ''}
                  onChange={e => handleField('facility_location', e.target.value)}
                />
              ) : (
                <p className="profile-value">{recycler?.facility_location || '—'}</p>
              )}
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="p-service">{t('recyclerDash.serviceArea')}</label>
              {editing ? (
                <input
                  id="p-service"
                  className="form-input"
                  value={form?.service_area || ''}
                  onChange={e => handleField('service_area', e.target.value)}
                />
              ) : (
                <p className="profile-value">{recycler?.service_area || '—'}</p>
              )}
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="p-contact">{t('recyclerDash.contact')}</label>
              {editing ? (
                <input
                  id="p-contact"
                  className="form-input"
                  value={form?.contact_details || ''}
                  onChange={e => handleField('contact_details', e.target.value)}
                  placeholder="Phone / email"
                />
              ) : (
                <p className="profile-value">{recycler?.contact_details || '—'}</p>
              )}
            </div>

            <div className="form-group">
              <label className="form-label">{t('recyclerDash.pickupAvailable')}</label>
              {editing ? (
                <div className="toggle-wrap">
                  <button
                    className={`toggle-btn ${form?.pickup_availability === 'daily' ? 'toggle-btn--on' : ''}`}
                    onClick={() => handleField('pickup_availability', form?.pickup_availability === 'daily' ? 'on_request' : 'daily')}
                    aria-pressed={form?.pickup_availability === 'daily'}
                    type="button"
                  >
                    <span className="toggle-thumb" />
                  </button>
                  <span>{form?.pickup_availability === 'daily' ? t('recyclerDash.pickupYes') : t('recyclerDash.pickupNo')}</span>
                </div>
              ) : (
                <p className="profile-value">
                  {recycler?.pickup_availability === 'daily' ? ` ${t('recyclerDash.pickupYes')}` : ` ${t('recyclerDash.pickupNo')}`}
                </p>
              )}
            </div>
          </div>
        </section>

        {/* Materials Accepted */}
        <section className="card animate-scale-in" aria-labelledby="profile-mats-heading">
          <h2 id="profile-mats-heading" className="detail-section-title">{t('createLot.category.heading')}</h2>

          {editing ? (
            <div className="materials-grid" role="group" aria-label="Select accepted materials">
              {MATERIAL_CATEGORIES.map(cat => {
                const selected = (form?.materials_accepted || []).includes(cat.id);
                return (
                  <button
                    key={cat.id}
                    className={`material-toggle ${selected ? 'material-toggle--on' : ''}`}
                    onClick={() => toggleMaterial(cat.id)}
                    aria-pressed={selected}
                    type="button"
                  >
                    <span aria-hidden="true">{cat.icon}</span>
                    <span>{cat.label}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="materials-pills">
              {(recycler?.materials_accepted || []).length === 0 ? (
                <p className="text-muted">{t('common.noData')}</p>
              ) : (
                (recycler?.materials_accepted || []).map(m => {
                  const cat = MATERIAL_CATEGORIES.find(c => c.id === m);
                  return (
                    <span key={m} className="material-pill">
                      <span aria-hidden="true">{cat?.icon || ''}</span>
                      {cat?.label || m}
                    </span>
                  );
                })
              )}
            </div>
          )}

          {/* Authorization info (read-only) */}
          <div className="divider" style={{ margin: 'var(--space-5) 0' }} />
          <div className="auth-info">
            <div>
              <p className="detail-item__label">{t('status.confirmed').replace('Confirmed', 'Authorization Status')}</p>
              <StatusBadge status={recycler?.authorization_status} size="md" />
            </div>
            {recycler?.authorization_details && (
              <div>
                <p className="detail-item__label">Authorization Details</p>
                <p className="profile-value">{recycler.authorization_details}</p>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Save / Cancel */}
      {editing && (
        <div className="profile-actions animate-fade-in">
          <button className="btn btn-outline" onClick={handleCancel} disabled={saving}>
            {t('common.cancel')}
          </button>
          <button className="btn btn-accent btn-lg" onClick={handleSave} disabled={saving}>
            {saving ? <LoadingSpinner size="sm" /> : null}
            {saving ? `${t('recyclerDash.profileUpdated').replace('!', '...').replace('updated successfully', 'Saving')}` : ` ${t('common.save') || 'Save Changes'}`}
          </button>
        </div>
      )}
    </div>
  );
}
