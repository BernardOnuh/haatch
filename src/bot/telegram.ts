import path from "node:path";
import { Bot, InlineKeyboard, InputFile, InputMediaBuilder } from "grammy";
import { env, paths, payment } from "../config.js";
import { CATALOG, formatAtomic, isTaskType, listedServices, toAtomic, type TaskType } from "../catalog.js";
import { chats, taskMessages, tasks, type Task } from "../db/db.js";
import type { Notifier } from "../orchestrator/orchestrator.js";
import type { AgentRunner } from "../workers/runner.js";
import { demoPayer } from "../payments/demo-payer.js";
import type { StoredResult } from "../workers/result-schema.js";

const BRIEF_TEMPLATE = `Send your brief in one message. Include:
• Project name + what it does (and which chain)
• What you're announcing — launch, mainnet, mint, feature, event
• Key facts: dates, numbers, ticker, URL / X handle
• Who it's for — degens, DeFi users, builders, mainstream users
• Vibe / projects you admire (we won't copy them)
• Anything to avoid`;

const STATUS_LABEL: Record<Task["status"], string> = {
  quoted: "⏳ awaiting payment",
  settling: "🔄 confirming payment",
  paid: "✅ paid · queued",
  running: "🤖 agent working",
  completed: "📦 finishing up",
  delivered: "✅ delivered",
  failed: "⚠️ failed",
};

const receipt = (t: Task) =>
  t.tx_hash
    ? `Receipt: ${formatAtomic(t.price_atomic)} ${payment.symbol} · ${payment.network}\n${payment.explorer}/tx/${t.tx_hash}`
    : "";

const payUrl = (t: Task) => `${env.PUBLIC_URL}/pay/${t.id}?t=${t.pay_token}`;

const menu = () => {
  const kb = new InlineKeyboard();
  for (const [type, s] of listedServices()) kb.text(`${s.title} · ${s.price} ${payment.symbol}`, `svc:${type}`).row();
  return kb;
};

const trialsLeft = (userId: number) => Math.max(0, env.FREE_TRIAL_TASKS - tasks.trialsUsed(userId));

const REVISION_HINT = `↩️ Reply to this file to request changes (${env.FREE_REVISIONS} free revisions).`;

/**
 * Sends a deliverable (summary + .md file) and remembers both message IDs, so a Telegram
 * reply to either one is routed back to this task as a revision request.
 */
async function sendDeliverable(api: Bot["api"], task: Task, result: StoredResult, caption: string) {
  const version = task.revisions ? `-v${task.revisions + 1}` : "";
  const md = new InputFile(Buffer.from(result.deliverable_markdown, "utf8"), `${task.type}-${task.id.slice(0, 8)}${version}.md`);
  const file = (f: string) => new InputFile(path.join(paths.assets, f), path.basename(f));
  const rendered = result.rendered ?? [];
  const images = rendered.filter((a) => a.kind === "image");
  const videos = rendered.filter((a) => a.kind === "video");
  const extras = [
    result.assumptions.length ? `\nAssumptions:\n${result.assumptions.map((a) => `• ${a}`).join("\n")}` : "",
    result.follow_up_questions.length ? `\nTo sharpen v2:\n${result.follow_up_questions.map((q) => `• ${q}`).join("\n")}` : "",
  ].join("");
  const sent: { message_id: number }[] = [];
  sent.push(await api.sendMessage(task.chat_id, `📦 ${result.title}\n\n${result.summary}${extras}`.slice(0, 4000)));

  // Inline previews (Telegram compresses photos), then playable videos.
  if (images.length === 1) sent.push(await api.sendPhoto(task.chat_id, file(images[0].file)));
  if (images.length > 1) sent.push(...(await api.sendMediaGroup(task.chat_id, images.map((a) => InputMediaBuilder.photo(file(a.file))))));
  for (const v of videos) {
    sent.push(await api.sendVideo(task.chat_id, file(v.file), { width: v.width, height: v.height, supports_streaming: true }));
  }

  // Full-resolution PNGs + the written deliverable as files; caption goes on the last item.
  const docs = [...images.map((a) => InputMediaBuilder.document(file(a.file))), InputMediaBuilder.document(md, { caption: caption.slice(0, 1024) })];
  if (docs.length === 1) sent.push(await api.sendDocument(task.chat_id, md, { caption: caption.slice(0, 1024) }));
  else sent.push(...(await api.sendMediaGroup(task.chat_id, docs)));

  // Logo tasks also ship the vector master.
  if (result.logo_svg) {
    const svg = result.logo_svg
      .replace(/<script[\s\S]*?<\/script\s*>/gi, "")
      .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, "");
    sent.push(
      await api.sendDocument(task.chat_id, new InputFile(Buffer.from(svg, "utf8"), `logo-${task.id.slice(0, 8)}${version}.svg`), {
        caption: "Vector logo (SVG): scales to any size; open in Figma, Illustrator, or a browser.",
      }),
    );
  }

  for (const m of sent) taskMessages.link(task.chat_id, m.message_id, task.id);
}

