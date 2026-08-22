// Auth store: current user, login state, bootstrap (reactive singleton).
import { reactive } from "vue";
import { api } from "../lib/api";
import type { User } from "@shared/types";

interface AuthState {
  user: User | null;
  ready: boolean;
  error: string | null;
}

export const authState = reactive<AuthState>({
  user: null,
  ready: false,
  error: null,
});

export async function bootstrap() {
  if (authState.ready) return;
  try {
    const { user } = await api.me();
    authState.user = user;
  } catch {
    authState.user = null;
  }
  authState.ready = true;
}

export async function logout() {
  try {
    await api.logout();
  } finally {
    authState.user = null;
  }
}
