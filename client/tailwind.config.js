/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        display: ['Outfit', 'sans-serif'],
      },
      colors: {
        primary: {
          50: '#f8fafc',
          100: '#f1f5f9',
          200: '#e2e8f0',
          300: '#cbd5e1',
          400: '#94a3b8',
          500: '#64748b', // Slate 500
          600: '#475569',
          700: '#334155',
          800: '#1e293b',
          900: '#0f172a',
          950: '#020617',
        },
        dark: {
          950: '#050505', // Almost pure black
          900: '#09090b', // Zinc 950 base
          800: '#18181b', // Zinc 900
          700: '#27272a', // Zinc 800 inputs
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
