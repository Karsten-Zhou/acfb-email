import { createApp } from "vue";
import App from "./App.vue";
import { router } from "./router";
import { authState } from "./stores/auth";
import { setUnauthorizedHandler } from "./lib/api";
import { initLocale } from "./lib/i18n";
import { initTheme } from "./lib/theme";
import "./styles/main.css";

initLocale();
initTheme();

// When the backend answers 401 (session expired / credentials revoked) reset
// auth state and send the user to the login page. Deferred to the next tick
// so it never re-enters a navigation that's currently in flight (the initial
// router guard running bootstrap()).
setUnauthorizedHandler(() => {
  authState.user = null;
  authState.ready = true;
  const current = router.currentRoute.value?.name;
  if (current && current !== "login") {
    void Promise.resolve().then(() => {
      if (router.currentRoute.value.name !== "login" && !authState.user) {
        router.replace({ name: "login" });
      }
    });
  }
});

createApp(App).use(router).mount("#app");
