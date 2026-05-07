import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import express from 'express';
import { loadConfig, saveConfig } from './config.js';
import { GmailWatcher } from './watcher.js';
import logger from './logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const config = loadConfig();
const watcher = new GmailWatcher(config);
const app = express();

app.use(express.json());

// Admin 页面
app.use('/admin', express.static(resolve(__dirname, '..', 'public')));
app.get('/admin', (_req, res) => {
  res.sendFile(resolve(__dirname, '..', 'public', 'admin.html'));
});

// 健康检查
app.get('/health', (_req, res) => {
  res.json({ ok: true, watcher: watcher.getStatus() });
});

// 获取配置（脱敏）
app.get('/config', (_req, res) => {
  const safe = { ...config };
  if (safe.imap?.password) {
    safe.imap = { ...safe.imap, password: '***' };
  }
  res.json(safe);
});

// 更新配置
app.put('/config', async (req, res) => {
  const next = { ...config, ...req.body };
  if (req.body.imap) {
    next.imap = { ...config.imap, ...req.body.imap };
  }
  saveConfig(next);
  Object.assign(config, next);

  // 重启 watcher
  await watcher.stop();
  watcher.config = config;
  watcher.start();

  res.json({ ok: true, restarted: true });
});

// 添加 webhook
app.post('/webhooks', (req, res) => {
  const { url, headers, template } = req.body;
  config.webhooks.push({ url: url || '', headers: headers || {}, template: template || '' });
  saveConfig(config);
  res.json({ ok: true, webhooks: config.webhooks });
});

// 更新 webhook
app.put('/webhooks/:index', (req, res) => {
  const i = parseInt(req.params.index, 10);
  if (i < 0 || i >= config.webhooks.length) {
    return res.status(404).json({ error: 'not found' });
  }
  const { url, headers, template } = req.body;
  config.webhooks[i] = {
    url: url ?? config.webhooks[i].url,
    headers: headers ?? config.webhooks[i].headers,
    template: template ?? config.webhooks[i].template ?? '',
  };
  saveConfig(config);
  res.json({ ok: true, webhooks: config.webhooks });
});

// 删除 webhook
app.delete('/webhooks/:index', (req, res) => {
  const i = parseInt(req.params.index, 10);
  if (i < 0 || i >= config.webhooks.length) {
    return res.status(404).json({ error: 'not found' });
  }
  config.webhooks.splice(i, 1);
  saveConfig(config);
  res.json({ ok: true, webhooks: config.webhooks });
});

// 手动触发检查
app.post('/check', async (_req, res) => {
  if (!watcher.client?.usable) {
    return res.status(503).json({ error: 'not connected' });
  }
  await watcher._checkNew();
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3800;

app.listen(PORT, () => {
  logger.info(`API 监听 :${PORT}`);
  logger.info(`Admin 页面: http://localhost:${PORT}/admin`);
  // 启动 watcher（如果配置完整）
  if (config.imap.user && config.imap.password) {
    watcher.start();
  } else {
    logger.warn('IMAP 未配置，请访问 /admin 设置账号密码');
  }
});