/** Facts about the platform and this founder, given to the chat agent as a system note each turn. */
function platformContext(platformName: string, chatId: number, userId: number): string {
  const recent = tasks.listByChat(chatId, 5);
  const trial = trialsLeft(userId);
  return [
    "PLATFORM CONTEXT (provided by the system; this is accurate):",
    `Platform name: ${platformName}`,
    `Payment: per task in ${payment.symbol} on Celo via x402 — gasless, no subscription. Ordering: the founder taps /new.`,
    `Free trial: ${trial > 0 ? `this founder has ${trial} free task(s) left.` : "this founder has used their free trial."}`,
    `Revisions: reply to a delivered file in Telegram; ${env.FREE_REVISIONS} free revisions per task.`,
    "Services:",
    ...listedServices().map(([, s]) => `- ${s.title} — ${s.price} ${payment.symbol}: ${s.deliverable}`),
    "Founder's recent tasks:",
    ...(recent.length
      ? recent.map((t) => `- ${CATALOG[t.type].title} — ${t.status} (id ${t.id.slice(0, 8)}) — brief: ${t.brief.slice(0, 200)}`)
      : ["- none yet"]),
  ].join("\n");
}

interface BotDeps {
  /** Hands a ready (paid or trial) task to the orchestrator. */
  startTask: (taskId: string) => void;
  /** Revises a delivered task (agent + re-render) and returns the new result. */
  revise: (taskId: string, feedback: string) => Promise<{ task: Task; result: StoredResult }>;
  /** Agent engine, used for chat. */
  runner: AgentRunner;
}

