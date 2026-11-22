import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        espresso: "#241710",
        roast: "#493123",
        oat: "#F5EFE5",
        cream: "#F5EFE5",
        porcelain: "#FAF6EF",
        milk: "#E6D5BD",
        caramel: "#BD8755",
        "caramel-light": "#D4A574",
        sage: "#84947A",
        coral: "#B85A42",
        success: "#5B7A5E",
        ink: "#241710",
      },
      fontFamily: {
        sans: ["var(--font-dm-sans)", "system-ui", "sans-serif"],
        display: ["var(--font-cormorant)", "Georgia", "serif"],
        mono: ["var(--font-space-grotesk)", "ui-monospace", "monospace"],
      },
      boxShadow: {
        ceramic: "0 10px 30px -14px rgba(36, 23, 16, 0.12), 0 1px 2px rgba(36, 23, 16, 0.05)",
        elevated: "0 20px 44px -18px rgba(36, 23, 16, 0.2), 0 2px 6px rgba(36, 23, 16, 0.06)",
      },
    },
  },
  plugins: [],
};

export default config;
