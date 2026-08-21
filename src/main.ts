import { createApp } from "vue";
import App from "./App.vue";
import { router } from "./router";
import { initLocale } from "./lib/i18n";
import { initTheme } from "./lib/theme";
import "./styles/main.css";

initLocale();
initTheme();

createApp(App).use(router).mount("#app");