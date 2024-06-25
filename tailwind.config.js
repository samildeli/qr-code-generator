/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        main: "#ff6800",
        highlight: "#f26300",
      },
    },
    screens: {
      360: "360px",
      412: "412px",
      768: "768px",
      1024: "1024px",
    },
  },
  plugins: [],
};
