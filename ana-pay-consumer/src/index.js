import puppeteer from "@cloudflare/puppeteer";
import { PaymentSchema } from "./schema.js";

const SIGN_IN_URL = "https://ssnb.x.moneyforward.com/users/sign_in";
const HOME_URL = "https://ssnb.x.moneyforward.com";
const KV_VERICODE_KEY = "ana-pay-mf-vericode";

// KVをポーリングしつつ、ブラウザセッション維持のためにページを定期操作する。
async function pollForVerificationCode(env, page, maxAttempts = 108) {
  for (let i = 0; i < maxAttempts; i++) {
    const code = await env.ANA_PAY_KV.get(KV_VERICODE_KEY);
    if (code) {
      await env.ANA_PAY_KV.delete(KV_VERICODE_KEY);
      return code;
    }
    await new Promise((r) => setTimeout(r, 5_000));
    await page.title(); // keep-alive
  }
  throw new Error("Verification code not received within timeout");
}

// 1つのブラウザセッション内でログイン -> 2FA(必要なら) -> 決済入力を行う。
async function processPayment(env, payment) {
  const browser = await puppeteer.launch(env.BROWSER);
  try {
    const page = await browser.newPage();

    // Phase 1: ログイン
    await page.goto(SIGN_IN_URL, { waitUntil: "networkidle0" });

    const emailInput = await page.$('input[type="email"]');
    if (emailInput) {
      await emailInput.type(env.MF_EMAIL);
      await page.type('input[type="password"]', env.MF_PASSWORD);
      await Promise.all([
        page.waitForNavigation({ waitUntil: "networkidle0" }),
        page.click('input[type="submit"], button[type="submit"]'),
      ]);

      // 2FAチェック
      const verificationInput = await page.$("#verification_code");
      if (verificationInput) {
        console.log("Verification code required, polling KV...");
        const code = await pollForVerificationCode(env, page);
        await verificationInput.type(code);
        await Promise.all([
          page.waitForNavigation({ waitUntil: "networkidle0" }),
          page.click('input[type="submit"], button[type="submit"]'),
        ]);
        console.log("Verification code submitted");
      }

      console.log("Login complete");
    } else {
      console.log("Already logged in");
    }

    // Phase 2: 決済入力
    console.log("Phase 2: navigating to", HOME_URL);
    await page.goto(HOME_URL, { waitUntil: "networkidle0" });
    console.log("Phase 2: page loaded, URL:", page.url());

    console.log("Phase 2: waiting for amount input...");
    await page.waitForSelector("#js-cf-manual-payment-entry-amount", { timeout: 10_000 });

    console.log("Phase 2: typing amount:", payment.amount);
    await page.type("#js-cf-manual-payment-entry-amount", String(payment.amount));

    const d = new Date(payment.consumedAt);
    const dateStr = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
    console.log("Phase 2: setting date:", dateStr);
    await page.$eval(
      "#js-cf-manual-payment-entry-calendar",
      (el, v) => el.setAttribute("data-date", v),
      dateStr,
    );

    console.log("Phase 2: typing place:", payment.place);
    await page.type("#js-cf-manual-payment-entry-content", payment.place);

    console.log("Phase 2: submitting...");
    await page.click('input[type="submit"], button[type="submit"]');
    await new Promise((r) => setTimeout(r, 5_000));

    console.log(`Phase 2: done - ${payment.amount} at ${payment.place}`);
  } finally {
    await browser.close();
  }
}

export default {
  async queue(batch, env) {
    for (const msg of batch.messages) {
      const parsed = PaymentSchema.safeParse(msg.body);
      if (!parsed.success) {
        console.error("Invalid message:", parsed.error.message);
        msg.ack();
        continue;
      }

      try {
        await processPayment(env, parsed.data);
        msg.ack();
      } catch (err) {
        console.error("Failed to process payment:", err);
        msg.retry();
      }
    }
  },
};
