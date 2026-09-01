// Generate a Web Push VAPID key pair. Prints the values to set as Cloudflare
// secrets (see docs/deployment.md). Run: bun run vapid:generate
import webpush from "web-push";

const keys = webpush.generateVAPIDKeys();

console.log("VAPID_PUBLIC_KEY=" + keys.publicKey);
console.log("VAPID_PRIVATE_KEY=" + keys.privateKey);
console.log("VAPID_SUBJECT=mailto:you@example.com");
console.log("");
console.log("Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY as Cloudflare secrets:");
console.log("  wrangler secret put VAPID_PUBLIC_KEY");
console.log("  wrangler secret put VAPID_PRIVATE_KEY");
console.log("Or for local dev, add them to .env");
