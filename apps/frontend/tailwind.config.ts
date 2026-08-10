import type { Config } from 'tailwindcss';

/**
 * Tailwind CSS v4 — CSS-first config.
 * Token values are defined in design-system/tokens.css as CSS custom properties.
 * This file maps tokens → Tailwind utility classes for editor autocomplete.
 */
const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Brand — map to CSS tokens so changing tokens auto-updates Tailwind classes
        brand: {
          50:  'var(--primitive-brand-50)',
          100: 'var(--primitive-brand-100)',
          200: 'var(--primitive-brand-200)',
          500: 'var(--primitive-brand-500)',
          600: 'var(--primitive-brand-600)',
          700: 'var(--primitive-brand-700)',
          800: 'var(--primitive-brand-800)',
        },
        // Semantic surface colors
        surface:  'var(--color-bg-surface)',
        base:     'var(--color-bg-base)',
        subtle:   'var(--color-bg-subtle)',
        // Semantic text
        primary:   'var(--color-text-primary)',
        secondary: 'var(--color-text-secondary)',
        muted:     'var(--color-text-muted)',
        // State
        error:   'var(--primitive-error-600)',
        success: 'var(--primitive-success-600)',
        warning: 'var(--primitive-warning-600)',
      },
      borderRadius: {
        sm:   'var(--radius-sm)',
        md:   'var(--radius-md)',
        lg:   'var(--radius-lg)',
        xl:   'var(--radius-xl)',
        '2xl': 'var(--radius-2xl)',
        full: 'var(--radius-full)',
      },
      boxShadow: {
        xs:   'var(--shadow-xs)',
        sm:   'var(--shadow-sm)',
        md:   'var(--shadow-md)',
        lg:   'var(--shadow-lg)',
        xl:   'var(--shadow-xl)',
        auth: 'var(--shadow-auth)',
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
        mono: ['var(--font-mono)'],
      },
      fontSize: {
        xs:   ['var(--text-xs)',   { lineHeight: 'var(--leading-normal)' }],
        sm:   ['var(--text-sm)',   { lineHeight: 'var(--leading-normal)' }],
        base: ['var(--text-base)', { lineHeight: 'var(--leading-normal)' }],
        lg:   ['var(--text-lg)',   { lineHeight: 'var(--leading-snug)' }],
        xl:   ['var(--text-xl)',   { lineHeight: 'var(--leading-snug)' }],
        '2xl': ['var(--text-2xl)', { lineHeight: 'var(--leading-tight)' }],
        '3xl': ['var(--text-3xl)', { lineHeight: 'var(--leading-tight)' }],
        '4xl': ['var(--text-4xl)', { lineHeight: 'var(--leading-tight)' }],
      },
      spacing: {
        0.5:  'var(--space-0-5)',
        1:    'var(--space-1)',
        1.5:  'var(--space-1-5)',
        2:    'var(--space-2)',
        2.5:  'var(--space-2-5)',
        3:    'var(--space-3)',
        3.5:  'var(--space-3-5)',
        4:    'var(--space-4)',
        5:    'var(--space-5)',
        6:    'var(--space-6)',
        7:    'var(--space-7)',
        8:    'var(--space-8)',
        10:   'var(--space-10)',
        12:   'var(--space-12)',
        14:   'var(--space-14)',
        16:   'var(--space-16)',
        20:   'var(--space-20)',
        24:   'var(--space-24)',
      },
      transitionDuration: {
        fast:   'var(--duration-fast)',
        normal: 'var(--duration-normal)',
        slow:   'var(--duration-slow)',
      },
      transitionTimingFunction: {
        default: 'var(--ease-default)',
        spring:  'var(--ease-spring)',
      },
      animation: {
        'spin-slow': 'spin 1.5s linear infinite',
        'fade-in':   'fadeIn var(--duration-normal) var(--ease-out)',
        'slide-up':  'slideUp var(--duration-slow) var(--ease-spring)',
        'shake':     'shake 400ms var(--ease-default)',
      },
      keyframes: {
        fadeIn: {
          from: { opacity: '0' },
          to:   { opacity: '1' },
        },
        slideUp: {
          from: { opacity: '0', transform: 'translateY(12px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        shake: {
          '0%, 100%': { transform: 'translateX(0)' },
          '20%':      { transform: 'translateX(-6px)' },
          '40%':      { transform: 'translateX(6px)' },
          '60%':      { transform: 'translateX(-4px)' },
          '80%':      { transform: 'translateX(4px)' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
