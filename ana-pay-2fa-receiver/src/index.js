import PostalMime from "postal-mime";

const KV_VERICODE_KEY = "ana-pay-mf-vericode";

export default {
  async email(message, env, ctx) {
    const rawBytes = await new Response(message.raw).arrayBuffer();
    const parsed = await PostalMime.parse(rawBytes);

    const body = parsed.html || parsed.text || "";
    console.log("Decoded body:", body);

    // "認証コード：" (全角コロン) の後に続く数字列を抽出
    const codeMatch = body.match(/認証コード：(?:<br\s*\/?>|\s)*(\d+)/);
    if (!codeMatch) {
      console.error("Verification code not found in email");
      return;
    }

    const code = codeMatch[1];
    console.log("Extracted verification code:", code);

    await env.ANA_PAY_KV.put(KV_VERICODE_KEY, code, { expirationTtl: 600 });
    console.log("Verification code stored in KV");
  },
};
