import { useState, useEffect } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { NAV_LINKS, ROUTES } from '../../constants';
import { Container, Button } from '../common';
import { useScrollPosition } from '../../hooks';
import { cn } from '../../utils';

export function Navbar() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const scrollPosition = useScrollPosition();
  const location = useLocation();

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  const isScrolled = scrollPosition > 20;

  return (
    <header
      className={cn(
        'sticky top-0 z-50 w-full transition-all duration-300',
        isScrolled
          ? 'bg-black/80 backdrop-blur-md border-b border-purple-900/40 shadow-lg shadow-black/50 py-3.5'
          : 'bg-transparent border-b border-white/5 py-5'
      )}
    >
      <Container>
        <div className="flex items-center justify-between">
          {/* Brand Logo */}
          <Link
            to={ROUTES.HOME}
            className="flex items-center gap-3 group focus:outline-none focus:ring-2 focus:ring-[#7A56D6] rounded-lg"
          >
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-[#7A56D6] to-purple-400 p-0.5 shadow-md shadow-[#7A56D6]/40 group-hover:shadow-lg group-hover:shadow-[#7A56D6]/60 transition-all duration-300">
              <div className="w-full h-full bg-black/90 rounded-[10px] flex items-center justify-center">
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-200 to-white font-extrabold text-xl tracking-tighter">
                  TX
                </span>
              </div>
            </div>
            <div className="flex flex-col">
              <span className="font-bold text-lg tracking-tight text-white group-hover:text-purple-300 transition-colors">
                TreadEx<span className="text-[#7A56D6]">Mine</span>
              </span>
              <span className="text-[10px] uppercase tracking-widest text-gray-400 font-medium">
                Cloud Computing
              </span>
            </div>
          </Link>

          {/* Desktop Navigation Links */}
          <nav className="hidden md:flex items-center gap-1 bg-white/[0.03] border border-white/10 px-4 py-1.5 rounded-full backdrop-blur-md">
            {NAV_LINKS.map((link) => (
              <NavLink
                key={link.path}
                to={link.path}
                className={({ isActive }) =>
                  cn(
                    'px-4 py-1.5 rounded-full text-sm font-medium transition-all duration-200',
                    isActive
                      ? 'bg-[#7A56D6] text-white shadow-sm shadow-[#7A56D6]/40'
                      : 'text-gray-300 hover:text-white hover:bg-white/5'
                  )
                }
              >
                {link.name}
              </NavLink>
            ))}
          </nav>

          {/* Desktop Right Action */}
          <div className="hidden md:flex items-center gap-3">
            <Button to={ROUTES.CONTACT} variant="outline" size="sm">
              Contact Us
            </Button>
            <Button to={ROUTES.ABOUT} variant="primary" size="sm">
              Explore Platform
            </Button>
          </div>

          {/* Mobile Menu Toggle Button */}
          <button
            type="button"
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            aria-label="Toggle navigation menu"
            className="md:hidden p-2.5 rounded-xl text-gray-300 hover:text-white hover:bg-white/5 border border-white/10 focus:outline-none focus:ring-2 focus:ring-[#7A56D6]"
          >
            <svg
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              {mobileMenuOpen ? (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              ) : (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 6h16M4 12h16M4 18h16"
                />
              )}
            </svg>
          </button>
        </div>

        {/* Mobile Navigation Drawer */}
        {mobileMenuOpen && (
          <div className="md:hidden mt-4 pt-4 pb-6 px-4 rounded-2xl bg-black/95 border border-purple-900/40 backdrop-blur-xl animate-fadeIn">
            <nav className="flex flex-col gap-2">
              {NAV_LINKS.map((link) => (
                <NavLink
                  key={link.path}
                  to={link.path}
                  className={({ isActive }) =>
                    cn(
                      'px-4 py-3 rounded-xl text-base font-medium transition-all duration-200 flex items-center justify-between',
                      isActive
                        ? 'bg-[#7A56D6] text-white shadow-md shadow-[#7A56D6]/30'
                        : 'text-gray-300 hover:text-white hover:bg-white/5'
                    )
                  }
                >
                  <span>{link.name}</span>
                  <span className="text-xs opacity-60">→</span>
                </NavLink>
              ))}
            </nav>
            <div className="mt-4 pt-4 border-t border-white/10 flex flex-col gap-2.5">
              <Button to={ROUTES.CONTACT} variant="outline" size="md" className="w-full">
                Contact Us
              </Button>
              <Button to={ROUTES.ABOUT} variant="primary" size="md" className="w-full">
                Explore Platform
              </Button>
            </div>
          </div>
        )}
      </Container>
    </header>
  );
}

export default Navbar;
