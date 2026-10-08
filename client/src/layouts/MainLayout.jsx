import { Outlet } from 'react-router-dom';
import { Navbar, Footer } from '../components/layout';

export function MainLayout() {
  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-black via-[#1a0033] to-black text-white relative selection:bg-[#7A56D6] selection:text-white">
      {/* Ambient background glow accents */}
      <div
        aria-hidden="true"
        className="fixed top-0 left-1/4 w-[500px] h-[500px] bg-[#7A56D6]/15 rounded-full blur-[140px] pointer-events-none -z-10"
      />
      <div
        aria-hidden="true"
        className="fixed bottom-0 right-1/4 w-[600px] h-[600px] bg-purple-900/15 rounded-full blur-[160px] pointer-events-none -z-10"
      />

      {/* Main Navigation Header */}
      <Navbar />

      {/* Primary Page Content */}
      <main className="flex-1 flex flex-col w-full">
        <Outlet />
      </main>

      {/* Footer */}
      <Footer />
    </div>
  );
}

export default MainLayout;
