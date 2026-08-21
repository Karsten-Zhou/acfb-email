// Minimal i18n for the client (en / de / zh) with an 'auto' (browser) option.
// Exported as a reactive singleton so views can switch live.

import { reactive, computed } from "vue";

export type Locale = "en" | "de" | "zh";
export type LocaleSetting = "auto" | Locale;

export const supportedLocales: Locale[] = ["en", "de", "zh"];

function detectBrowser(): Locale {
  const nav = (navigator.languages && navigator.languages[0]) || navigator.language || "en";
  const lang = nav.toLowerCase();
  if (lang.startsWith("de")) return "de";
  if (lang.startsWith("zh")) return "zh";
  return "en";
}

const dict = {
  en: {
    appName: "Mail",
    loginHeading: "Mail",
    loginTitle: "Your personal email client. Sign in with GitHub to continue.",
    loginCta: "Continue with GitHub",
    loginAllowlist: "Access is restricted to an explicit allowlist. Your mail data never leaves this application.",
    unifiedInbox: "Unified Inbox",
    compose: "Compose",
    syncNow: "Sync now",
    syncing: "Syncing…",
    settings: "Settings",
    noMessages: "No messages here yet.",
    selectToRead: "Select a message to read it",
    markRead: "Mark read",
    delete: "Delete",
    newMessage: "New message",
    saveDraft: "Save draft",
    send: "Send",
    sending: "Sending…",
    discard: "Discard",
    from: "From",
    to: "To",
    cc: "CC",
    bcc: "BCC",
    subject: "Subject",
    plainText: "Plain text",
    html: "HTML",
    emailAccounts: "Email accounts",
    addAccount: "Add account",
    connectGmail: "Gmail",
    connectGmailHint: "Connect via Google OAuth",
    connectOutlook: "Outlook / Microsoft",
    connectOutlookHint: "Connect via Microsoft Graph",
    connect: "Connect",
    imapSection: "IMAP / SMTP account",
    label: "Label",
    email: "Email",
    displayName: "Display name (optional)",
    username: "Username / login",
    password: "Password / app password",
    imapHost: "IMAP host",
    imapTls: "TLS",
    smtpHost: "SMTP host",
    smtpTls: "TLS",
    testConnection: "Test connection",
    testing: "Testing…",
    cancel: "Cancel",
    healthy: "Healthy",
    unavailable: "Unavailable",
    authRequired: "Authentication required",
    syncedOn: "Synced",
    removeAccount: "Remove account",
    signOut: "Sign out",
    theme: "Theme",
    themeLight: "Light",
    themeDark: "Dark",
    themeAuto: "Auto",
    language: "Language",
    languageAuto: "Auto",
    about: "About",
    version: "Version",
    buildTime: "Build time",
    viewSource: "View source on GitHub",
    showOnlyUnread: "Only unread",
    loadOlder: "Load older",
    content: "Message content",
    reply: "Reply",
    star: "Star",
    markUnread: "Mark unread",
    confirmDelete: "Delete?",
    confirmDeleteAccount: "Remove this account? This deletes its synced mail here.",
    confirmDeleteMessages: "Delete the selected messages?",
    ok: "Delete",
    cancelAction: "Cancel",
    oauthNotConfigured: "Not configured — add {name} OAuth credentials to run this.",
    back: "Back",
  },
  de: {
    appName: "Mail",
    loginHeading: "Mail",
    loginTitle: "Dein persönlicher E-Mail-Client. Mit GitHub anmelden, um fortzufahren.",
    loginCta: "Mit GitHub fortfahren",
    loginAllowlist: "Der Zugriff ist auf eine explizite Whitelist beschränkt. Deine E-Mail-Daten verlassen diese Anwendung nie.",
    unifiedInbox: "Unified Inbox",
    compose: "Verfassen",
    syncNow: "Jetzt synchronisieren",
    syncing: "Synchronisiere…",
    settings: "Einstellungen",
    noMessages: "Noch keine Nachrichten.",
    selectToRead: "Wähle eine Nachricht zum Lesen aus",
    markRead: "Als gelesen markieren",
    delete: "Löschen",
    newMessage: "Neue Nachricht",
    saveDraft: "Entwurf speichern",
    send: "Senden",
    sending: "Sende…",
    discard: "Verwerfen",
    from: "Von",
    to: "An",
    cc: "CC",
    bcc: "BCC",
    subject: "Betreff",
    plainText: "Text",
    html: "HTML",
    emailAccounts: "E-Mail-Konten",
    addAccount: "Konto hinzufügen",
    connectGmail: "Gmail",
    connectGmailHint: "Über Google OAuth verbinden",
    connectOutlook: "Outlook / Microsoft",
    connectOutlookHint: "Über Microsoft Graph verbinden",
    connect: "Verbinden",
    imapSection: "IMAP / SMTP-Konto",
    label: "Bezeichnung",
    email: "E-Mail",
    displayName: "Anzeigename (optional)",
    username: "Benutzername / Login",
    password: "Passwort / App-Passwort",
    imapHost: "IMAP-Host",
    imapTls: "TLS",
    smtpHost: "SMTP-Host",
    smtpTls: "TLS",
    testConnection: "Verbindung testen",
    testing: "Teste…",
    cancel: "Abbrechen",
    healthy: "In Ordnung",
    unavailable: "Nicht verfügbar",
    authRequired: "Anmeldung erforderlich",
    syncedOn: "Synchronisiert",
    removeAccount: "Konto entfernen",
    signOut: "Abmelden",
    theme: "Aussehen",
    themeLight: "Hell",
    themeDark: "Dunkel",
    themeAuto: "Auto",
    language: "Sprache",
    languageAuto: "Auto",
    about: "Über",
    version: "Version",
    buildTime: "Build-Zeit",
    viewSource: "Quellcode auf GitHub ansehen",
    showOnlyUnread: "Nur ungelesen",
    loadOlder: "Ältere laden",
    content: "Nachrichteninhalt",
    reply: "Antworten",
    star: "Markieren",
    markUnread: "Als ungelesen",
    confirmDelete: "Löschen?",
    confirmDeleteAccount: "Dieses Konto entfernen? Die synchronisierten E-Mails hier werden gelöscht.",
    confirmDeleteMessages: "Ausgewählte Nachrichten löschen?",
    ok: "Löschen",
    cancelAction: "Abbrechen",
    oauthNotConfigured: "Nicht konfiguriert — füge {name} OAuth-Zugangsdaten hinzu, um dies zu verwenden.",
    back: "Zurück",
  },
  zh: {
    appName: "Mail",
    loginHeading: "Mail",
    loginTitle: "你的个人邮件客户端。使用 GitHub 登录以继续。",
    loginCta: "使用 GitHub 继续",
    loginAllowlist: "访问限于明确的允许名单。你的邮件数据不会离开此应用。",
    unifiedInbox: "统一收件箱",
    compose: "写邮件",
    syncNow: "立即同步",
    syncing: "同步中…",
    settings: "设置",
    noMessages: "这里还没有邮件。",
    selectToRead: "选择一封邮件来阅读",
    markRead: "标记已读",
    delete: "删除",
    newMessage: "新邮件",
    saveDraft: "保存草稿",
    send: "发送",
    sending: "发送中…",
    discard: "丢弃",
    from: "发件人",
    to: "收件人",
    cc: "抄送",
    bcc: "密送",
    subject: "主题",
    plainText: "文本",
    html: "HTML",
    emailAccounts: "邮件账户",
    addAccount: "添加账户",
    connectGmail: "Gmail",
    connectGmailHint: "通过 Google OAuth 连接",
    connectOutlook: "Outlook / Microsoft",
    connectOutlookHint: "通过 Microsoft Graph 连接",
    connect: "连接",
    imapSection: "IMAP / SMTP 账户",
    label: "标签",
    email: "邮箱地址",
    displayName: "显示名称（可选）",
    username: "用户名 / 登录名",
    password: "密码 / 应用密码",
    imapHost: "IMAP 服务器",
    imapTls: "TLS",
    smtpHost: "SMTP 服务器",
    smtpTls: "TLS",
    testConnection: "测试连接",
    testing: "测试中…",
    cancel: "取消",
    healthy: "正常",
    unavailable: "不可用",
    authRequired: "需要重新登录",
    syncedOn: "已同步",
    removeAccount: "移除账户",
    signOut: "退出登录",
    theme: "主题",
    themeLight: "浅色",
    themeDark: "深色",
    themeAuto: "自动",
    language: "语言",
    languageAuto: "自动",
    about: "关于",
    version: "版本",
    buildTime: "构建时间",
    viewSource: "在 GitHub 上查看源码",
    showOnlyUnread: "仅显示未读",
    loadOlder: "加载更早",
    content: "邮件内容",
    reply: "回复",
    star: "标星",
    markUnread: "标为未读",
    confirmDelete: "删除？",
    confirmDeleteAccount: "移除该账户？此处同步的邮件将被删除。",
    confirmDeleteMessages: "删除所选邮件？",
    ok: "删除",
    cancelAction: "取消",
    oauthNotConfigured: "未配置——添加 {name} OAuth 凭据以启用此功能。",
    back: "返回",
  },
} as const;

export type MessageKey = keyof (typeof dict)["en"];

const state = reactive<{
  setting: LocaleSetting;
  locale: Locale;
}>({
  setting: "auto",
  locale: detectBrowser(),
});

/** Set the locale preference ("auto" resolves by browser). */
export function setLocale(setting: LocaleSetting) {
  state.setting = setting;
  state.locale = setting === "auto" ? detectBrowser() : setting;
  localStorage.setItem("ec_locale", setting);
  document.documentElement.lang = state.locale;
}

/** Restore the user's saved preference (or auto) on boot. */
export function initLocale() {
  const saved = (localStorage.getItem("ec_locale") ?? "auto") as LocaleSetting;
  setLocale(saved);
}

export const localeState = computed(() => state);

type Dict = { [K in MessageKey]: string };

function getDict(): Dict {
  return (dict[state.locale] ?? dict.en) as unknown as Dict;
}

/** Translate a key with optional interpolation ({name}). */
export function t(key: MessageKey, params?: Record<string, string>): string {
  let s: string = getDict()[key] ?? dict.en[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, v);
  }
  return s;
}