export function createBot({ startTask, revise, runner }: BotDeps) {
  const bot = new Bot(env.TELEGRAM_BOT_TOKEN);
  // chatId → service picked and waiting for a brief. In-memory is fine for the MVP.
  const pendingType = new Map<number, TaskType>();
  // chatId → task the chat agent proposed, with the brief it wrote from the conversation.
  const pendingOrders = new Map<number, { type: TaskType; brief: string }>();

  /** Chat replies may use **bold**; Telegram needs HTML. Falls back to plain text if parsing fails. */
  const sendRich = async (chatId: number, text: string, markup?: InlineKeyboard) => {
    const html = text
      .slice(0, 3900)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
    try {
      await bot.api.sendMessage(chatId, html, { parse_mode: "HTML", reply_markup: markup });
    } catch {
      await bot.api.sendMessage(chatId, text.replace(/\*\*/g, "").slice(0, 4000), { reply_markup: markup });
    }
  };
  // Chats with an agent call in flight. One at a time per chat keeps sessions coherent.
  const busy = new Set<number>();

  /**
   * Runs slow agent work without blocking the update loop (grammY polls sequentially, so
   * awaiting a multi-minute LLM call here would freeze the bot for every user).
   */
  const inBackground = (chatId: number, work: () => Promise<void>) => {
    if (busy.has(chatId)) {
      void bot.api.sendMessage(chatId, "⏳ Still working on your last message — one moment.");
      return;
    }
    busy.add(chatId);
    const typing = () => void bot.api.sendChatAction(chatId, "typing").catch(() => {});
    typing();
    const timer = setInterval(typing, 4500);
    void work()
      .catch(async (e) => {
        console.error("[bot] agent call failed:", e);
        const msg = String((e as Error)?.message ?? e);
        const aiDown = /ProviderAuthError|API key|usage limit|rate limit|quota|429|timed out/i.test(msg);
        await bot.api
          .sendMessage(
            chatId,
            aiDown
              ? "⏳ Our AI studio is briefly unavailable — please try again in a few minutes. Your message wasn't charged."
              : "⚠️ Something went wrong on my side — please try again.",
          )
          .catch(() => {});
      })
      .finally(() => {
        clearInterval(timer);
        busy.delete(chatId);
      });
  };

  bot.command("start", (ctx) => {
    const free = ctx.from && trialsLeft(ctx.from.id) > 0;
    return ctx.reply(
      "👋 I'm your web3 creative studio.\n\nPromo flyers, motion videos and campaign copy for your project — made by AI designers " +
        "trained on what actually works in crypto. Pick a task, send a brief, get the files right here." +
        (free
          ? "\n\n🎁 Your first task is free. After that, pay per task in " + `${payment.symbol} on Celo — no subscription.`
          : `\n\nPay per task in ${payment.symbol} on Celo — no subscription.`) +
          "\n\n💬 You can also just message me — ask anything about your launch or brand.",
      { reply_markup: menu() },
    );
  });
  bot.command("new", (ctx) => ctx.reply("What do you need?", { reply_markup: menu() }));

  bot.command("tasks", async (ctx) => {
    const list = tasks.listByChat(ctx.chat.id);
    if (!list.length) return ctx.reply("No tasks yet. /new to start one.");
    await ctx.reply(
      list.map((t) => `• ${CATALOG[t.type].title} — ${STATUS_LABEL[t.status]} (${t.id.slice(0, 8)})`).join("\n"),
    );
  });

  bot.command("reset", async (ctx) => {
    chats.setSession(ctx.chat.id, null);
    await ctx.reply("🧹 Fresh start — I've cleared our chat history.");
  });

  bot.callbackQuery(/^svc:(.+)$/, async (ctx) => {
    const type = ctx.match[1];
    await ctx.answerCallbackQuery();
    if (!isTaskType(type) || !ctx.chat) return;
    if (!listedServices().some(([t]) => t === type)) return ctx.reply("That service isn't available right now — /new to see what is.");
    pendingType.set(ctx.chat.id, type);
    const s = CATALOG[type];
    await ctx.reply(`*${s.title}* — ${s.price} ${payment.symbol}\n${s.deliverable}\n\n${BRIEF_TEMPLATE}`, {
      parse_mode: "Markdown",
    });
  });

  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text.trim();
    const chatId = ctx.chat.id;

    // 1. A brief for the service they just picked.
    const type = pendingType.get(chatId);
    if (type) return handleBrief(ctx.chat.id, ctx.from.id, type, text, (m, o) => ctx.reply(m, o));

    // 2. A reply to a delivered file → revision by the agent that did the work.
    const repliedTo = ctx.message.reply_to_message?.message_id;
    const revisionTaskId = repliedTo ? taskMessages.taskFor(chatId, repliedTo) : undefined;
    if (revisionTaskId) return handleRevision(revisionTaskId, text, (m) => ctx.reply(m));

    // 3. Anything else → conversation with the chat agent.
    if (text.startsWith("/")) return ctx.reply("Commands: /new · /tasks · /reset — or just message me.");
    if (chats.countMessage(chatId) > env.CHAT_DAILY_LIMIT) {
      return ctx.reply(`You've reached today's chat limit (${env.CHAT_DAILY_LIMIT} messages). It resets tomorrow — /new still works anytime.`);
    }
    const platformName = ctx.me.first_name;
    const userId = ctx.from.id;
    inBackground(chatId, async () => {
      const { reply, sessionId } = await runner.chat(chats.session(chatId), text, platformContext(platformName, chatId, userId));
      chats.setSession(chatId, sessionId);

      // The chat agent can propose a ready-to-start task: [[ORDER:<type>|<brief>]] → "Design it" button.
      const order = reply.match(/\[\[ORDER:([a-z_]+)\|([\s\S]+?)\]\]/);
      const shown = reply.replace(/\[\[ORDER:[\s\S]*?\]\]/g, "").trim() || "…";
      const type = order?.[1];
      const offer = type && isTaskType(type) && listedServices().some(([t]) => t === type) && order[2].trim().length >= 40;
      let markup: InlineKeyboard | undefined;
      if (offer) {
        pendingOrders.set(chatId, { type, brief: order[2].trim() });
        const free = trialsLeft(userId) > 0;
        markup = new InlineKeyboard()
          .text(`🎨 Start: ${CATALOG[type].title} · ${free ? "free trial" : `${CATALOG[type].price} ${payment.symbol}`}`, `order:${type}`)
          .row()
          .text("✏️ Write my own brief", `svc:${type}`);
      }
      await sendRich(chatId, shown, markup);
    });
  });

  async function handleBrief(
    chatId: number,
    userId: number,
    type: TaskType,
    brief: string,
    reply: (msg: string, other?: Parameters<Bot["api"]["sendMessage"]>[2]) => Promise<unknown>,
  ) {
    if (brief.length < 40) return reply("That's a bit short — a few more details make the work much better.");
    pendingType.delete(chatId);

    if (trialsLeft(userId) > 0 && tasks.trialsToday() < env.FREE_TRIAL_DAILY_CAP) {
      const trial = tasks.createTrial({ chat_id: chatId, user_id: userId, type, brief });
      await reply(`🎁 Free trial — this one's on us (normally ${CATALOG[type].price} ${payment.symbol}).`);
      startTask(trial.id);
      return;
    }

    const task = tasks.create({ chat_id: chatId, user_id: userId, type, brief, price_atomic: toAtomic(CATALOG[type].price) });
    await sendQuote(task, reply);
  }

  /** Quote with payment options: demo wallet (testnet) and/or the tester's own wallet. */
  async function sendQuote(
    task: Task,
    reply: (msg: string, other?: Parameters<Bot["api"]["sendMessage"]>[2]) => Promise<unknown>,
  ) {
    const amount = `${formatAtomic(task.price_atomic)} ${payment.symbol}`;
    let text = `🧾 Quote: ${CATALOG[task.type].title}\nPrice: ${amount} on Celo (gasless, via x402)\nTask: ${task.id.slice(0, 8)}`;
    const kb = new InlineKeyboard();
    if (demoPayer) {
      text += "\n\n⚡ Testnet demo: tap below and our demo wallet pays for you — a real x402 payment settled on Celo Sepolia. No wallet needed.";
      kb.text(`⚡ Pay ${amount} with demo wallet`, `demopay:${task.id}`).row();
    }
    // Telegram only accepts https URLs on buttons; fall back to a plain link in local dev.
    if (env.PUBLIC_URL.startsWith("https://")) kb.url(demoPayer ? "👛 Pay with my own wallet" : `Pay ${amount}`, payUrl(task));
    else text += `\n\n${demoPayer ? "Or pay with your own wallet" : "Pay here"}: ${payUrl(task)}`;
    await reply(text, kb.inline_keyboard.length ? { reply_markup: kb, link_preview_options: { is_disabled: true } } : undefined);
  }

  bot.callbackQuery(/^order:(.+)$/, async (ctx) => {
    const chatId = ctx.chat?.id;
    const order = chatId ? pendingOrders.get(chatId) : undefined;
    if (!chatId || !order || order.type !== ctx.match[1]) {
      return ctx.answerCallbackQuery({ text: "That offer expired. Tell me again what you need, or use /new." });
    }
    pendingOrders.delete(chatId);
    await ctx.answerCallbackQuery({ text: "On it!" });
    await ctx.editMessageReplyMarkup().catch(() => {});
    await handleBrief(chatId, ctx.from.id, order.type, order.brief, (m, o) => bot.api.sendMessage(chatId, m, o));
  });

  bot.callbackQuery(/^demopay:(.+)$/, async (ctx) => {
    const task = tasks.get(ctx.match[1]);
    if (!demoPayer || !task || task.chat_id !== ctx.chat?.id) return ctx.answerCallbackQuery({ text: "This quote isn't available." });
    if (task.status !== "quoted") return ctx.answerCallbackQuery({ text: `This task is already ${task.status}.` });
    if (tasks.demoPaysToday(task.user_id) >= env.DEMO_PAYS_PER_USER_DAILY) {
      return ctx.answerCallbackQuery({
        text: `Demo wallet limit reached (${env.DEMO_PAYS_PER_USER_DAILY}/day). Pay with your own wallet or try tomorrow.`,
        show_alert: true,
      });
    }
    await ctx.answerCallbackQuery({ text: "Paying with the demo wallet…" });
    await ctx.editMessageReplyMarkup().catch(() => {}); // prevent double taps
    const amount = `${formatAtomic(task.price_atomic)} ${payment.symbol}`;
    const status = await ctx.reply(`⏳ Demo wallet is paying ${amount} via x402 on Celo Sepolia… (~10s)`);

    // Settlement takes seconds; don't block the update loop.
    void demoPayer.pay(task.id).then(async (r) => {
      if (r.ok) {
        tasks.update(task.id, { paid_via: "demo" });
        await bot.api.editMessageText(task.chat_id, status.message_id, "⚡ Paid by the demo wallet via x402 — receipt below.");
        return;
      }
      console.error(`[demo-pay] ${task.id} failed: ${r.error}`);
      const empty = /insufficient/i.test(r.error);
      await bot.api.editMessageText(
        task.chat_id,
        status.message_id,
        empty
          ? "⚠️ The demo wallet is out of test funds right now — the team has been notified. You can still pay with your own wallet below."
          : `⚠️ Demo payment didn't go through (${r.error}). Try again below.`,
      );
      const fresh = tasks.get(task.id);
      if (fresh?.status === "quoted") await sendQuote(fresh, (m, o) => bot.api.sendMessage(task.chat_id, m, o));
    });
  });

  async function handleRevision(taskId: string, feedback: string, reply: (msg: string) => Promise<unknown>) {
    const task = tasks.get(taskId);
    if (!task || task.status !== "delivered" || !task.opencode_session) {
      return reply("This task can't be revised right now.");
    }
    if (task.revisions >= env.FREE_REVISIONS) {
      return reply(`You've used all ${env.FREE_REVISIONS} revisions for this task. For a fresh take, start a new one with /new.`);
    }
    if (feedback.length < 5) return reply("Tell me what to change — e.g. “more playful”, “shorter captions”, “drop the emoji”.");

    const n = task.revisions + 1;
    await reply(`✏️ On it — revision ${n} of ${env.FREE_REVISIONS}. Design + render usually takes 2–4 minutes.`);
    inBackground(task.chat_id, async () => {
      const { task: updated, result } = await revise(task.id, feedback);
      const left = env.FREE_REVISIONS - n;
      await sendDeliverable(
        bot.api,
        updated,
        result,
        `Revision ${n} of ${env.FREE_REVISIONS}.` + (left > 0 ? ` ↩️ Reply to this file for more changes (${left} left).` : ""),
      );
    });
  }

  bot.catch((err) => console.error("[bot]", err.error));
  return bot;
}

