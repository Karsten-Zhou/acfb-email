import { createRouter, createWebHashHistory } from "vue-router";
import { authState, bootstrap } from "../stores/auth";

export const router = createRouter({
  // Hash history so deep links work on the Workers SPA (no server rewrites).
  history: createWebHashHistory(),
  routes: [
    { path: "/", redirect: "/mail" },
    {
      path: "/login",
      name: "login",
      component: () => import("../views/LoginView.vue"),
    },
    {
      path: "/mail",
      name: "mailbox",
      component: () => import("../views/MailboxView.vue"),
    },
    {
      path: "/mail/message/:id",
      name: "message",
      component: () => import("../views/MessageView.vue"),
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

// Global auth guard.
router.beforeEach(async (to) => {
  if (!authState.ready) {
    await bootstrap();
  }
  if (to.name !== "login" && !authState.user) {
    return { name: "login" };
  }
  if (to.name === "login" && authState.user) {
    return { name: "mailbox" };
  }
});