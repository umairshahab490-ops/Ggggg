/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        onenote: {
          purple: '#681498',
          purpleDark: '#520f78',
          purpleLight: '#7b1fa2',
          accent: '#7719aa',
          surface: '#f3f2f1',
          nav: '#efeae7',
        },
      },
      fontFamily: {
        sans: [
          'Segoe UI',
          'Segoe UI Variable',
          '-apple-system',
          'BlinkMacSystemFont',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
      },
      boxShadow: {
        panel: '0 1px 3px rgba(0, 0, 0, 0.12), 0 1px 2px rgba(0, 0, 0, 0.08)',
      },
    },
  },
  plugins: [],
};
