/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'Manrope', 'IBM Plex Sans', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'IBM Plex Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      colors: {
        // Industrial dark shell
        void: '#07090C',
        abyss: '#0A0E14',
        panel: '#0E141B',
        panel2: '#121A23',
        raised: '#16202B',
        line: '#1D2937',
        line2: '#26333F',
        // text
        txt: '#DCE4ED',
        txt2: '#93A3B4',
        txt3: '#5F7080',
        // semantic
        nav: '#38BDF8',
        navd: '#0EA5E9',
        ok: '#34D399',
        okd: '#10B981',
        warn: '#FBBF24',
        danger: '#F87171',
        dangerd: '#EF4444',
        analysis: '#A78BFA',
        cargo: '#FB923C',
        steel: '#64748B',
      },
      fontSize: {
        '2xs': ['10px', '13px'],
        '3xs': ['9px', '12px'],
      },
      keyframes: {
        pulseDot: { '0%,100%': { opacity: '1' }, '50%': { opacity: '0.35' } },
        sweep: { '0%': { transform: 'translateX(-100%)' }, '100%': { transform: 'translateX(300%)' } },
      },
      animation: {
        pulseDot: 'pulseDot 2.4s ease-in-out infinite',
        sweep: 'sweep 2.6s linear infinite',
      },
    },
  },
  plugins: [],
};
