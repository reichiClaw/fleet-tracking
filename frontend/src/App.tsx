import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';

import { AuthProvider } from './auth/AuthContext';
import { AppRoutes } from './routes/AppRoutes';

function RoutedApplication() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}

export default function App() {
  const { t } = useTranslation();
  const [router] = useState(() => createBrowserRouter([
    {
      path: '*',
      element: <RoutedApplication />,
    },
  ]));

  useEffect(() => {
    document.title = t('app.documentTitle');
  }, [t]);

  return (
    <RouterProvider router={router} />
  );
}
