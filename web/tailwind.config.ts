import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        espresso: "#17120F",
        roast: "#261A15",
        caramel: "#C88B50",
        "caramel-light": "#E0AC76",
        oat: "#F5EFE4",
        porcelain: "#FFF9F1",
        sage: "#8B9B7E",
        coral: "#D86F51",
        success: "#4D9276",
        ink: "#281D18",
      },
      fontFamily: {
        sans: ["var(--font-dm-sans)", "system-ui", "sans-serif"],
        display: ["var(--font-cormorant)", "Georgia", "serif"],
        mono: ["var(--font-space-grotesk)", "ui-monospace", "monospace"],
      },
      boxShadow: {
        ceramic: "0 8px 30px -12px rgba(23, 18, 15, 0.12), 0 1px 3px rgba(23, 18, 15, 0.06)",
        glow: "0 0 40px -10px rgba(200, 139, 80, 0.35)",
      },
    },
  },
  plugins: [],
};

export default config;
