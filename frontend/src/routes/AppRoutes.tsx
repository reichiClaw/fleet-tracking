import { lazy, Suspense, type ReactElement } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';

import { useAuth, type UserRole } from '../auth/AuthContext';
import { LoadingState } from '../components/LoadingState';
import { RouteErrorBoundary } from '../components/RouteErrorBoundary';
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
const TasksPage = lazy(() => import('../pages/TasksPage').then((module) => ({ default: module.TasksPage })));
const IntakePage = lazy(() => import('../pages/IntakePage').then((module) => ({ default: module.IntakePage })));
const MaintenanceTaskPage = lazy(() => import('../pages/MaintenanceTaskPage').then((module) => ({ default: module.MaintenanceTaskPage })));
const ReservationsPage = lazy(() => import('../pages/ReservationsPage').then((module) => ({ default: module.ReservationsPage })));
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

function RouteContent({ children }: { children: ReactElement }) {
  return (
    <RouteErrorBoundary>
      <Suspense fallback={<LoadingState />}>{children}</Suspense>
    </RouteErrorBoundary>
  );
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/app" replace />} />
      <Route path="/login" element={<RouteContent><LoginPage /></RouteContent>} />
      {/* Public, no-login-required vehicle status page reached by scanning the QR code. */}
      <Route path="/v/:qrCode" element={<RouteContent><VehicleStatusPage /></RouteContent>} />
      <Route
        path="/app"
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route index element={<RouteContent><DashboardPage /></RouteContent>} />
        <Route path="tasks" element={<RouteContent><TasksPage /></RouteContent>} />
        <Route path="vehicles" element={<RouteContent><VehiclePoolPage /></RouteContent>} />
        <Route path="vehicles/:vehicleId" element={<RouteContent><VehicleDetailPage /></RouteContent>} />
        <Route path="history" element={<RouteContent><VehicleHistoryPage /></RouteContent>} />
        <Route path="archive" element={<RouteContent><ArchivePage /></RouteContent>} />
        <Route path="reports" element={<RouteContent><ReportsPage /></RouteContent>} />
        <Route path="qr" element={<RouteContent><QRAccessPage /></RouteContent>} />
        <Route path="qr/print" element={<RouteContent><QRPrintPage /></RouteContent>} />
        <Route path="workflows/loans" element={<RouteContent><RequireRole roles={workflowRoles}><WorkflowMenuPage type="loan" /></RequireRole></RouteContent>} />
        <Route path="workflows/manufacturer" element={<RouteContent><RequireRole roles={workflowRoles}><WorkflowMenuPage type="manufacturer" /></RequireRole></RouteContent>} />
        <Route path="workflows/add-vehicle" element={<RouteContent><RequireRole roles={adminRoles}><AddVehiclePage /></RequireRole></RouteContent>} />
        <Route path="workflows/intake" element={<RouteContent><RequireRole roles={workflowRoles}><IntakePage /></RequireRole></RouteContent>} />
        <Route path="workflows/check-in" element={<RouteContent><RequireRole roles={workflowRoles}><WorkflowPage kind="check-in" /></RequireRole></RouteContent>} />
        <Route path="workflows/loan-checkout" element={<RouteContent><RequireRole roles={workflowRoles}><LoanCheckoutPage /></RequireRole></RouteContent>} />
        <Route path="workflows/loan-return" element={<RouteContent><RequireRole roles={workflowRoles}><WorkflowPage kind="loan-return" /></RequireRole></RouteContent>} />
        <Route path="workflows/manufacturer-return" element={<RouteContent><RequireRole roles={workflowRoles}><WorkflowPage kind="manufacturer-checkout" /></RequireRole></RouteContent>} />
        <Route path="workflows/manufacturer-checkout" element={<Navigate to="/app/workflows/manufacturer-return" replace />} />
        <Route path="tasks/maintenance" element={<RouteContent><RequireRole roles={workflowRoles}><MaintenanceTaskPage /></RequireRole></RouteContent>} />
        <Route path="reservations" element={<RouteContent><RequireRole roles={workflowRoles}><ReservationsPage /></RequireRole></RouteContent>} />
        <Route path="partners" element={<RouteContent><PartnersPage /></RouteContent>} />
        {/* Legacy paths kept as redirects so existing links keep working. */}
        <Route path="drivers" element={<Navigate to="/app/partners" replace />} />
        <Route path="companies" element={<Navigate to="/app/partners" replace />} />
        <Route path="imports" element={<RouteContent><RequireRole roles={adminRoles}><AdminImportPage /></RequireRole></RouteContent>} />
        <Route path="users" element={<RouteContent><RequireRole roles={adminRoles}><UserManagementPage /></RequireRole></RouteContent>} />
        <Route path="categories" element={<RouteContent><RequireRole roles={adminRoles}><CategoryManagementPage /></RequireRole></RouteContent>} />
      </Route>
      <Route path="*" element={<RouteContent><NotFoundPage /></RouteContent>} />
    </Routes>
  );
}
