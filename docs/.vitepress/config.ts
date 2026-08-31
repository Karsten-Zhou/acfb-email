import { defineConfig } from "vitepress";

// VitePress site config for the ACFB Email documentation.
// Docs: https://vitepress.dev/reference/site-config
export default defineConfig({
  // GitHub Pages hosts project sites under `/<repo>/`; the deploy workflow sets
  // VITEPRESS_BASE so asset/link paths resolve there. Local dev stays at "/".
  base: process.env.VITEPRESS_BASE ?? "/",
  title: "ACFB Email",
  description:
    "ACFB Email — a self-hosted, Cloudflare-based email client for connecting IMAP/SMTP accounts.",
  lang: "en-US",
  lastUpdated: true,
  cleanUrls: true,
  // The local dev URL (http://localhost:5173) is referenced in the docs but is
  // unreachable during a static build, so ignore localhost in the dead-link check.
  ignoreDeadLinks: ["localhost"],
  themeConfig: {
    nav: [
      { text: "Home", link: "/" },
      { text: "Development", link: "/development" },
      { text: "Architecture", link: "/architecture" },
      { text: "Deployment", link: "/deployment" },
      { text: "Security", link: "/security" },
    ],
    sidebar: [
      {
        text: "Documentation",
        items: [
          { text: "Development", link: "/development" },
          { text: "Architecture", link: "/architecture" },
          { text: "Deployment", link: "/deployment" },
          { text: "Security", link: "/security" },
          { text: "Contributing", link: "/contributing" },
        ],
      },
    ],
    outline: { level: [2, 3] },
    socialLinks: [
      {
        icon: "github",
        link: "https://github.com/XiaoSong-CPE/acfb-email-client",
      },
    ],
    footer: {
      message: "ACFB Email — A Cloudflare Based email client.",
      copyright: "Personal project.",
    },
  },
});
