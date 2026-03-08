import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        f1: {
          red: "#E10600",
          dark: "#15151E",
          surface: "#1A1A26",
          card: "#1E1E2E",
          border: "#2A2A3C",
          muted: "#6B7280",
          text: "#E5E7EB",
        },
        tyre: {
          soft: "#FF3333",
          medium: "#FFC906",
          hard: "#FFFFFF",
          inter: "#39B54A",
          wet: "#0067FF",
        },
      },
    },
  },
  plugins: [],
};

export default config;
