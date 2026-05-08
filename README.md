# gmail-idle-webhook

Gmail 新邮件 Webhook 推送服务。基于 IMAP 轮询，新邮件到达时自动 POST 到你配置的 URL。

## 快速开始

```bash
npm install
npm start
# 默认监听 :3800
```

## 配置

启动后 PUT `/config` 设置账号：

```bash
curl -X PUT http://localhost:3800/config \
  -H 'Content-Type: application/json' \
  -d '{
    "imap": {
      "user": "you@gmail.com",
      "password": "xxxx-xxxx-xxxx"
    }
  }'
```

> password 用 Gmail App Password，不是登录密码。
> 去 https://myaccount.google.com/apppasswords 生成。

### 代理

支持 HTTP/SOCKS5 代理连接 IMAP，在 config 中配置：

```json
{
  "proxy": {
    "enabled": true,
    "type": "http",
    "host": "127.0.0.1",
    "port": 1080,
    "user": "",
    "pass": ""
  }
}
```

## API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查 + watcher 状态 |
| GET | `/config` | 获取配置（密码脱敏） |
| PUT | `/config` | 更新配置，自动重启 watcher |
| POST | `/webhooks` | 添加 webhook：`{ url, headers? }` |
| DELETE | `/webhooks/:index` | 删除 webhook |
| POST | `/check` | 手动触发检查新邮件 |

## Webhook Payload

```json
{
  "type": "new_mail",
  "data": {
    "uid": 123,
    "from": "sender@example.com",
    "to": "you@gmail.com",
    "subject": "邮件标题",
    "date": "2026-05-07T09:00:00.000Z",
    "text": "正文前5000字符...",
    "html": true
  }
}
```

## 结构

```
├── config.json      # 持久化配置（自动创建）
└── src/
    ├── index.js     # 入口 + Express API
    ├── config.js    # 配置读写
    ├── watcher.js   # IMAP 轮询核心逻辑
    ├── webhook.js   # Webhook 推送
    └── logger.js    # 日志
```

## 环境变量

- `PORT` — API 端口，默认 3800
- `LOG_LEVEL` — debug/info/warn/error，默认 info

## 稳定性

- IMAP 连接异常（socket timeout 等）会自动重连，不会崩进程
- 每 10s 轮询一次新邮件，mailbox lock 保证一致性
- 建议用宝塔/PM2/systemd 守护进程
