// "Add account" form logic: the IMAP/SMTP fields, common-provider host
// presets, the host suggestion dropdown, OAuth connect, test-connection, and
// the add-account submit. The account list and edit dialog are separate
// composables.
import { ref } from "vue";
import { useAddAccount } from "../stores/accounts";
import { api } from "../lib/api";
import { t } from "../lib/i18n";

const IMAP_HOSTS = [
  {
    label: "Yahoo",
    imap: "imap.mail.yahoo.com",
    smtp: "smtp.mail.yahoo.com",
    imapPort: 993,
    smtpPort: 465,
    imapSecure: true,
    smtpSecure: true,
  },
  {
    label: "iCloud",
    imap: "imap.mail.me.com",
    smtp: "smtp.mail.me.com",
    imapPort: 993,
    smtpPort: 587,
    imapSecure: true,
    smtpSecure: false,
  },
  {
    label: "Zoho",
    imap: "imap.zoho.com",
    smtp: "smtp.zoho.com",
    imapPort: 993,
    smtpPort: 465,
    imapSecure: true,
    smtpSecure: true,
  },
] as const;

/** Hosts offered when the host boxes are empty or prefix-matched. */
const HOST_OPTIONS = IMAP_HOSTS.map((p) => ({ value: p.imap, provider: p.label }));

const DEFAULT_FORM = {
  name: "",
  email: "",
  displayName: "",
  imapHost: "",
  imapPort: 993,
  imapSecure: true,
  smtpHost: "",
  smtpPort: 465,
  smtpSecure: true,
  username: "",
  password: "",
};

export function useAddAccountForm() {
  const adding = ref(false);
  const testing = ref(false);
  /** Shared message for the form: test-connection result or add-account error. */
  const formMessage = ref<{ ok: boolean; message: string } | null>(null);
  const form = ref({ ...DEFAULT_FORM });
  const showPassword = ref(false);
  const focusedHost = ref<"imap" | "smtp" | null>(null);

  const { mutateAsync: addAccountMutation } = useAddAccount();

  function applyPreset(p: (typeof IMAP_HOSTS)[number]) {
    form.value.imapHost = p.imap;
    form.value.smtpHost = p.smtp;
    form.value.imapPort = p.imapPort;
    form.value.smtpPort = p.smtpPort;
    form.value.imapSecure = p.imapSecure;
    form.value.smtpSecure = p.smtpSecure;
  }

  /** Host-option list shown under a host field (empty or prefix match). */
  function hostOptions(value: string): { value: string; provider: string }[] {
    const v = value.trim().toLowerCase();
    if (!v) return HOST_OPTIONS.map((h) => ({ ...h }));
    return HOST_OPTIONS.filter((h) => h.value.toLowerCase().startsWith(v)).map((h) => ({ ...h }));
  }

  /** True when the box should show the dropdown list (has matches). */
  function showOptions(value: string): boolean {
    const v = value.trim().toLowerCase();
    return v === "" || HOST_OPTIONS.some((h) => h.value.toLowerCase().startsWith(v));
  }

  function connectOAuth(provider: "google" | "microsoft") {
    window.location.href = `/api/oauth/${provider}/start`;
  }

  async function testConnection() {
    testing.value = true;
    formMessage.value = null;
    try {
      const res = await api.testAccount({ provider: "imap", ...form.value });
      formMessage.value = res.ok
        ? { ok: true, message: t("accounts.connectionSuccess") }
        : { ok: false, message: res.message || t("accounts.connectionFailed") };
    } catch {
      formMessage.value = { ok: false, message: t("accounts.connectionFailed") };
    } finally {
      testing.value = false;
    }
  }

  /** Adds the account; returns true on success (so the caller can close the
   *  form). The form resets so the next add starts clean. */
  async function addAccount(): Promise<boolean> {
    adding.value = true;
    formMessage.value = null;
    try {
      await addAccountMutation({ provider: "imap", ...form.value });
      form.value = { ...DEFAULT_FORM };
      // The new account's initial state is 'running' (a sync is enqueued
      // server-side); the add mutation invalidates account state so the poller
      // observes it and switches to the 1s cadence promptly.
      return true;
    } catch (err) {
      formMessage.value = {
        ok: false,
        message: err instanceof Error ? err.message : "Failed to add account",
      };
      return false;
    } finally {
      adding.value = false;
    }
  }

  return {
    IMAP_HOSTS,
    HOST_OPTIONS,
    adding,
    testing,
    formMessage,
    form,
    showPassword,
    focusedHost,
    applyPreset,
    hostOptions,
    showOptions,
    connectOAuth,
    testConnection,
    addAccount,
  };
}
