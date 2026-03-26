import puppeteer from "@cloudflare/puppeteer";
import { PaymentSchema } from "./schema.js";

const SIGN_IN_URL = "https://ssnb.x.moneyforward.com/users/sign_in";
const HOME_URL = "https://ssnb.x.moneyforward.com";
const KV_VERICODE_KEY = "ana-pay-mf-vericode";

async function waitForVerificationCode(env, maxAttempts = 10) {
  for (let i = 0; i < maxAttempts; i++) {
    const code = await env.ANA_PAY_KV.get(KV_VERICODE_KEY);
    if (code) {
      await env.ANA_PAY_KV.delete(KV_VERICODE_KEY);
      return code;
    }
    await new Promise((r) => setTimeout(r, 60_000));
  }
  throw new Error("Verification code not received within timeout");
}

async function login(page, env) {
  await page.goto(SIGN_IN_URL, { waitUntil: "networkidle0" });

  const emailInput = await page.$('input[type="email"]');
  if (!emailInput) {
    console.log("Already logged in, skipping login phase");
    return;
  }

  await emailInput.type(env.MF_EMAIL);
  await page.type('input[type="password"]', env.MF_PASSWORD);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0" }),
    page.click('input[type="submit"], button[type="submit"]'),
  ]);

  const verificationInput = await page.$("#verification_code");
  if (verificationInput) {
    console.log("Verification code required, waiting for KV...");
    const code = await waitForVerificationCode(env);
    await verificationInput.type(code);
    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle0" }),
      page.click('input[type="submit"], button[type="submit"]'),
    ]);
    console.log("Verification code submitted");
  }

  console.log("Login complete");
}

async function enterPayment(page, payment) {
  await page.goto(HOME_URL, { waitUntil: "networkidle0" });

  await page.type("input.payment-amount", String(payment.amount));

  const d = new Date(payment.consumedAt);
  const dateStr = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
  await page.$eval(
    "#js-cf-manual-payment-entry-calendar",
    (el, v) => el.setAttribute("data-date", v),
    dateStr,
  );

  await page.type("#js-cf-manual-payment-entry-content", payment.place);

  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0" }),
    page.click('input[type="submit"], button[type="submit"]'),
  ]);

  console.log(`Payment entered: ${payment.amount} at ${payment.place}`);
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

      const payment = parsed.data;
      const browser = await puppeteer.launch(env.BROWSER);

      try {
        const page = await browser.newPage();
        await login(page, env);
        await enterPayment(page, payment);
        msg.ack();
      } catch (err) {
        console.error("Failed to process payment:", err);
        msg.retry();
      } finally {
        await browser.close();
      }
    }
  },
};
