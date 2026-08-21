/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        // Quiet-studio identity: Instrument Sans for UI/body, Cormorant Garamond
        // for display serif titles, JetBrains Mono for IDs/durations/dB/filenames.
        sans: ['"Instrument Sans"', 'Inter', '"IBM Plex Sans"', 'ui-sans-serif', 'system-ui'],
        display: ['"Instrument Sans"', 'Inter', 'ui-sans-serif', 'system-ui'],
        displaySerif: ['"Cormorant Garamond"', 'Georgia', 'serif'],
        bodyserif: ['"Cormorant Garamond"', 'Georgia', 'serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      colors: {
        // Tailwind's default gray scale, routed through CSS variables.
        // 387 hardcoded text-gray-*/text-white usages across 49 files were
        // baked to DARK-mode values, so on a light background headings, field
        // labels and card titles rendered pale-on-white and vanished.
        // In light mode the scale INVERTS: gray-100..300 are heading/label
        // colours, so they become near-black. Every light value is >= 4.5:1 on
        // white. Fallbacks are Tailwind's originals.
        gray: {
          100: 'var(--g-100, #f3f4f6)',
          200: 'var(--g-200, #e5e7eb)',
          300: 'var(--g-300, #d1d5db)',
          400: 'var(--g-400, #9ca3af)',
          500: 'var(--g-500, #6b7280)',
          600: 'var(--g-600, #4b5563)',
          700: 'var(--g-700, #374151)',
          800: 'var(--g-800, #1f2937)',
          900: 'var(--g-900, #111827)',
        },
        // NOTE: `white` is deliberately NOT overridden. Making it a CSS variable
        // breaks Tailwind's opacity modifiers (bg-white/10, via-white/10 …),
        // which cannot alpha-composite a var(). The ~112 `text-white` usages
        // are handled by a targeted rule in index.css instead.
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
        // Warm near-black surfaces (quiet-studio). Remapped from the old cool
        // greys so every existing `bg-dark-*` shifts to the new identity.
        dark: {
          950: '#080604',
          900: '#0b0906',
          800: '#140f09',
          700: '#17130c',
        },
        // Quiet-studio tokens, resolved through CSS variables so a single
        // `data-theme` attribute repaints all ~150 usages at once. Hardcoding
        // the hex values here baked the dark theme into every component, which
        // is why light mode rendered cream text on cream cards.
        //
        // The fallbacks are the original dark values, so anything rendering
        // before the variables load still looks correct.
        bf: {
          bg: 'var(--bf-bg, #0b0906)',
          bg2: 'var(--bf-bg2, #080604)',
          card: 'var(--bf-card, #140f09)',
          card2: 'var(--bf-card2, #17130c)',
          input: 'var(--bf-input, #161009)',
          input2: 'var(--bf-input2, #0f0b07)',
          gold: 'var(--bf-gold, #e6c98a)',
          goldDeep: 'var(--bf-goldDeep, #cba85f)',
          goldDim: 'var(--bf-goldDim, #a8894f)',
          cream: 'var(--bf-cream, #f4ecdc)',
          cream2: 'var(--bf-cream2, #f0e6d3)',
          sub: 'var(--bf-sub, #b7ac97)',
          sub2: 'var(--bf-sub2, #a99f8b)',
          muted: 'var(--bf-muted, #8a7f6b)',
          faint: 'var(--bf-faint, #6f6654)',
          success: 'var(--bf-success, #6fcf97)',
          danger: 'var(--bf-danger, #e08a8a)',
        },
        glass: {
          100: 'rgba(255, 255, 255, 0.03)',
          200: 'rgba(255, 255, 255, 0.05)',
          300: 'rgba(255, 255, 255, 0.08)',
          dark: 'rgba(0, 0, 0, 0.8)',
        },
        editorial: {
          paper: '#faf6ee',
          parchment: '#f1e9d6',
          dark: '#2a2620',
          canvas: '#0e0a06',
          ink: '#1a1610',
          body: '#4a4239',
          muted: '#5a5147',
          gold: '#a08760',
          goldDeep: '#6b4f1f',
          goldLite: '#d4af6e',
          cream: '#f4ead8',
          hairline: '#e8ddc4',
        },
        content: {
          secondary: 'var(--content-secondary)',
          tertiary: 'var(--content-tertiary)',
        },
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
        'card': '16px', // quiet-studio cards 16–22px
        'bf': '18px',
        'bf-lg': '22px',
      },
      animation: {
        'fade-in': 'fadeIn 0.5s ease-out',
        'slide-up': 'slideUp 0.5s ease-out',
        'bffade': 'bffade 0.45s ease both',
        'bfbars': 'bfbars 0.8s ease-in-out infinite',
        'bfpulse': 'bfpulse 2s ease-in-out infinite',
        'bfspin': 'bfspin 0.9s linear infinite',
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
        // Quiet-studio screen entrance + micro-motions from the handoff.
        bffade: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'none' },
        },
        bfbars: {
          '0%,100%': { transform: 'scaleY(0.3)' },
          '50%': { transform: 'scaleY(1)' },
        },
        bfpulse: {
          '0%,100%': { opacity: '0.45' },
          '50%': { opacity: '1' },
        },
        bfspin: {
          to: { transform: 'rotate(360deg)' },
        },
      },
    },
  },
  plugins: [],
}
