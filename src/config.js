import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = resolve(__dirname, '..', 'config.json');

const DEFAULT_CONFIG = {
  imap: {
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    user: '',
    password: '',  // Gmail App Password，不是登录密码
  },
  webhooks: [],  // [{ url: 'https://...', headers?: {} }]
  pollFallback: 30000, // IMAP IDLE 断线后轮询间隔 ms
};

export function loadConfig() {
  if (!existsSync(CONFIG_PATH)) {
    writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2));
    return DEFAULT_CONFIG;
  }
  const raw = readFileSync(CONFIG_PATH, 'utf8');
  return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
}

export function saveConfig(config) {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}