export function telegramNotifier(bot: Bot): Notifier {
  return {
    async workStarted(task) {
      if (!task.chat_id) return;
      const visual = "produces" in CATALOG[task.type];
      const started = `🤖 An agent has started on your ${CATALOG[task.type].title.toLowerCase()}. ` +
        (visual ? "Design + render usually takes 2–5 minutes." : "Usually takes 1–3 minutes.");
      const msg = task.attempts > 1
        ? "🔁 Retrying your task with a fresh agent run…"
        : task.is_trial
          ? started
          : `✅ Payment confirmed on Celo.\n${receipt(task)}\n\n${started}`;
      await bot.api.sendMessage(task.chat_id, msg, { link_preview_options: { is_disabled: true } });
    },

    async deliver(task, result: StoredResult) {
      const caption = task.is_trial
        ? `Full deliverable attached. 🎁 Free trial\n\n${REVISION_HINT}`
        : `Full deliverable attached.\n\n${receipt(task)}\n\n${REVISION_HINT}`;
      await sendDeliverable(bot.api, task, result, caption);
      if (task.is_trial && trialsLeft(task.user_id) === 0) {
        await bot.api.sendMessage(
          task.chat_id,
          `That was your free trial 🎁\n\nEvery task from here is pay-per-task in ${payment.symbol} on Celo — ` +
            `from ${Math.min(...listedServices().map(([, s]) => Number(s.price))).toFixed(2)} ${payment.symbol}, gasless, no subscription.`,
          { reply_markup: menu() },
        );
      }
    },

    async failed(task) {
      if (!task.chat_id) return;
      if (task.is_trial) {
        await bot.api.sendMessage(task.chat_id, "⚠️ Your free trial task couldn't be completed. Your free trial is still available — /new to try again.");
        return;
      }
      await bot.api.sendMessage(
        task.chat_id,
        `⚠️ Your task ${task.id.slice(0, 8)} couldn't be completed. Your payment is recorded:\n${receipt(task)}\n\nWe'll follow up with a re-run or a refund.`,
      );
    },
  };
}
