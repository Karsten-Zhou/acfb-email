import { createApp } from "vue";
import App from "./App.vue";
import { router } from "./router";
import { startAccountStatePolling } from "./stores/accounts";
import { initLocale } from "./lib/i18n";
import { initTheme } from "./lib/theme";
import "./styles/main.css";

initLocale();
initTheme();

// Live account-state polling (sidebar/settings sync spinners). Started here on
// boot — independent of route changes or HMR — and idempotent.
startAccountStatePolling();

createApp(App).use(router).mount("#app");
