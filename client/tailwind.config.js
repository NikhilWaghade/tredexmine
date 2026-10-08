/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#7A56D6',
          50: '#f6f4fe',
          100: '#ede9fc',
          200: '#ddd6fa',
          300: '#c4b5f6',
          400: '#a387ee',
          500: '#7A56D6',
          600: '#6842c5',
          700: '#5633a6',
          800: '#462a87',
          900: '#3a246f',
        },
        brand: {
          dark: '#0a0518',
          purple: '#1a0033',
        },
      },
    },
  },
  plugins: [],
}