import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getRecycler, updateRecycler, renewRecyclerAuthorization, MATERIAL_CATEGORIES } from '../api/client';
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

  // Authorization Renewal State
  const [showRenewModal, setShowRenewModal] = useState(false);
  const [renewing, setRenewing] = useState(false);
  const [renewForm, setRenewForm] = useState({
    authorization_number: '',
    authorization_issue_date: '',
    authorization_valid_until: '',
    authorization_document_url: '',
  });
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
    if (recycler?.profile_image) {
      setAvatarPreview(recycler.profile_image);
    } else {
      setAvatarPreview(null);
    }
    setAvatarFile(null);
    setEditing(false);
    setError('');
  }

  function openRenewModal() {
    setRenewForm({
      authorization_number: recycler?.authorization_number || '',
      authorization_issue_date: recycler?.authorization_issue_date ? new Date(recycler.authorization_issue_date).toISOString().slice(0, 10) : '',
      authorization_valid_until: recycler?.authorization_valid_until ? new Date(recycler.authorization_valid_until).toISOString().slice(0, 10) : '',
      authorization_document_url: recycler?.authorization_document_url || '',
    });
    setShowRenewModal(true);
  }

  async function handleRenewSubmit(e) {
    if (e) e.preventDefault();
    setRenewing(true);
    setError('');
    setSuccess('');
    try {
      const res = await renewRecyclerAuthorization(recyclerId, renewForm);
      setRecycler(res.data);
      setForm(res.data);
      setSuccess('Authorization renewal application submitted! Pending admin verification.');
      setShowRenewModal(false);
    } catch (err) {
      setError(err.message || 'Failed to submit authorization renewal');
    } finally {
      setRenewing(false);
    }
  }

  if (loading) return <div className="container"><PageLoader /></div>;

  const isExpiredOrWarning = recycler?.authorization_status === 'expiring_soon' ||
                             recycler?.authorization_status === 'expired' ||
                             recycler?.account_status === 'SUSPENDED' ||
                             recycler?.authorization_status === 'unauthorized';

  return (
    <div className="container">
      <div className="animate-fade-in" style={{ marginBottom: 'var(--space-6)' }}>
        <Link to="/recycler" className="back-link">{t('common.back')}</Link>
        <div className="profile-header">
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-2)' }}>
            <div 
              className="profile-avatar"
              title={avatarPreview ? `${recycler?.name || 'Recycler'} Profile Picture (Click to maximize)` : undefined}
            >
              {avatarPreview ? (
                <img
                  src={avatarPreview}
                  alt={`${recycler?.name || 'Recycler'} Profile Picture`}
                  className="profile-avatar__img"
                />
              ) : (
                <span aria-hidden="true">
                  {recycler?.name ? recycler.name.charAt(0).toUpperCase() : '🏭'}
                </span>
              )}
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
            <p className="section-subtitle" style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginTop: '4px' }}>
              <span>{recycler?.facility_location}</span> · 
              <StatusBadge status={recycler?.account_status || 'ACTIVE'} size="md" />
              <StatusBadge status={recycler?.authorization_status} size="md" />
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

      {isExpiredOrWarning && (
        <div className="alert-banner alert-banner--warn animate-fade-in" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <strong>⚠️ Controlled Recycler Authorization Status Alert:</strong>
            <p style={{ margin: '4px 0 0 0', fontSize: '0.9rem' }}>
              {recycler?.authorization_status === 'expired' || recycler?.account_status === 'SUSPENDED'
                ? 'Your SPCB authorization has EXPIRED or been SUSPENDED. Your facility is currently excluded from matching results until renewed.'
                : recycler?.authorization_status === 'expiring_soon'
                ? 'Your SPCB authorization is EXPIRING SOON. Please upload your renewed certificate before expiry.'
                : 'Your recycler registration is pending or requires authorization re-verification.'}
            </p>
          </div>
          <button className="btn btn-accent btn-sm" onClick={openRenewModal}>
            📄 Submit Renewal Application
          </button>
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

        {/* Materials Accepted & Controlled Authorization */}
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

          {/* Authorization info */}
          <div className="divider" style={{ margin: 'var(--space-5) 0' }} />
          <div className="auth-info">
            <h3 style={{ fontSize: '1rem', fontWeight: '600', marginBottom: '12px' }}>
              📜 SPCB Authorization & Governance
            </h3>
            
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px', marginBottom: '12px' }}>
              <div>
                <p className="detail-item__label">Account Status</p>
                <StatusBadge status={recycler?.account_status || 'ACTIVE'} size="md" />
              </div>
              <div>
                <p className="detail-item__label">Authorization Status</p>
                <StatusBadge status={recycler?.authorization_status} size="md" />
              </div>
              <div>
                <p className="detail-item__label">SPCB License #</p>
                <p className="profile-value font-mono">{recycler?.authorization_number || '—'}</p>
              </div>
              <div>
                <p className="detail-item__label">Issue Date</p>
                <p className="profile-value">{recycler?.authorization_issue_date ? new Date(recycler.authorization_issue_date).toLocaleDateString('en-IN') : '—'}</p>
              </div>
              <div>
                <p className="detail-item__label">Expiry Date</p>
                <p className="profile-value font-mono" style={{ color: isExpiredOrWarning ? 'var(--color-destructive, #dc2626)' : 'inherit' }}>
                  {recycler?.authorization_valid_until ? new Date(recycler.authorization_valid_until).toLocaleDateString('en-IN') : '—'}
                </p>
              </div>
            </div>

            {recycler?.authorization_document_url && (
              <div style={{ marginBottom: '12px' }}>
                <p className="detail-item__label">Submitted Document</p>
                <a href={recycler.authorization_document_url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm" style={{ padding: 0, textDecoration: 'underline' }}>
                  📎 View SPCB Authorization Document
                </a>
              </div>
            )}

            {recycler?.rejection_reason && (
              <div className="alert-banner alert-banner--error" style={{ fontSize: '0.85rem', padding: '8px 12px', marginTop: '8px' }}>
                <strong>Rejection Reason:</strong> {recycler.rejection_reason}
              </div>
            )}

            <button type="button" className="btn btn-outline btn-sm" style={{ marginTop: '12px' }} onClick={openRenewModal}>
              🔄 Renew Authorization Certificate
            </button>
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

      {/* Renewal Application Modal */}
      {showRenewModal && (
        <div className="modal-backdrop animate-fade-in" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div className="card animate-scale-in" style={{ width: '90%', maxWidth: '540px', background: 'var(--color-bg, #fff)', padding: '24px', borderRadius: '12px' }}>
            <h2 className="section-title" style={{ fontSize: '1.25rem', marginBottom: '8px' }}>
              🔄 Submit Authorization Renewal
            </h2>
            <p className="section-subtitle" style={{ fontSize: '0.9rem', marginBottom: '16px' }}>
              Upload your updated State Pollution Control Board (SPCB) authorization details for admin re-verification.
            </p>

            <form onSubmit={handleRenewSubmit}>
              <div className="form-group" style={{ marginBottom: '12px' }}>
                <label className="form-label">SPCB Authorization / License Number</label>
                <input
                  className="form-input"
                  required
                  placeholder="e.g. SPCB/AUTH/2026/089"
                  value={renewForm.authorization_number}
                  onChange={e => setRenewForm({ ...renewForm, authorization_number: e.target.value })}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                <div className="form-group">
                  <label className="form-label">Issue Date</label>
                  <input
                    type="date"
                    className="form-input"
                    value={renewForm.authorization_issue_date}
                    onChange={e => setRenewForm({ ...renewForm, authorization_issue_date: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Expiry Date (Valid Until)</label>
                  <input
                    type="date"
                    className="form-input"
                    required
                    value={renewForm.authorization_valid_until}
                    onChange={e => setRenewForm({ ...renewForm, authorization_valid_until: e.target.value })}
                  />
                </div>
              </div>

              <div className="form-group" style={{ marginBottom: '20px' }}>
                <label className="form-label">Authorization Certificate Document (URL / Link)</label>
                <input
                  type="url"
                  className="form-input"
                  placeholder="https://spcb.gov.in/docs/cert_123.pdf"
                  value={renewForm.authorization_document_url}
                  onChange={e => setRenewForm({ ...renewForm, authorization_document_url: e.target.value })}
                />
              </div>

              <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-outline" onClick={() => setShowRenewModal(false)} disabled={renewing}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-accent" disabled={renewing}>
                  {renewing ? <LoadingSpinner size="sm" /> : null}
                  {renewing ? 'Submitting…' : 'Submit Application'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
