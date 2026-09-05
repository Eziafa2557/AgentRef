import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        base: {
          950: "#05060f",
          900: "#090b18",
          850: "#0c0f22",
          800: "#11142c",
          700: "#181c3d",
        },
        panel: {
          DEFAULT: "#0d1024",
          hi: "#12162e",
        },
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        display: ["ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      boxShadow: {
        glow: "0 0 26px rgba(167,139,250,0.28)",
        "glow-cyan": "0 0 26px rgba(34,211,238,0.22)",
        "glow-pass": "0 0 28px rgba(52,211,153,0.3)",
        "glow-fail": "0 0 28px rgba(244,63,94,0.32)",
        card: "0 12px 34px -14px rgba(0,0,0,0.6)",
      },
      backgroundImage: {
        aurora:
          "radial-gradient(46rem 32rem at 108% -12%, rgba(139,92,246,0.20), transparent 58%), radial-gradient(40rem 30rem at -18% 8%, rgba(34,211,238,0.14), transparent 55%), radial-gradient(30rem 26rem at 50% 120%, rgba(236,72,153,0.10), transparent 60%)",
        "pass-mesh": "radial-gradient(24rem 18rem at 100% 0%, rgba(52,211,153,0.18), transparent 60%)",
        "fail-mesh": "radial-gradient(24rem 18rem at 100% 0%, rgba(244,63,94,0.2), transparent 60%)",
      },
      keyframes: {
        "slide-in": {
          "0%": { opacity: "0", transform: "translateY(12px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "pulse-soft": {
          "0%,100%": { opacity: "1" },
          "50%": { opacity: "0.45" },
        },
        "node-ping": {
          "0%": { transform: "scale(0.9)", opacity: "0.7" },
          "80%,100%": { transform: "scale(2.2)", opacity: "0" },
        },
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
      },
      animation: {
        "slide-in": "slide-in 0.4s cubic-bezier(0.16,1,0.3,1) both",
        "fade-in": "fade-in 0.5s ease both",
        "pulse-soft": "pulse-soft 2.2s ease-in-out infinite",
        shimmer: "shimmer 1.4s infinite",
      },
    },
  },
  plugins: [],
};

export default config;
