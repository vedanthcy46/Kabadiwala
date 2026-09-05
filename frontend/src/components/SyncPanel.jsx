/**
 * SyncPanel — slide-up panel listing pending/failed sync queue items.
 *
 * Accessible via the OfflineIndicator chip when there are pending operations.
 * Shows user-friendly labels only — does NOT expose raw payloads.
 *
 * Manual retry is available for 'failed' items.
 */

import { useEffect, useState, useCallback } from 'react';
import { getQueue, resetForRetry } from '../services/offline/syncQueue.js';
import { processSyncQueue } from '../services/offline/syncManager.js';
import { isOnline } from '../services/offline/offlineUtils.js';
import { useTranslation } from '../i18n/config.js';
import './SyncPanel.css';

function fmtDate(iso, lang) {
  if (!iso) return '';
  const locale = lang === 'hi' ? 'hi-IN' : lang === 'mr' ? 'mr-IN' : 'en-IN';
  return new Date(iso).toLocaleString(locale, {
    day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  });
}

export function SyncPanel({ id, onClose }) {
  const { t, lang } = useTranslation();
  const [items, setItems] = useState([]);
  const [retrying, setRetrying] = useState(null);

  // Human-readable labels for operations (resolved via t())
  const OPERATION_LABELS = {
    initiateHandover: t('recyclers.initiateHandover'),
  };

  const STATUS_LABELS = {
    pending:  { label: t('offline.syncPanel.statusPending'), cls: 'sync-item--pending' },
    syncing:  { label: t('offline.syncing') + '…',          cls: 'sync-item--syncing' },
    failed:   { label: t('offline.syncPanel.statusFailed'), cls: 'sync-item--failed' },
  };

  const load = useCallback(async () => {
    const q = await getQueue();
    setItems(q);
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 3000);
    return () => clearInterval(interval);
  }, [load]);

  async function handleRetry(item) {
    if (!isOnline()) return;
    setRetrying(item.id);
    try {
      await resetForRetry(item.id);
      await processSyncQueue();
      await load();
    } finally {
      setRetrying(null);
    }
  }

  return (
    <div
      id={id}
      className="sync-panel animate-scale-in"
      role="dialog"
      aria-label={t('offline.syncPanel.title')}
      aria-modal="false"
    >
      <div className="sync-panel__header">
        <h2 className="sync-panel__title">
           {t('offline.syncPanel.title')}
        </h2>
        <button
          className="sync-panel__close btn btn-ghost btn-sm"
          onClick={onClose}
          aria-label={t('common.close')}
        >
          
        </button>
      </div>

      <p className="sync-panel__subtitle">
        {t('offline.operationQueued')}
      </p>

      {items.length === 0 ? (
        <div className="sync-panel__empty">
          
          <p>{t('offline.syncPanel.noPending')}</p>
        </div>
      ) : (
        <ul className="sync-panel__list" aria-label={t('offline.syncPanel.title')}>
          {items.map((item) => {
            const st = STATUS_LABELS[item.status] ?? STATUS_LABELS.pending;
            const opLabel = OPERATION_LABELS[item.operation] ?? item.operation;
            return (
              <li
                key={item.id}
                className={`sync-item ${st.cls}`}
              >
                <div className="sync-item__info">
                  <p className="sync-item__op">{opLabel}</p>
                  {item.entityId && (
                    <p className="sync-item__entity">
                      Lot: <span className="font-mono">{item.entityId}</span>
                    </p>
                  )}
                  <p className="sync-item__time">{fmtDate(item.createdAt, lang)}</p>
                  {item.retryCount > 0 && (
                    <p className="sync-item__retries">
                      {t('offline.syncPanel.retries')}: {item.retryCount}
                    </p>
                  )}
                  {item.lastError && item.status === 'failed' && (
                    <p className="sync-item__error" role="alert">
                      {item.lastError}
                    </p>
                  )}
                </div>

                <div className="sync-item__right">
                  <span
                    className="sync-item__status-pill"
                    aria-label={`Status: ${st.label}`}
                  >
                    {st.label}
                  </span>
                  {item.status === 'failed' && isOnline() && (
                    <button
                      className="btn btn-outline btn-sm"
                      onClick={() => handleRetry(item)}
                      disabled={retrying === item.id}
                      aria-label={`${t('common.retry')} ${opLabel}`}
                    >
                      {retrying === item.id ? '…' : t('common.retry')}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {!isOnline() && (
        <p className="sync-panel__offline-note" role="note">
          
          {t('offline.autoSync')}
        </p>
      )}
    </div>
  );
}
