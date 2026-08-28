import { createRouter, createWebHistory } from "vue-router";

export const router = createRouter({
  // HTML5 history: non-API routes are handled by the Workers SPA fallback
  // (assets.not_found_handling = single_page_application), so deep links work
  // without hash fragments. Cloudflare Access gates the whole app at the
  // edge, so the SPA has no login page of its own.
  history: createWebHistory(),
  routes: [
    { path: "/", redirect: "/mail" },
    {
      path: "/mail",
      name: "mailbox",
      component: () => import("../views/MailboxView.vue"),
    },
    {
      // On wide screens this renders inside MailboxView's reading pane
      // (via a nested router-view); on narrow screens it's a standalone page.
      path: "/mail/message/:id",
      name: "message",
      component: () => import("../views/MailboxView.vue"),
      props: true,
    },
    {
      path: "/compose",
      name: "compose",
      component: () => import("../views/ComposeView.vue"),
      props: true,
    },
    {
      path: "/compose/:draftId",
      name: "compose-draft",
      component: () => import("../views/ComposeView.vue"),
      props: true,
    },
    {
      path: "/settings",
      name: "settings",
      component: () => import("../views/SettingsView.vue"),
    },
  ],
});
