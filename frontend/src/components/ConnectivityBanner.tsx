import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { API_CONNECTIVITY_EVENT } from '../api/client';

export function ConnectivityBanner() {
  const { t } = useTranslation();
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    const handleApiConnectivity = (event: Event) => {
      setOnline(Boolean((event as CustomEvent<{ online: boolean }>).detail?.online));
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener(API_CONNECTIVITY_EVENT, handleApiConnectivity);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener(API_CONNECTIVITY_EVENT, handleApiConnectivity);
    };
  }, []);

  return online ? null : (
    <div className="connectivity-banner" role="status" aria-live="polite">
      <strong>{t('connectivity.offlineTitle')}</strong>
      <span>{t('connectivity.offlineDescription')}</span>
    </div>
  );
}
