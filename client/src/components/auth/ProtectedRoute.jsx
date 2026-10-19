import { useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context';
import { ROUTES } from '../../constants';

/**
 * ProtectedRoute component
 * Guards routes requiring authentication.
 * If user session is initializing, displays loading skeleton.
 * If user is unauthenticated, triggers the login modal and redirects to Home.
 */
export function ProtectedRoute({ children }) {
  const { isAuthenticated, isLoading, openAuthModal } = useAuth();
  const location = useLocation();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      openAuthModal();
    }
  }, [isLoading, isAuthenticated, openAuthModal]);

  if (isLoading) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4">
        <div className="w-10 h-10 border-2 border-purple-500/20 border-t-purple-500 rounded-full animate-spin" />
        <span className="text-xs text-gray-400 font-medium tracking-wider uppercase">
          Verifying credentials...
        </span>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to={ROUTES.HOME} state={{ from: location }} replace />;
  }

  return children;
}

export default ProtectedRoute;
