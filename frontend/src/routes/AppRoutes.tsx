import type { ReactElement } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';

import { useAuth } from '../auth/AuthContext';
import { LoadingState } from '../components/LoadingState';
import { AppLayout } from '../layouts/AppLayout';
import { AdminImportPage } from '../pages/AdminImportPage';
import { DashboardPage } from '../pages/DashboardPage';
import { LoginPage } from '../pages/LoginPage';
import { CompanyManagementPage, DriverManagementPage } from '../pages/ManagementPage';
import { NotFoundPage } from '../pages/NotFoundPage';
import { PlaceholderPage } from '../pages/PlaceholderPage';
import { VehicleDetailPage } from '../pages/VehicleDetailPage';
import { VehiclePoolPage } from '../pages/VehiclePoolPage';
import { WorkflowPage } from '../pages/WorkflowPage';

function RequireAuth({ children }: { children: ReactElement }) {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return <LoadingState />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return children;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/app" replace />} />
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/app"
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="vehicles" element={<VehiclePoolPage />} />
        <Route path="vehicles/:vehicleId" element={<VehicleDetailPage />} />
        <Route path="workflows/check-in" element={<WorkflowPage kind="check-in" />} />
        <Route path="workflows/loan-checkout" element={<WorkflowPage kind="loan-checkout" />} />
        <Route path="workflows/loan-return" element={<WorkflowPage kind="loan-return" />} />
        <Route path="workflows/manufacturer-checkout" element={<WorkflowPage kind="manufacturer-checkout" />} />
        <Route path="drivers" element={<DriverManagementPage />} />
        <Route path="companies" element={<CompanyManagementPage />} />
        <Route path="imports" element={<AdminImportPage />} />
        <Route path="settings" element={<PlaceholderPage translationKey="settings" />} />
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
