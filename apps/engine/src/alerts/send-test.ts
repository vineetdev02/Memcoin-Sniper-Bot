/**
 * `pnpm alerts:test` — prove the Telegram settings work before trusting them
 * with a halt alert.
 *
 *   • token missing → how to get one
 *   • token set, chat id missing → lists the chats that have messaged the bot,
 *     so the id can be copied instead of hunted for
 *   • both set → verifies the token and sends one test message
 */
import { env } from "../config/env.js";
import { testMessage } from "./format.js";
import { TelegramClient, fatalHint, type Outcome } from "./telegram.js";

interface Update {
  message?: { chat: Chat };
  channel_post?: { chat: Chat };
}
interface Chat {
  id: number;
  type: string;
  title?: string;
  username?: string;
  first_name?: string;
}

function fail(out: Outcome, what: string): never {
  const reason = "reason" in out ? out.reason : out.kind;
  console.error(`✗ ${what}: ${reason}`);
  if (out.kind === "fatal") console.error(`  ${fatalHint(reason)}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const token = env.TELEGRAM_BOT_TOKEN.trim();
  const chatId = env.TELEGRAM_CHAT_ID.trim();

  if (!token) {
    console.error("✗ TELEGRAM_BOT_TOKEN is empty.");
    console.error("  1. Open Telegram, message @BotFather, send /newbot, copy the token.");
    console.error("  2. Put it in .env as TELEGRAM_BOT_TOKEN=... and run this again.");
    process.exit(1);
  }

  const client = new TelegramClient({ token, chatId });
  const me = await client.getMe();
  if (me.kind !== "ok") fail(me, "token check failed");
  const username = (me.result as { username?: string }).username;
  console.log(`✓ token works — bot is @${username}`);

  if (!chatId) {
    const updates = await client.getUpdates();
    if (updates.kind !== "ok") fail(updates, "could not read the bot's messages");
    const chats = new Map<number, Chat>();
    for (const u of updates.result as Update[]) {
      const chat = u.message?.chat ?? u.channel_post?.chat;
      if (chat) chats.set(chat.id, chat);
    }
    if (chats.size === 0) {
      console.error(`✗ TELEGRAM_CHAT_ID is empty, and nobody has messaged @${username} yet.`);
      console.error(`  Open https://t.me/${username}, press Start (or add the bot to a group and say hi), then run this again.`);
      process.exit(1);
    }
    console.log("TELEGRAM_CHAT_ID is empty. Chats that have messaged the bot:");
    for (const c of chats.values()) {
      const name = c.title ?? c.username ?? c.first_name ?? "";
      console.log(`  ${String(c.id).padEnd(16)} ${c.type.padEnd(11)} ${name}`);
    }
    console.log("Copy one into .env as TELEGRAM_CHAT_ID=... and run this again.");
    process.exit(1);
  }

  const sent = await client.sendMessage(testMessage(env.MODE), { html: true });
  if (sent.kind === "migrated") {
    console.error(`✗ this group was upgraded to a supergroup. Set TELEGRAM_CHAT_ID=${sent.chatId} and run this again.`);
    process.exit(1);
  }
  if (sent.kind !== "ok") fail(sent, "test message failed");
  console.log(`✓ test message sent to chat ${chatId} — alerts are ready.`);
}

void main();
