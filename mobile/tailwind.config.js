/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        // Neutral UI palette; each gym's brand colour is applied at runtime as an accent.
        brand: { DEFAULT: "#ea580c", soft: "#fff4ed" },
      },
    },
  },
  plugins: [],
};
