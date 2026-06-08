// PostCSS config — runs Tailwind + Autoprefixer.
// Tailwind's content glob (see tailwind.config.ts) only matches files
// under features/lumina/**, so this has zero impact on the rest of the app.
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
