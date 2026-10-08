import { ROUTES } from '../../constants';
import { Container, Button } from '../../components/common';

export function NotFoundPage() {
  return (
    <div className="flex-1 flex items-center justify-center py-20">
      <Container>
        <div className="max-w-xl mx-auto text-center flex flex-col items-center">
          <div className="relative mb-6">
            <span className="text-8xl sm:text-9xl font-black text-transparent bg-clip-text bg-gradient-to-b from-[#7A56D6] to-purple-900/30 select-none">
              404
            </span>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-xl sm:text-2xl font-bold text-white tracking-widest uppercase">
                Lost in Cluster
              </span>
            </div>
          </div>

          <h1 className="text-2xl sm:text-3xl font-extrabold text-white mb-4">
            Page Not Found
          </h1>

          <p className="text-gray-400 text-sm sm:text-base mb-8 max-w-md leading-relaxed">
            The requested destination route could not be found within the TreadExMine network.
            Please verify the URL or return to the platform home.
          </p>

          <div className="flex flex-col sm:flex-row items-center gap-4">
            <Button to={ROUTES.HOME} variant="primary" size="md">
              Return to Home
            </Button>
            <Button to={ROUTES.CONTACT} variant="outline" size="md">
              Report Issue
            </Button>
          </div>
        </div>
      </Container>
    </div>
  );
}

export default NotFoundPage;
