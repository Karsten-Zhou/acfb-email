import { createApp } from "vue";
import { VueQueryPlugin } from "@tanstack/vue-query";
import App from "./App.vue";
import { router } from "./router";
import { queryClient } from "./lib/query";
import { initLocale } from "./lib/i18n";
import { initTheme } from "./lib/theme";
import "./styles/main.css";

initLocale();
initTheme();

// Live account-state polling is a TanStack Query (useAccountStates) — it mounts
// with whichever view renders accounts/sidebar, so no manual boot-time start.
createApp(App).use(router).use(VueQueryPlugin, { queryClient }).mount("#app");
