import { useEffect } from 'react';
import { Navigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../../context';
import { ROUTES } from '../../constants';
import { Container, Button } from '../common';

/**
 * ProtectedRoute component
 * Guards routes requiring authentication and optional administrator privilege.
 * If user session is initializing, displays loading skeleton.
 * If user is unauthenticated, triggers the login modal and redirects to Home.
 * If requireAdmin is true and authenticated user is not an admin, displays HTTP 403 Forbidden access denial.
 */
export function ProtectedRoute({ children, requireAdmin = false }) {
  const { user, isAuthenticated, isLoading, openAuthModal } = useAuth();
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

  if (requireAdmin && user?.role !== 'admin') {
    return (
      <div className="py-20 text-center">
        <Container>
          <div className="max-w-md mx-auto p-8 sm:p-10 rounded-2xl bg-[#0e081e] border border-rose-900/40 shadow-2xl shadow-purple-950/80">
            <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-rose-950/60 border border-rose-800/60 flex items-center justify-center text-rose-400">
              <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h3 className="text-xl font-bold text-white mb-2">Access Forbidden (403)</h3>
            <p className="text-sm text-gray-400 mb-6 leading-relaxed">
              You do not have administrator permissions to access this management console.
            </p>
            <Link to={ROUTES.HOME}>
              <Button variant="primary" size="md" className="w-full">
                Return to Home
              </Button>
            </Link>
          </div>
        </Container>
      </div>
    );
  }

  return children;
}

export default ProtectedRoute;
