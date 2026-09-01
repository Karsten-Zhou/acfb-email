import { defineConfig } from "vitepress";
import { readFileSync } from "node:fs";
import { URL } from "node:url";

// Single source of truth for the repo URL is package.json#homepage.
const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf-8"));
const repoName = new URL(pkg.homepage).pathname.split("/").filter(Boolean).pop();

// VitePress site config for the ACFB Email documentation.
// Docs: https://vitepress.dev/reference/site-config
export default defineConfig({
  // GitHub Pages hosts project sites under `/<repo>/`; the deploy workflow sets
  // VITEPRESS_BASE so asset/link paths resolve there. Local dev stays at "/".
  base: `/${repoName}/`,
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
      { text: "Contributing", link: "/contributing" },
      { text: "Architecture", link: "/architecture" },
      { text: "Deployment", link: "/deployment" },
    ],
    sidebar: [
      {
        text: "Documentation",
        items: [
          { text: "Contributing", link: "/contributing" },
          { text: "Architecture", link: "/architecture" },
          { text: "Deployment", link: "/deployment" },
          { text: "Security", link: "/security" },
          { text: "Changelog", link: "/CHANGELOG" },
        ],
      },
    ],
    outline: { level: [2, 3] },
    socialLinks: [
      {
        icon: "github",
        link: pkg.homepage,
      },
    ],
    footer: {
      message: "ACFB Email — A Cloudflare Based email client.",
      copyright: "Personal project.",
    },
  },
});
