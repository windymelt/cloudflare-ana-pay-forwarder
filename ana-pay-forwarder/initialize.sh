#!/bin/sh

npx wrangler queues create ana-pay-forward-queue
npx wrangler kv namespace create ana-pay-kv

