export default {
  async email(message, env, ctx) {
    // raw は ReadableStream (RFC 5322 形式)
    const rawText = await new Response(message.raw).text();
    console.log(rawText)

    const dateMatch  = rawText.match(/ご利用日時：(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/);
    const amountMatch = rawText.match(/ご利用金額：([\d,]+)円/);
    const placeMatch  = rawText.match(/ご利用店舗：(.+)/);

    // 3フィールドすべて揃わなければ何もしない
    if (!dateMatch || !amountMatch || !placeMatch) return;

    // "2026-03-24 23:06:27" → JST として ISO 8601 に変換
    const consumedAt = new Date(
      dateMatch[1].replace(" ", "T") + "+09:00"
    ).toISOString();

    const amount = parseInt(amountMatch[1].replace(/,/g, ""), 10);
    const place  = placeMatch[1].trim();

    const result = { consumedAt, amount, place };
    console.log(JSON.stringify(result));
  },
};