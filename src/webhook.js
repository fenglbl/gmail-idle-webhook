import logger from './logger.js';

// 将模板中的 {{变量}} 替换为实际值
function renderTemplate(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const val = vars[key];
    return val != null ? String(val) : '';
  });
}

export async function sendWebhooks(webhooks, vars) {
  for (const hook of webhooks) {
    try {
      let body;
      let contentType = 'application/json';

      if (hook.template) {
        // 自定义模板：用变量渲染
        body = renderTemplate(hook.template, vars);
        // 如果模板不是 JSON 开头，当作纯文本
        if (!body.trim().startsWith('{') && !body.trim().startsWith('[')) {
          contentType = 'text/plain';
        }
      } else {
        // 默认 JSON
        body = JSON.stringify(vars);
      }

      const res = await fetch(hook.url, {
        method: 'POST',
        headers: {
          'Content-Type': contentType,
          ...(hook.headers || {}),
        },
        body,
        signal: AbortSignal.timeout(10000),
      });
      logger.info(`Webhook ${hook.url} → ${res.status}`);
    } catch (err) {
      logger.error(`Webhook ${hook.url} failed:`, err.message);
    }
  }
}
