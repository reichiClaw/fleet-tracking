import { lazy, Suspense, type ReactElement } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';

import { useAuth, type UserRole } from '../auth/AuthContext';
import { LoadingState } from '../components/LoadingState';
import { AppLayout } from '../layouts/AppLayout';

const AddVehiclePage = lazy(() => import('../pages/AddVehiclePage').then((module) => ({ default: module.AddVehiclePage })));
const AccessDeniedPage = lazy(() => import('../pages/AccessDeniedPage').then((module) => ({ default: module.AccessDeniedPage })));
const AdminImportPage = lazy(() => import('../pages/AdminImportPage').then((module) => ({ default: module.AdminImportPage })));
const ArchivePage = lazy(() => import('../pages/ArchivePage').then((module) => ({ default: module.ArchivePage })));
const CategoryManagementPage = lazy(() => import('../pages/CategoryManagementPage').then((module) => ({ default: module.CategoryManagementPage })));
const DashboardPage = lazy(() => import('../pages/DashboardPage').then((module) => ({ default: module.DashboardPage })));
const LoanCheckoutPage = lazy(() => import('../pages/LoanCheckoutPage').then((module) => ({ default: module.LoanCheckoutPage })));
const LoginPage = lazy(() => import('../pages/LoginPage').then((module) => ({ default: module.LoginPage })));
const NotFoundPage = lazy(() => import('../pages/NotFoundPage').then((module) => ({ default: module.NotFoundPage })));
const PartnersPage = lazy(() => import('../pages/PartnersPage').then((module) => ({ default: module.PartnersPage })));
const QRAccessPage = lazy(() => import('../pages/QRAccessPage').then((module) => ({ default: module.QRAccessPage })));
const QRPrintPage = lazy(() => import('../pages/QRPrintPage').then((module) => ({ default: module.QRPrintPage })));
const ReportsPage = lazy(() => import('../pages/ReportsPage').then((module) => ({ default: module.ReportsPage })));
const UserManagementPage = lazy(() => import('../pages/UserManagementPage').then((module) => ({ default: module.UserManagementPage })));
const VehicleDetailPage = lazy(() => import('../pages/VehicleDetailPage').then((module) => ({ default: module.VehicleDetailPage })));
const VehicleHistoryPage = lazy(() => import('../pages/VehicleHistoryPage').then((module) => ({ default: module.VehicleHistoryPage })));
const VehiclePoolPage = lazy(() => import('../pages/VehiclePoolPage').then((module) => ({ default: module.VehiclePoolPage })));
const VehicleStatusPage = lazy(() => import('../pages/VehicleStatusPage').then((module) => ({ default: module.VehicleStatusPage })));
const WorkflowMenuPage = lazy(() => import('../pages/WorkflowMenuPage').then((module) => ({ default: module.WorkflowMenuPage })));
const WorkflowPage = lazy(() => import('../pages/WorkflowPage').then((module) => ({ default: module.WorkflowPage })));

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
    return <AccessDeniedPage />;
  }

  return children;
}

const workflowRoles: UserRole[] = ['admin', 'operations'];
const adminRoles: UserRole[] = ['admin'];

export function AppRoutes() {
  return (
    <Suspense fallback={<LoadingState />}>
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
        <Route path="archive" element={<ArchivePage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="qr" element={<QRAccessPage />} />
        <Route path="qr/print" element={<QRPrintPage />} />
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
        <Route path="categories" element={<RequireRole roles={adminRoles}><CategoryManagementPage /></RequireRole>} />
      </Route>
      <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}
