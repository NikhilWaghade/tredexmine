import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { MainLayout } from '../layouts';
import { HomePage } from '../pages/Home';
import { PlansPage } from '../pages/Plans';
import { DashboardPage } from '../pages/Dashboard';
import { AboutPage } from '../pages/About';
import { ContactPage } from '../pages/Contact';
import { NotFoundPage } from '../pages/NotFound';
import { AdminPlansPage } from '../pages/Admin';
import { ProtectedRoute } from '../components/auth';
import { useAuth } from '../context';
import { ROUTES } from '../constants';

function LoginRoute() {
  const { isAuthenticated, openAuthModal } = useAuth();
  useEffect(() => {
    if (!isAuthenticated) {
      openAuthModal();
    }
  }, [isAuthenticated, openAuthModal]);
  return <Navigate to={isAuthenticated ? ROUTES.DASHBOARD : ROUTES.HOME} replace />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<MainLayout />}>
        <Route path={ROUTES.HOME} element={<HomePage />} />
        <Route path={ROUTES.PLANS} element={<PlansPage />} />
        <Route
          path={ROUTES.DASHBOARD}
          element={
            <ProtectedRoute>
              <DashboardPage />
            </ProtectedRoute>
          }
        />
        <Route
          path={ROUTES.ADMIN_PLANS}
          element={
            <ProtectedRoute requireAdmin={true}>
              <AdminPlansPage />
            </ProtectedRoute>
          }
        />
        <Route path={ROUTES.LOGIN} element={<LoginRoute />} />
        <Route path={ROUTES.ABOUT} element={<AboutPage />} />
        <Route path={ROUTES.CONTACT} element={<ContactPage />} />
        <Route path={ROUTES.NOT_FOUND} element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

export default AppRoutes;

