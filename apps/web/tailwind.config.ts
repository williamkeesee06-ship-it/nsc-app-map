/**
 * Tailwind config — SCOPED to features/lumina only.
 *
 * Billy 6/8: the rest of the map app uses plain CSS + the brushed-steel
 * theme in src/styles/theme.css. Tailwind is added here ONLY so we can
 * port Lumina components with their className strings intact without
 * leaking utility classes into the rest of the app's bundle.
 *
 * The `content` glob deliberately includes only Lumina files. PurgeCSS
 * (Tailwind v3's built-in) means we ship only the classes Lumina uses.
 */
import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/features/lumina/**/*.{ts,tsx}",
    "./src/features/lumina/**/*.css",
  ],
  // Prefix every utility so we never collide with hand-rolled CSS in the
  // rest of the app. e.g. `lx:bg-steel-base` instead of `bg-steel-base`.
  prefix: "lx-",
  theme: {
    extend: {
      // Bridge Lumina to the map app's brushed-steel design system.
      // These read the CSS vars defined in src/styles/theme.css so a single
      // source of truth keeps both worlds in sync.
      colors: {
        steel: {
          base: "var(--steel-base)",
          light: "var(--steel-base-light)",
          dark: "var(--steel-base-dark)",
        },
        chrome: {
          light: "var(--chrome-trim-light)",
          dark: "var(--chrome-trim-dark)",
        },
        accent: {
          blue: "var(--accent-blue)",
          "blue-soft": "var(--accent-blue-soft)",
          "blue-deep": "var(--accent-blue-deep)",
        },
        // Lumina identity — kept from the standalone app, restyled.
        neon: {
          // Primary orb/halo color in the map-app context.
          DEFAULT: "#1ea7ff",
          glow: "rgba(30,167,255,0.55)",
          rim: "rgba(30,167,255,0.85)",
          // Deep tone for orb shadows / interior gradient.
          deep: "#0084d4",
        },
        ink: {
          900: "#0b1018",
          800: "#121823",
          700: "#1a2230",
        },
      },
      fontFamily: {
        // Reserved for the Lumina logotype only — earned identity cue.
        display: ['"Rajdhani"', "system-ui", "sans-serif"],
        mono: ["ui-monospace", "Consolas", "monospace"],
      },
      boxShadow: {
        "neon-sm": "0 0 8px rgba(30,167,255,0.45)",
        "neon-md": "0 0 14px rgba(30,167,255,0.55), 0 0 28px rgba(30,167,255,0.25)",
        "neon-lg":
          "0 0 18px rgba(30,167,255,0.65), 0 0 40px rgba(30,167,255,0.35), 0 0 80px rgba(30,167,255,0.15)",
      },
      animation: {
        "orb-pulse": "orb-pulse 2.4s ease-in-out infinite",
        "tab-rim": "tab-rim 1.6s linear infinite",
      },
      keyframes: {
        "orb-pulse": {
          "0%, 100%": { boxShadow: "0 0 12px rgba(30,167,255,0.45)" },
          "50%": { boxShadow: "0 0 22px rgba(30,167,255,0.85), 0 0 44px rgba(30,167,255,0.4)" },
        },
        "tab-rim": {
          "0%": { backgroundPosition: "0% 50%" },
          "100%": { backgroundPosition: "200% 50%" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
