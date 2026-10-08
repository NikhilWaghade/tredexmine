import { ROUTES } from './routes';

export const NAV_LINKS = [
  { name: 'Home', path: ROUTES.HOME },
  { name: 'About', path: ROUTES.ABOUT },
  { name: 'Contact', path: ROUTES.CONTACT },
];

export const FOOTER_LINKS = {
  platform: [
    { name: 'Overview', path: ROUTES.HOME },
    { name: 'About Us', path: ROUTES.ABOUT },
    { name: 'Contact Support', path: ROUTES.CONTACT },
  ],
  company: [
    { name: 'About Platform', path: ROUTES.ABOUT },
    { name: 'Direct Inquiry', path: ROUTES.CONTACT },
  ],
};
