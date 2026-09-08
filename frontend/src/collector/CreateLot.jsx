import { useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate, Link, Navigate } from 'react-router-dom';
import {
  createLot, getInstantValuation,
  DEMO_COLLECTOR_ID, DEFAULT_LOCATION, DEFAULT_LAT, DEFAULT_LNG, MATERIAL_CATEGORIES,
  submitAiFeedback, updateAiFeedback,
} from '../api/client';
import { currentCollectorId, clearSession, getSession } from '../services/auth';
import { classifyFile } from '../services/classification/analyze';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { useTranslation } from '../i18n/config.js';
import './CreateLot.css';
import './CreateLotP2.css';

const LOCATIONS = ['Bengaluru', 'Delhi', 'Mumbai', 'Hyderabad', 'Chennai', 'Pune', 'Kolkata', 'Ahmedabad', 'Jaipur'];
const MAX_PHOTOS = 3;

function useDebounce(fn, delay) {
  const timer = useRef(null);
  return useCallback((...args) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => fn(...args), delay);
  }, [fn, delay]);
}

export default function CreateLot() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const fileInputRef = useRef();
  const cameraInputRef = useRef();

  // Creating a lot requires a logged-in Kabadiwala account.
  const collectorId = currentCollectorId();
  const session = getSession();

  const STEPS = [
    t('createLot.steps.photoCategory'),
    t('createLot.steps.weightValue'),
    t('createLot.steps.reviewSubmit'),
  ];

  const [step, setStep] = useState(0);
  const [photos, setPhotos] = useState([]);
  const [category, setCategory] = useState('');
  const [subCategory, setSubCategory] = useState('');
  const [weight, setWeight] = useState('');
  const [location, setLocation] = useState(session?.operating_location || DEFAULT_LOCATION);
  const [collectionLat, setCollectionLat] = useState(session?.latitude != null ? Number(session.latitude) : DEFAULT_LAT);
  const [collectionLng, setCollectionLng] = useState(session?.longitude != null ? Number(session.longitude) : DEFAULT_LNG);
  const [detectingGps, setDetectingGps] = useState(false);
  const [gpsHint, setGpsHint] = useState('');
  const [description, setDescription] = useState('');

  const [classify, setClassify] = useState(null);
  const [classifying, setClassifying] = useState(false);
  const [classifyDismissed, setClassifyDismissed] = useState(false);
  const [aiFeedbackId, setAiFeedbackId] = useState(null);
  const [scanStep, setScanStep] = useState(0);
  const [scanProgress, setScanProgress] = useState(0);

  // Pipeline reticle staged through while the classifier runs.
  const PIPELINE = [
    'createLot.classification.pipeline.capture',
    'createLot.classification.pipeline.segment',
    'createLot.classification.pipeline.featExtract',
    'createLot.classification.pipeline.hueMap',
    'createLot.classification.pipeline.classify',
  ];

  const [valuation, setValuation] = useState(null);
  const [loadingVal, setLoadingVal] = useState(false);
  const [valError, setValError] = useState('');

  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [offlineSaved, setOfflineSaved] = useState(false);

  const catObj = MATERIAL_CATEGORIES.find(c => c.id === category);
  const catMeta = (id) => MATERIAL_CATEGORIES.find(c => c.id === id);

  const [photoError, setPhotoError] = useState('');

  function applySuggestion(id) {
    setCategory(id);
    setSubCategory('');
    setError('');
    setClassifyDismissed(true);
    if (aiFeedbackId && classify) {
      const outcome = id === classify.category ? 'accepted' : 'corrected';
      updateAiFeedback(aiFeedbackId, { human_category: id, outcome }).catch(() => {});
    }
  }

  function addPhotos(files) {
    setPhotoError('');
    const MAX_FILE_SIZE_BYTES = 6 * 1024 * 1024; // 6MB limit
    const incoming = Array.from(files || []);
    if (!incoming.length) return;

    // Validate MIME types
    const nonImages = incoming.filter(f => !f.type.startsWith('image/'));
    if (nonImages.length > 0) {
      setPhotoError('Only image files (JPG, PNG, WebP) are allowed.');
      return;
    }

    // Validate individual file sizes
    const oversized = incoming.filter(f => f.size > MAX_FILE_SIZE_BYTES);
    if (oversized.length > 0) {
      const names = oversized.map(f => `${f.name} (${(f.size / (1024 * 1024)).toFixed(1)}MB)`).join(', ');
      setPhotoError(`Image exceeds maximum allowed size of 6MB: ${names}. Please choose a smaller photo.`);
      return;
    }

    const remaining = MAX_PHOTOS - photos.length;
    if (remaining <= 0) {
      setPhotoError(`Maximum of ${MAX_PHOTOS} photos allowed per lot.`);
      return;
    }

    if (incoming.length > remaining) {
      setPhotoError(`Only ${remaining} more photo${remaining > 1 ? 's' : ''} can be added (maximum ${MAX_PHOTOS}).`);
    }

    const toAdd = incoming.slice(0, remaining).map(file => ({
      file,
      preview: URL.createObjectURL(file),
    }));
    setPhotos(prev => [...prev, ...toAdd]);
    if (toAdd.length) setClassifyDismissed(false);
  }

  function removePhoto(idx) {
    setPhotos(prev => {
      URL.revokeObjectURL(prev[idx]?.preview);
      return prev.filter((_, i) => i !== idx);
    });
  }

  function fileToDataUrl(file, maxDim = 640, quality = 0.7) {
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

  function handleDrop(e) {
    e.preventDefault();
    if (photos.length >= MAX_PHOTOS) return;
    addPhotos(e.dataTransfer.files);
  }

  function handleDetectGps() {
    if (!navigator.geolocation) {
      setGpsHint('Geolocation is not supported by your browser');
      return;
    }
    setDetectingGps(true);
    setGpsHint('Acquiring precise GPS coordinates…');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        const latNum = parseFloat(latitude.toFixed(6));
        const lngNum = parseFloat(longitude.toFixed(6));
        setCollectionLat(latNum);
        setCollectionLng(lngNum);
        setLocation(`GPS Location (${latitude.toFixed(4)}, ${longitude.toFixed(4)})`);
        setGpsHint(`📍 Coordinates detected: ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`);
        setDetectingGps(false);
        if (category && weight && Number(weight) > 0) {
          fetchValuation(weight, category, `GPS Location (${latitude.toFixed(4)}, ${longitude.toFixed(4)})`);
        }
      },
      () => {
        setGpsHint('Could not access GPS. Using selected city.');
        setDetectingGps(false);
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }

  useEffect(() => {
    return () => photos.forEach(p => URL.revokeObjectURL(p.preview));
  }, []); // eslint-disable-line

  useEffect(() => {
    const file = photos[0]?.file;
    if (!file || category || classifyDismissed) return;
    let cancelled = false;
    setClassifying(true);
    setClassify(null);
    setScanStep(0);
    setScanProgress(0);

    const tick = setInterval(() => {
      if (cancelled) return;
      setScanProgress((p) => Math.min(96, (p ?? 0) + (7 + Math.random() * 14)));
      setScanStep((s) => Math.min(PIPELINE.length - 1, s + 1));
    }, 280);

    classifyFile(file)
      .then(res => {
        if (!cancelled) {
          setScanProgress(100);
          setClassify(res);
          submitAiFeedback({
            collector_id: collectorId ?? null,
            ai_predicted_category: res.category,
            ai_confidence: res.confidence,
            ai_verdict: res.verdict,
            ai_candidates: res.candidates,
            ai_features: res.features,
            outcome: 'pending',
          }).then(r => {
            if (r?.data?.id) setAiFeedbackId(r.data.id);
          }).catch(() => {});
        }
      })
      .catch(() => { if (!cancelled) setClassify(null); })
      .finally(() => {
        if (!cancelled) { clearInterval(tick); setClassifying(false); }
      });
    return () => { cancelled = true; clearInterval(tick); };
  }, [photos[0]?.file]); // eslint-disable-line

  const fetchValuation = useCallback(async (w, cat, loc) => {
    if (!cat || !w || Number(w) <= 0) return;
    setLoadingVal(true);
    setValError('');
    try {
      const r = await getInstantValuation({ category: cat, location: loc, weight: Number(w) });
      setValuation(r.data);
    } catch (e) {
      setValuation(null);
      setValError(e.message?.includes('No pricing data')
        ? t('createLot.valuation.noPriceData', { category: cat, location: loc })
        : t('offline.backendOffline'));
    } finally {
      setLoadingVal(false);
    }
  }, [t]);

  const debouncedFetchVal = useDebounce(
    (w) => fetchValuation(w, category, location),
    600
  );

  function handleWeightChange(val) {
    setWeight(val);
    if (val && Number(val) > 0 && category) debouncedFetchVal(val);
    else if (!val || Number(val) <= 0) setValuation(null);
  }

  function incrementWeight(delta) {
    const next = Math.max(0.1, (Number(weight) || 0) + delta);
    const rounded = Math.round(next * 10) / 10;
    setWeight(String(rounded));
    if (category) fetchValuation(rounded, category, location);
  }

  useEffect(() => {
    if (category && weight && Number(weight) > 0) {
      fetchValuation(weight, category, location);
    }
  }, [location, category]); // eslint-disable-line

  function goToStep2() {
    if (!category) { setError(t('createLot.errors.selectCategory')); return; }
    setError('');
    if (aiFeedbackId && classify && !classifyDismissed) {
      const outcome = category === classify.category ? 'accepted' : 'corrected';
      updateAiFeedback(aiFeedbackId, { human_category: category, outcome }).catch(() => {});
      setClassifyDismissed(true);
    }
    setStep(1);
    if (weight && Number(weight) > 0) fetchValuation(weight, category, location);
  }

  function goToStep3() {
    if (!weight || Number(weight) <= 0) { setError(t('createLot.errors.validWeight')); return; }
    setError('');
    setStep(2);
  }

  async function handleSubmit() {
    setCreating(true);
    setError('');
    try {
      const descParts = [];
      if (subCategory) descParts.push(`Sub-category: ${subCategory}`);
      if (description) descParts.push(description);

      const image_refs = await Promise.all(photos.map((photo) => fileToDataUrl(photo.file)));

      const r = await createLot({
        collector_id: collectorId ?? DEMO_COLLECTOR_ID,
        category,
        approx_weight_kg: Number(weight),
        location,
        collection_lat: collectionLat != null ? Number(collectionLat) : undefined,
        collection_lng: collectionLng != null ? Number(collectionLng) : undefined,
        description: descParts.join(' | ') || undefined,
        image_refs: image_refs.filter(Boolean),
      });

      if (r.queued) {
        setOfflineSaved(true);
        setCreating(false);
        return;
      }

      navigate('/collector/matched-recyclers', {
        state: {
          lotId: r.data?.lot?.lot_id,
          category,
          location,
          lat: collectionLat ?? session?.latitude,
          lng: collectionLng ?? session?.longitude,
          valuation: r.data,
        },
      });
    } catch (err) {
      if (err.status === 404 && /collector/i.test(err.message || '')) {
        clearSession();
        return navigate('/login', { replace: true, state: { from: '/collector/create-lot' } });
      }
      setError(err.message || t('createLot.errors.submitFailed'));
      setCreating(false);
    }
  }

  function fmtRupees(n) {
    if (n == null) return '—';
    return `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
  }

  const rangePercent = valuation
    ? Math.round(((valuation.unit_price - valuation.market_range_low)
        / (valuation.market_range_high - valuation.market_range_low || 1)) * 100)
    : 0;

  if (!collectorId) {
    return <Navigate to="/login" replace state={{ from: '/collector/create-lot' }} />;
  }

  return (
    <div className="container">
      <div className="animate-fade-in" style={{ marginBottom: 'var(--space-6)' }}>
        <h1 className="section-title">{t('createLot.title')}</h1>
        <p className="section-subtitle">{t('createLot.subtitle')}</p>
      </div>

      {offlineSaved && (
        <div className="step-panel animate-scale-in" role="status">
          <section className="card p2-offline-saved">
            <div className="p2-offline-saved__icon" aria-hidden="true"></div>
            <h2 className="p2-section-title" style={{ textAlign: 'center' }}>
              {t('createLot.offlineSaved.title')}
            </h2>
            <p className="p2-offline-saved__desc">
              {t('createLot.offlineSaved.desc')}
            </p>
            <p className="p2-offline-saved__queue">
              {t('createLot.offlineSaved.queueNote')}
            </p>
            <Link to="/collector" className="btn btn-primary btn-lg btn-full">
              {t('createLot.offlineSaved.action')}
            </Link>
          </section>
        </div>
      )}

      {!offlineSaved && (<>
      <div className="stepper animate-fade-in" role="list" aria-label="Progress steps">
        {STEPS.map((s, i) => (
          <div
            key={s}
            className={`stepper__step ${i === step ? 'stepper__step--active' : ''} ${i < step ? 'stepper__step--done' : ''}`}
            role="listitem"
            aria-current={i === step ? 'step' : undefined}
          >
            <div className="stepper__dot">
              {i < step ? <span>✓</span> : <span>{i + 1}</span>}
            </div>
            <span className="stepper__label hide-mobile">{s}</span>
          </div>
        ))}
      </div>

      {error && (
        <div className="alert-banner alert-banner--error animate-fade-in" role="alert">
           {error}
        </div>
      )}

      {step === 0 && (
        <div className="step-panel animate-slide-up">
          <section className="card p2-section" aria-labelledby="photo-heading">
            <h2 id="photo-heading" className="p2-section-title">
              {t('createLot.photo.heading')}
              <span className="p2-optional">{t('createLot.photo.optional')}</span>
            </h2>
            <p className="p2-section-subtitle">
              {t('createLot.photo.subtitle')}
            </p>

            {photoError && (
              <div className="alert-banner alert-banner--error animate-fade-in" style={{ marginBottom: 'var(--space-4)' }} role="alert">
                {photoError}
              </div>
            )}

            {photos.length === 0 ? (
              <div
                className="p2-dropzone"
                onDragOver={e => e.preventDefault()}
                onDrop={handleDrop}
                role="region"
                aria-label="Photo upload area"
              >
                <div className="p2-dropzone__icon" aria-hidden="true">📷</div>
                <p className="p2-dropzone__text">
                  <strong>{t('createLot.photo.tapCamera')}</strong>
                </p>
                <p className="p2-dropzone__hint">
                  {t('createLot.photo.formats')}
                </p>
                <div className="p2-dropzone__buttons">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => cameraInputRef.current?.click()}
                  >
                    📸 {t('createLot.photo.btnCamera')}
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    🖼️ {t('createLot.photo.btnUpload')}
                  </button>
                </div>
              </div>
            ) : (
              <div className="p2-gallery">
                {photos.map((p, idx) => (
                  <div key={idx} className="p2-gallery__item animate-scale-in">
                    <img src={p.preview} alt={`Evidence ${idx + 1}`} className="p2-gallery__img" />
                    {idx === 0 && (
                      <span className="p2-gallery__badge">{t('createLot.photo.badgeCover')}</span>
                    )}
                    <button
                      type="button"
                      className="p2-gallery__remove"
                      onClick={() => removePhoto(idx)}
                      aria-label={t('createLot.photo.removePhoto', { n: idx + 1, index: idx + 1 })}
                    >
                      ×
                    </button>
                  </div>
                ))}

                {photos.length < MAX_PHOTOS && (
                  <div className="p2-gallery__add-group" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                    <button
                      type="button"
                      className="p2-gallery__add"
                      onClick={() => cameraInputRef.current?.click()}
                      aria-label="Take photo with camera"
                    >
                      <span style={{ fontSize: 20 }}>📸</span>
                      <span>{t('createLot.photo.btnCamera')}</span>
                    </button>
                    <button
                      type="button"
                      className="p2-gallery__add"
                      onClick={() => fileInputRef.current?.click()}
                      aria-label="Upload photo from files"
                    >
                      <span style={{ fontSize: 20 }}>🖼️</span>
                      <span>{t('createLot.photo.btnUpload')}</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              style={{ display: 'none' }}
              onChange={e => { if (e.target.files?.length) addPhotos(e.target.files); e.target.value = ''; }}
            />
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              style={{ display: 'none' }}
              onChange={e => { if (e.target.files?.length) addPhotos(e.target.files); e.target.value = ''; }}
            />

            {classifying && (
              <div className="p2-ai-banner p2-ai-banner--scanning animate-fade-in" role="status">
                <div className="p2-ai-banner__header">
                  <span className="p2-ai-banner__sparkle" aria-hidden="true">✨</span>
                  <div className="p2-ai-banner__title-wrap">
                    <strong>{t('createLot.classification.scanning')}</strong>
                    <span className="p2-ai-banner__meta">
                      {t(PIPELINE[scanStep])} ({Math.round(scanProgress)}%)
                    </span>
                  </div>
                  <LoadingSpinner size="sm" />
                </div>
                <div className="p2-ai-banner__bar" role="progressbar" aria-valuenow={Math.round(scanProgress)} aria-valuemin={0} aria-valuemax={100}>
                  <div className="p2-ai-banner__fill" style={{ width: `${scanProgress}%` }} />
                </div>
              </div>
            )}

            {!classifying && classify && !classifyDismissed && (
              <div className="p2-ai-banner p2-ai-banner--suggest animate-slide-up" role="region" aria-label="AI classification suggestion">
                <div className="p2-ai-banner__top">
                  <div className="p2-ai-banner__sparkle" aria-hidden="true">✨</div>
                  <div className="p2-ai-banner__body">
                    <div className="p2-ai-banner__category">
                      {t('createLot.classification.detected', { label: catMeta(classify.category)?.label || classify.category })}
                      <span className={`p2-ai-pill p2-ai-pill--${classify.verdict}`}>
                        {Math.round(classify.confidence * 100)}% {t('createLot.classification.match')}
                      </span>
                    </div>
                    {classify.reason && (
                      <p className="p2-ai-banner__reason">{classify.reason}</p>
                    )}
                  </div>
                </div>

                <div className="p2-ai-banner__actions">
                  <button
                    type="button"
                    className="btn btn-accent btn-sm"
                    onClick={() => applySuggestion(classify.category)}
                  >
                    ✓ {t('createLot.classification.useCategory', { name: catMeta(classify.category)?.label || classify.category })}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setClassifyDismissed(true)}
                  >
                    {t('createLot.classification.chooseOther')}
                  </button>
                </div>
              </div>
            )}
          </section>

          <section className="card p2-section" aria-labelledby="cat-heading">
            <h2 id="cat-heading" className="p2-section-title">
              {t('createLot.category.heading')}
            </h2>
            <p className="p2-section-subtitle">
              {t('createLot.category.subtitle')}
            </p>

            <div className="p2-cat-grid" role="group" aria-label="Material categories">
              {MATERIAL_CATEGORIES.map(cat => {
                const isSelected = category === cat.id;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    className={`p2-cat-card ${isSelected ? 'p2-cat-card--selected' : ''}`}
                    onClick={() => {
                      setCategory(cat.id);
                      setSubCategory('');
                      setError('');
                    }}
                    aria-pressed={isSelected}
                  >
                    <span className="p2-cat-card__icon" aria-hidden="true">{cat.icon}</span>
                    <span className="p2-cat-card__label">{cat.label}</span>
                    {isSelected && (
                      <span className="p2-cat-card__check" aria-hidden="true">✓</span>
                    )}
                  </button>
                );
              })}
            </div>

            {catObj?.sub && catObj.sub.length > 0 && (
              <div className="p2-subcat-wrap animate-fade-in">
                <label className="form-label" style={{ marginBottom: 'var(--space-2)' }}>
                  {t('createLot.category.subType')}
                </label>
                <div className="p2-subcat-pills" role="group" aria-label="Sub-categories">
                  {catObj.sub.map(s => (
                    <button
                      key={s}
                      type="button"
                      className={`p2-subcat-pill ${subCategory === s ? 'p2-subcat-pill--active' : ''}`}
                      onClick={() => setSubCategory(subCategory === s ? '' : s)}
                      aria-pressed={subCategory === s}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </section>

          <div className="form-actions">
            <Link to="/collector" className="btn btn-outline">{t('common.cancel')}</Link>
            <button
              className="btn btn-primary btn-lg"
              onClick={goToStep2}
              disabled={!category}
            >
              {t('createLot.actions.continueWeight')}
            </button>
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="step-panel animate-slide-up">
          <section className="card p2-section" aria-labelledby="weight-heading">
            <h2 id="weight-heading" className="p2-section-title">
              {t('createLot.weight.heading')}
            </h2>
            <p className="p2-section-subtitle">
              {t('createLot.weight.subtitle')}
            </p>

            <div className="p2-weight-stepper">
              <button
                type="button"
                className="p2-weight-stepper__btn"
                onClick={() => incrementWeight(-1)}
                disabled={!weight || Number(weight) <= 0.5}
                aria-label="Decrease 1 kg"
              >
                −1
              </button>
              <div className="p2-weight-stepper__input-wrap">
                <input
                  id="lot-weight"
                  className="p2-weight-stepper__input font-mono"
                  type="number"
                  step="0.1"
                  min="0.1"
                  placeholder="0.0"
                  value={weight}
                  onChange={e => handleWeightChange(e.target.value)}
                  autoFocus
                />
                <span className="p2-weight-stepper__unit">kg</span>
              </div>
              <button
                type="button"
                className="p2-weight-stepper__btn"
                onClick={() => incrementWeight(1)}
                aria-label="Increase 1 kg"
              >
                +1
              </button>
            </div>

            <div className="p2-weight-chips" role="group" aria-label="Quick weight presets">
              {[1, 5, 10, 25, 50].map(w => (
                <button
                  key={w}
                  type="button"
                  className={`p2-weight-chip ${Number(weight) === w ? 'p2-weight-chip--active' : ''}`}
                  onClick={() => {
                    setWeight(String(w));
                    if (category) fetchValuation(w, category, location);
                  }}
                >
                  {w} kg
                </button>
              ))}
            </div>

            <div className="form-group" style={{ marginTop: 'var(--space-5)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
                <label className="form-label" htmlFor="lot-location" style={{ margin: 0 }}>
                  {t('createLot.location.label')}
                </label>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={handleDetectGps}
                  disabled={detectingGps}
                  style={{ fontSize: '0.8rem', padding: '2px 8px', height: 'auto' }}
                >
                  {detectingGps ? <><LoadingSpinner size="sm" /> Locating…</> : '📍 Detect GPS'}
                </button>
              </div>
              <select
                id="lot-location"
                className="form-input form-select"
                value={LOCATIONS.includes(location) ? location : ''}
                onChange={e => {
                  setLocation(e.target.value);
                  setGpsHint('');
                }}
              >
                {!LOCATIONS.includes(location) && location && (
                  <option value="">{location}</option>
                )}
                {LOCATIONS.map(loc => (
                  <option key={loc} value={loc}>{loc}</option>
                ))}
              </select>
              {gpsHint && (
                <p className="form-hint" style={{ color: collectionLat ? 'var(--color-success, #16a34a)' : 'var(--color-primary)', marginTop: 'var(--space-1)' }}>
                  {gpsHint}
                </p>
              )}
            </div>
          </section>

          <section className="card p2-val-card" aria-labelledby="val-heading">
            <div className="p2-val-card__head">
              <div>
                <span className="p2-val-card__kicker">
                  {t('createLot.valuation.liveBenchmark')}
                </span>
                <h2 id="val-heading" className="p2-val-card__title">
                  {catObj?.label || category} · {location}
                </h2>
              </div>
              {loadingVal && <LoadingSpinner size="sm" />}
            </div>

            {valError ? (
              <div className="p2-val-card__empty">{valError}</div>
            ) : valuation ? (
              <div className="animate-fade-in">
                <div className="p2-val-hero">
                  <div className="p2-val-hero__amount font-mono">
                    {fmtRupees(valuation.estimated_value)}
                  </div>
                  <div className="p2-val-hero__rate">
                    {fmtRupees(valuation.unit_price)} / kg
                  </div>
                </div>

                <div className="p2-range">
                  <div className="p2-range__labels">
                    <span>{t('createLot.valuation.fairMin')} <strong>{fmtRupees(valuation.market_range_low)}</strong></span>
                    <span>{t('createLot.valuation.fairMax')} <strong>{fmtRupees(valuation.market_range_high)}</strong></span>
                  </div>
                  <div className="p2-range__bar">
                    <div className="p2-range__fill" style={{ width: `${Math.min(100, Math.max(0, rangePercent))}%` }} />
                  </div>
                </div>
              </div>
            ) : (
              <p className="p2-val-card__hint">
                {t('createLot.valuation.hint')}
              </p>
            )}
          </section>

          <div className="form-actions">
            <button className="btn btn-outline" onClick={() => setStep(0)}>
              {t('common.back')}
            </button>
            <button
              className="btn btn-primary btn-lg"
              onClick={goToStep3}
              disabled={!weight || Number(weight) <= 0}
            >
              {t('createLot.actions.reviewLot')}
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="step-panel animate-slide-up">
          <section className="card p2-section" aria-labelledby="review-heading">
            <h2 id="review-heading" className="p2-section-title">
              {t('createLot.review.heading')}
            </h2>

            <div className="p2-review-grid">
              <div className="p2-review-cell">
                <span className="p2-review-cell__label">{t('createLot.review.material')}</span>
                <span className="p2-review-cell__val">
                  {catObj?.icon} {catObj?.label || category}
                  {subCategory && <span className="p2-review-cell__sub"> ({subCategory})</span>}
                </span>
              </div>

              <div className="p2-review-cell">
                <span className="p2-review-cell__label">{t('createLot.review.weight')}</span>
                <span className="p2-review-cell__val font-mono">{weight} kg</span>
              </div>

              <div className="p2-review-cell">
                <span className="p2-review-cell__label">{t('createLot.review.location')}</span>
                <span className="p2-review-cell__val">{location}</span>
              </div>

              <div className="p2-review-cell p2-review-cell--highlight">
                <span className="p2-review-cell__label">{t('createLot.review.estValue')}</span>
                <span className="p2-review-cell__val font-mono" style={{ color: 'var(--color-primary)' }}>
                  {valuation ? fmtRupees(valuation.estimated_value) : '—'}
                </span>
              </div>
            </div>

            <div className="form-group" style={{ marginTop: 'var(--space-4)' }}>
              <label className="form-label" htmlFor="lot-desc">
                {t('createLot.review.notesLabel')}
                <span className="p2-optional">{t('createLot.photo.optional')}</span>
              </label>
              <textarea
                id="lot-desc"
                className="form-input"
                rows={2}
                placeholder={t('createLot.review.notesPlaceholder')}
                value={description}
                onChange={e => setDescription(e.target.value)}
              />
            </div>
          </section>

          <div className="form-actions">
            <button className="btn btn-outline" onClick={() => setStep(1)} disabled={creating}>
              {t('common.back')}
            </button>
            <button
              className="btn btn-primary btn-lg"
              onClick={handleSubmit}
              disabled={creating}
              aria-busy={creating}
            >
              {creating ? <><LoadingSpinner size="sm" /> {t('createLot.actions.creating')}</> : t('createLot.actions.submitFindRecyclers')}
            </button>
          </div>
        </div>
      )}
      </>)}
    </div>
  );
}
