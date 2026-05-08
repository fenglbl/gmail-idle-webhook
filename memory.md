# gmail-idle-webhook 项目记忆

## 待改
- HTTP 代理不支持 IMAP SSL 隧道，需改 SOCKS5（用户客户端端口待确认，可能是 Clash 7890 或其他）
- 代理地址：192.168.31.111:20170（HTTP，当前不可用）

## 2026-05-07
- 凌晨 00:23 用户提出用 Node.js + IMAP IDLE 封装 API 的需求
- 创建了 package.json（imapflow + mailparser + express）
- 下午 17:07 项目移到 /www/wwwroot/ 并继续开发
- 完成 src/ 全部代码：index.js / config.js / watcher.js / webhook.js / logger.js
- 依赖安装完成，启动测试通过
- 还未配置真实 Gmail 账号测试
