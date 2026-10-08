import { Link } from 'react-router-dom';
import { ROUTES } from '../../constants';
import { Container } from '../common';

export function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="w-full border-t border-purple-900/30 bg-black/60 backdrop-blur-md pt-16 pb-12 mt-auto">
      <Container>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-10 lg:gap-12 pb-12 border-b border-white/5">
          {/* Brand Info */}
          <div className="md:col-span-2 flex flex-col gap-4">
            <Link to={ROUTES.HOME} className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-[#7A56D6] to-purple-400 p-0.5 shadow-md shadow-[#7A56D6]/30">
                <div className="w-full h-full bg-black/90 rounded-[10px] flex items-center justify-center">
                  <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-200 to-white font-extrabold text-lg tracking-tighter">
                    TX
                  </span>
                </div>
              </div>
              <span className="font-bold text-xl tracking-tight text-white">
                TreadEx<span className="text-[#7A56D6]">Mine</span>
              </span>
            </Link>
            <p className="text-gray-400 text-sm max-w-md leading-relaxed">
              Institutional-grade distributed cloud computing and mining infrastructure.
              Engineered with modern architecture, maximum uptime, and robust reliability.
            </p>
            <div className="flex items-center gap-2 mt-2">
              <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-xs text-gray-400 font-medium">
                Infrastructure Status: <span className="text-emerald-400">Operational</span>
              </span>
            </div>
          </div>

          {/* Quick Links */}
          <div className="flex flex-col gap-3">
            <h4 className="text-white text-sm font-semibold uppercase tracking-wider">
              Navigation
            </h4>
            <ul className="flex flex-col gap-2.5 text-sm text-gray-400">
              <li>
                <Link to={ROUTES.HOME} className="hover:text-purple-300 transition-colors">
                  Home
                </Link>
              </li>
              <li>
                <Link to={ROUTES.ABOUT} className="hover:text-purple-300 transition-colors">
                  About Platform
                </Link>
              </li>
              <li>
                <Link to={ROUTES.CONTACT} className="hover:text-purple-300 transition-colors">
                  Contact Support
                </Link>
              </li>
            </ul>
          </div>

          {/* Platform & Governance */}
          <div className="flex flex-col gap-3">
            <h4 className="text-white text-sm font-semibold uppercase tracking-wider">
              Platform
            </h4>
            <ul className="flex flex-col gap-2.5 text-sm text-gray-400">
              <li>
                <span className="text-gray-500 cursor-not-allowed">
                  System Architecture
                </span>
              </li>
              <li>
                <span className="text-gray-500 cursor-not-allowed">
                  Security Standards
                </span>
              </li>
              <li>
                <span className="text-gray-500 cursor-not-allowed">
                  Terms of Service
                </span>
              </li>
              <li>
                <span className="text-gray-500 cursor-not-allowed">
                  Privacy Policy
                </span>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="pt-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-gray-500">
          <p>© {currentYear} TreadExMine Platform. All rights reserved.</p>
          <div className="flex items-center gap-6">
            <span>Enterprise Infrastructure Foundation</span>
            <span>v1.0.0</span>
          </div>
        </div>
      </Container>
    </footer>
  );
}

export default Footer;
