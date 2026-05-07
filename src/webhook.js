import logger from './logger.js';

// 将模板中的 {{变量}} 替换为实际值，JSON 模式下转义特殊字符
function renderTemplate(template, vars) {
  const isJson = template.trim().startsWith('{') || template.trim().startsWith('[');
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    let val = vars[key];
    if (val == null) return '';
    val = String(val);
    if (isJson) {
      // JSON 模式下转义会破坏结构的字符
      val = val.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
    }
    return val;
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

      if (res.status >= 400) {
        const errText = await res.text().catch(() => '');
        logger.warn(`Webhook ${hook.url} → ${res.status} ${errText.substring(0, 200)}`);
        logger.debug('Sent body:', body.substring(0, 500));
      } else {
        logger.info(`Webhook ${hook.url} → ${res.status}`);
      }
    } catch (err) {
      logger.error(`Webhook ${hook.url} failed:`, err.message);
    }
  }
}
