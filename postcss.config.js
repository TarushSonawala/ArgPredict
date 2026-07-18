// PostCSS pipeline: Tailwind generates the utility classes, then Autoprefixer
// adds vendor prefixes for cross-browser CSS compatibility.
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
