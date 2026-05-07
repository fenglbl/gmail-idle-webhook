import logger from './logger.js';

export async function sendWebhooks(webhooks, payload) {
  for (const hook of webhooks) {
    try {
      const res = await fetch(hook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(hook.headers || {}),
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000),
      });
      logger.info(`Webhook ${hook.url} → ${res.status}`);
    } catch (err) {
      logger.error(`Webhook ${hook.url} failed:`, err.message);
    }
  }
}
