import type { ReactElement } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';

import { useAuth, type UserRole } from '../auth/AuthContext';
import { LoadingState } from '../components/LoadingState';
import { AppLayout } from '../layouts/AppLayout';
import { AdminImportPage } from '../pages/AdminImportPage';
import { DashboardPage } from '../pages/DashboardPage';
import { LoginPage } from '../pages/LoginPage';
import { CompanyManagementPage, DriverManagementPage } from '../pages/ManagementPage';
import { NotFoundPage } from '../pages/NotFoundPage';
import { QRAccessPage, QRResolvePage } from '../pages/QRAccessPage';
import { UserManagementPage } from '../pages/UserManagementPage';
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


function RequireRole({ children, roles }: { children: ReactElement; roles: UserRole[] }) {
  const { user } = useAuth();

  if (!user || !roles.includes(user.role)) {
    return <Navigate to="/app" replace />;
  }

  return children;
}

const workflowRoles: UserRole[] = ['admin', 'operations'];
const adminRoles: UserRole[] = ['admin'];

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
        <Route path="qr" element={<QRAccessPage />} />
        <Route path="qr/v/:qrCode" element={<QRResolvePage />} />
        <Route path="workflows/check-in" element={<RequireRole roles={workflowRoles}><WorkflowPage kind="check-in" /></RequireRole>} />
        <Route path="workflows/loan-checkout" element={<RequireRole roles={workflowRoles}><WorkflowPage kind="loan-checkout" /></RequireRole>} />
        <Route path="workflows/loan-return" element={<RequireRole roles={workflowRoles}><WorkflowPage kind="loan-return" /></RequireRole>} />
        <Route path="workflows/manufacturer-checkout" element={<RequireRole roles={workflowRoles}><WorkflowPage kind="manufacturer-checkout" /></RequireRole>} />
        <Route path="drivers" element={<DriverManagementPage />} />
        <Route path="companies" element={<CompanyManagementPage />} />
        <Route path="imports" element={<RequireRole roles={adminRoles}><AdminImportPage /></RequireRole>} />
        <Route path="users" element={<RequireRole roles={adminRoles}><UserManagementPage /></RequireRole>} />
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
