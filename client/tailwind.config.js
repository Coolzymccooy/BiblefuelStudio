/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'ui-sans-serif', 'system-ui'],
        display: ['Sora', 'ui-sans-serif', 'system-ui'],
      },
      colors: {
        primary: {
          50: '#fbf7ef',
          100: '#f3ead6',
          200: '#e3d3a8',
          300: '#d2bb7c',
          400: '#c1a257',
          500: '#b08d57',
          600: '#9a7a4b',
          700: '#7f633d',
          800: '#5f4a2d',
          900: '#3f3120',
          950: '#241b11',
        },
        dark: {
          950: '#050505',
          900: '#0b0c0e',
          800: '#121417',
          700: '#1a1d21',
        },
        glass: {
          100: 'rgba(255, 255, 255, 0.03)',
          200: 'rgba(255, 255, 255, 0.05)',
          300: 'rgba(255, 255, 255, 0.08)',
          dark: 'rgba(0, 0, 0, 0.8)',
        }
      },
      backgroundImage: {
        'space-gradient': 'linear-gradient(to bottom right, #000000, #09090b)', // Pure Black to Micaceous Iron Oxide
        'glow-primary': 'radial-gradient(circle at center, rgba(255, 255, 255, 0.03) 0%, transparent 70%)',
      },
      boxShadow: {
        'soft': '0 2px 8px rgba(0, 0, 0, 0.2)',
        'medium': '0 4px 16px rgba(0, 0, 0, 0.4)',
        'neon': 'none', // Removed neon for maturity
      },
      borderRadius: {
        'card': '8px', // Sharper, more professional
      },
      animation: {
        'fade-in': 'fadeIn 0.5s ease-out',
        'slide-up': 'slideUp 0.5s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(20px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
      },
    },
  },
  plugins: [],
}
