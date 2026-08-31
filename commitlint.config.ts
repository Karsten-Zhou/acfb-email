import type { UserConfig } from "@commitlint/types";

// Commitlint configuration — enforces Conventional Commits.
// Rules: https://github.com/conventional-changelog/commitlint
const config: UserConfig = {
  extends: ["@commitlint/config-conventional"],
};

export default config;
