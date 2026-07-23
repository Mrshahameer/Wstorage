import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Wisko brand-ish neutral palette; tweak freely.
        brand: { DEFAULT: "#2563eb", dark: "#1e40af" },
      },
    },
  },
  plugins: [],
};
export default config;
