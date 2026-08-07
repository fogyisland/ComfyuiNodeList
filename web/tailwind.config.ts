import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        canvas: 'var(--bg-canvas)',
        surface: 'var(--bg-surface)',
        subtle: 'var(--bg-subtle)',
        border: {
          default: 'var(--border-default)',
          strong: 'var(--border-strong)',
        },
        fg: {
          primary: 'var(--fg-primary)',
          secondary: 'var(--fg-secondary)',
          tertiary: 'var(--fg-tertiary)',
        },
        brand: {
          50: 'var(--brand-50)',
          100: 'var(--brand-100)',
          400: 'var(--brand-400)',
          500: 'var(--brand-500)',
          600: 'var(--brand-600)',
        },
        accent: 'var(--accent-cyan)',
        success: 'var(--success)',
        warning: 'var(--warning)',
        danger: 'var(--danger)',
        tint: {
          success: 'var(--bg-success)',
          warning: 'var(--bg-warning)',
          danger: 'var(--bg-danger)',
          info: 'var(--bg-info)',
        },
      },
      backgroundImage: {
        'gradient-brand': 'var(--gradient-brand)',
      },
      boxShadow: {
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
      },
      fontFamily: {
        sans: ['var(--font-inter)'],
        mono: ['var(--font-jbmono)'],
      },
      borderRadius: {
        xs: 'var(--radius-xs)',
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
        pill: 'var(--radius-pill)',
      },
      fontSize: {
        'display-2xl': ['4.5rem', { lineHeight: '1.05', fontWeight: '700', letterSpacing: '-0.03em' }],
        'display-xl':  ['3.5rem', { lineHeight: '1.1',  fontWeight: '700', letterSpacing: '-0.025em' }],
        'display-lg':  ['2.5rem', { lineHeight: '1.15', fontWeight: '700', letterSpacing: '-0.02em' }],
        'display-md':  ['2rem',   { lineHeight: '1.2',  fontWeight: '600', letterSpacing: '-0.015em' }],
        'display-sm':  ['1.5rem', { lineHeight: '1.3',  fontWeight: '600', letterSpacing: '-0.01em' }],
        'lg':          ['1.125rem', { lineHeight: '1.55', fontWeight: '500' }],
        'base':        ['1rem',   { lineHeight: '1.6',  fontWeight: '400' }],
        'sm':          ['0.875rem', { lineHeight: '1.5', fontWeight: '400' }],
        'xs':          ['0.75rem',  { lineHeight: '1.45', fontWeight: '500' }],
        '2xs':         ['0.6875rem', { lineHeight: '1.4', fontWeight: '600' }],
      },
      maxWidth: {
        '6xl': '1152px',
      },
    },
  },
  plugins: [],
};

export default config;
