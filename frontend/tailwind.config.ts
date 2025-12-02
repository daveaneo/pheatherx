import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Primary
        'phoenix-ember': '#FF6A3D',
        'feather-gold': '#F0C27B',
        'obsidian-black': '#0A0A0F',
        'ash-gray': '#1C1E26',

        // Secondary
        'iridescent-violet': '#6B5BFF',
        'deep-magenta': '#D6246E',
        'electric-teal': '#19C9A0',

        // Neutral
        'carbon-gray': '#2B2D36',
        'feather-white': '#F9F7F1',
      },

      backgroundImage: {
        'flame-gradient':
          'linear-gradient(135deg, #FF6A3D 0%, #D6246E 50%, #6B5BFF 100%)',
        'feather-gradient':
          'linear-gradient(90deg, #F0C27B 0%, #19C9A0 100%)',
        'obsidian-gradient':
          'linear-gradient(180deg, #0A0A0F 0%, #1C1E26 100%)',
      },

      fontFamily: {
        heading: ['var(--font-inter-tight)', 'Inter Tight', 'sans-serif'],
        body: ['var(--font-satoshi)', 'Satoshi', 'sans-serif'],
        mono: ['var(--font-ibm-plex-mono)', 'IBM Plex Mono', 'monospace'],
        display: ['var(--font-neue-machina)', 'Neue Machina', 'sans-serif'],
      },

      fontSize: {
        'display-1': ['4rem', { lineHeight: '1.1', fontWeight: '700' }],
        'display-2': ['3rem', { lineHeight: '1.15', fontWeight: '700' }],
        'heading-1': ['2.5rem', { lineHeight: '1.2', fontWeight: '700' }],
        'heading-2': ['2rem', { lineHeight: '1.25', fontWeight: '600' }],
        'heading-3': ['1.5rem', { lineHeight: '1.3', fontWeight: '600' }],
        'heading-4': ['1.25rem', { lineHeight: '1.4', fontWeight: '500' }],
      },

      borderRadius: {
        DEFAULT: '12px',
        lg: '16px',
        xl: '20px',
        '2xl': '24px',
      },

      boxShadow: {
        'ember-glow': '0 0 20px rgba(255, 106, 61, 0.3)',
        'ember-glow-sm': '0 0 10px rgba(255, 106, 61, 0.2)',
        card: '0 4px 24px rgba(0, 0, 0, 0.2)',
        'card-hover': '0 8px 32px rgba(0, 0, 0, 0.3)',
      },

      animation: {
        shimmer: 'shimmer 2s ease infinite',
        'pulse-ember': 'pulse-ember 1.5s ease-in-out infinite',
        float: 'float 3s ease-in-out infinite',
        'fade-in': 'fadeIn 0.3s ease',
        'slide-up': 'slideUp 0.3s ease',
        'slide-down': 'slideDown 0.3s ease',
      },

      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
          '100%': { backgroundPosition: '0% 50%' },
        },
        'pulse-ember': {
          '0%, 100%': { boxShadow: '0 0 8px rgba(255, 106, 61, 0.4)' },
          '50%': { boxShadow: '0 0 20px rgba(255, 106, 61, 0.6)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-3px)' },
        },
        fadeIn: {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        slideUp: {
          from: { transform: 'translateY(10px)', opacity: '0' },
          to: { transform: 'translateY(0)', opacity: '1' },
        },
        slideDown: {
          from: { transform: 'translateY(-10px)', opacity: '0' },
          to: { transform: 'translateY(0)', opacity: '1' },
        },
      },

      transitionDuration: {
        DEFAULT: '200ms',
      },
    },
  },
  plugins: [],
};

export default config;
