import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { BrowserRouter } from 'react-router-dom';

import { AuthProvider } from './auth/AuthContext';
import { AppRoutes } from './routes/AppRoutes';

export default function App() {
  const { t } = useTranslation();

  useEffect(() => {
    document.title = t('app.documentTitle');
  }, [t]);

  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
