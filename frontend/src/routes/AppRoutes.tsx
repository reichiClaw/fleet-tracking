import type { ReactElement } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';

import { useAuth, type UserRole } from '../auth/AuthContext';
import { LoadingState } from '../components/LoadingState';
import { AppLayout } from '../layouts/AppLayout';
import { AddVehiclePage } from '../pages/AddVehiclePage';
import { AdminImportPage } from '../pages/AdminImportPage';
import { DashboardPage } from '../pages/DashboardPage';
import { LoanCheckoutPage } from '../pages/LoanCheckoutPage';
import { LoginPage } from '../pages/LoginPage';
import { PartnersPage } from '../pages/PartnersPage';
import { NotFoundPage } from '../pages/NotFoundPage';
import { QRAccessPage } from '../pages/QRAccessPage';
import { ReportsPage } from '../pages/ReportsPage';
import { UserManagementPage } from '../pages/UserManagementPage';
import { VehicleDetailPage } from '../pages/VehicleDetailPage';
import { VehicleHistoryPage } from '../pages/VehicleHistoryPage';
import { VehicleStatusPage } from '../pages/VehicleStatusPage';
import { VehiclePoolPage } from '../pages/VehiclePoolPage';
import { WorkflowMenuPage } from '../pages/WorkflowMenuPage';
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
      {/* Public, no-login-required vehicle status page reached by scanning the QR code. */}
      <Route path="/v/:qrCode" element={<VehicleStatusPage />} />
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
        <Route path="history" element={<VehicleHistoryPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="qr" element={<QRAccessPage />} />
        <Route path="workflows/loans" element={<RequireRole roles={workflowRoles}><WorkflowMenuPage type="loan" /></RequireRole>} />
        <Route path="workflows/manufacturer" element={<RequireRole roles={workflowRoles}><WorkflowMenuPage type="manufacturer" /></RequireRole>} />
        <Route path="workflows/add-vehicle" element={<RequireRole roles={adminRoles}><AddVehiclePage /></RequireRole>} />
        <Route path="workflows/check-in" element={<RequireRole roles={workflowRoles}><WorkflowPage kind="check-in" /></RequireRole>} />
        <Route path="workflows/loan-checkout" element={<RequireRole roles={workflowRoles}><LoanCheckoutPage /></RequireRole>} />
        <Route path="workflows/loan-return" element={<RequireRole roles={workflowRoles}><WorkflowPage kind="loan-return" /></RequireRole>} />
        <Route path="workflows/manufacturer-checkout" element={<RequireRole roles={workflowRoles}><WorkflowPage kind="manufacturer-checkout" /></RequireRole>} />
        <Route path="partners" element={<PartnersPage />} />
        {/* Legacy paths kept as redirects so existing links keep working. */}
        <Route path="drivers" element={<Navigate to="/app/partners" replace />} />
        <Route path="companies" element={<Navigate to="/app/partners" replace />} />
        <Route path="imports" element={<RequireRole roles={adminRoles}><AdminImportPage /></RequireRole>} />
        <Route path="users" element={<RequireRole roles={adminRoles}><UserManagementPage /></RequireRole>} />
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
