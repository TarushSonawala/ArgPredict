// Tailwind CSS configuration. `content` tells Tailwind which files to scan
// for class names so unused styles can be purged from the production build.
// The default theme is used as-is — all custom colours/fonts for this project
// live in the TOKENS object in ARGpredict.jsx rather than the Tailwind theme.
/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: { extend: {} },
  plugins: [],
};
