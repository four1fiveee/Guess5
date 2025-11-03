/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        primary: "#121d22", // blue from logo (rgba(18,29,34,255))
        accent: "#e97f14",  // orange from logo (rgba(233,127,20,255))
        secondary: "#f1f0e2", // white from logo (rgba(241,240,226,255))
        darkgray: "#23282d", // custom dark gray for incorrect letters
        success: "#22c55e",
        error: "#ef4444"
      }
    }
  },
  plugins: [],
} 