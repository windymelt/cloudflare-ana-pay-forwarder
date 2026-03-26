import { z } from "zod";

export const PaymentSchema = z.object({
  consumedAt: z.string().datetime({ offset: true }),
  amount: z.number().int().positive(),
  place: z.string().min(1),
});
