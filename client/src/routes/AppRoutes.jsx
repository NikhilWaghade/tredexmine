import { Routes, Route } from 'react-router-dom';
import { MainLayout } from '../layouts';
import { HomePage } from '../pages/Home';
import { AboutPage } from '../pages/About';
import { ContactPage } from '../pages/Contact';
import { NotFoundPage } from '../pages/NotFound';
import { ROUTES } from '../constants';

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<MainLayout />}>
        <Route path={ROUTES.HOME} element={<HomePage />} />
        <Route path={ROUTES.ABOUT} element={<AboutPage />} />
        <Route path={ROUTES.CONTACT} element={<ContactPage />} />
        <Route path={ROUTES.NOT_FOUND} element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

export default AppRoutes;
