/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: {
          50:  '#fff1f1',
          100: '#ffe4e4',
          200: '#fecaca',
          300: '#fca5a5',
          400: '#f87171',
          500: '#ee2d33',
          600: '#D2191F',
          700: '#a81318',
          800: '#7f0e12',
          900: '#55090c',
          950: '#360608',
        },
      },
    },
  },
  plugins: [],
}
