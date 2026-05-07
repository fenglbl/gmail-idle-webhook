import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { sendWebhooks } from './webhook.js';
import logger from './logger.js';

export class GmailWatcher {
  constructor(config) {
    this.config = config;
    this.client = null;
    this.running = false;
    this._reconnectTimer = null;
    this._lastUid = 0; // 已处理的最大 UID
  }

  _makeClient() {
    return new ImapFlow({
      host: this.config.imap.host,
      port: this.config.imap.port,
      secure: this.config.imap.secure,
      auth: {
        user: this.config.imap.user,
        pass: this.config.imap.password,
      },
      logger: false,
    });
  }

  async start() {
    if (this.running) return;
    this.running = true;
    logger.info('GmailWatcher 启动');
    this._connect();
  }

  async stop() {
    this.running = false;
    clearTimeout(this._reconnectTimer);
    if (this.client) {
      try { await this.client.logout(); } catch {}
      this.client = null;
    }
    logger.info('GmailWatcher 停止');
  }

  async _connect() {
    if (!this.running) return;
    this.client = this._makeClient();

    try {
      await this.client.connect();
      logger.info('IMAP 连接成功');

      // 打开 INBOX，记录当前 uidNext，只处理之后的新邮件
      const lock = await this.client.getMailboxLock('INBOX');
      this._lastUid = this.client.mailbox.uidNext - 1;
      lock.release();
      logger.info(`INBOX uidNext: ${this._lastUid + 1}，从 ${this._lastUid + 1} 开始监听`);

      // 进入 IDLE 循环
      while (this.running) {
        try {
          logger.debug('进入 IDLE...');
          await this.client.idle();
          await this._checkNew();
        } catch (idleErr) {
          logger.warn('IDLE 异常:', idleErr.message);
          break;
        }
      }
    } catch (err) {
      logger.error('IMAP 连接失败:', err.message);
    } finally {
      try { await this.client.logout(); } catch {}
      this.client = null;
    }

    if (this.running) {
      const delay = this.config.pollFallback || 30000;
      logger.info(`${delay / 1000}s 后重连...`);
      this._reconnectTimer = setTimeout(() => this._connect(), delay);
    }
  }

  async _checkNew() {
    if (!this.client || !this.client.usable) return;

    try {
      // 只查 UID 大于上次处理的
      const uidRange = `${this._lastUid + 1}:*`;
      const messages = this.client.fetch(
        { uid: uidRange },
        {
          uid: true,
          source: true,
          envelope: true,
          internalDate: true,
        }
      );

      let maxUid = this._lastUid;
      let count = 0;

      for await (const msg of messages) {
        if (msg.uid <= this._lastUid) continue;
        count++;
        try {
          const parsed = await simpleParser(msg.source);
          const vars = {
            uid: String(msg.uid),
            from: parsed.from?.text || '',
            to: parsed.to?.text || '',
            subject: parsed.subject || '',
            date: parsed.date?.toISOString() || msg.internalDate?.toISOString() || '',
            text: (parsed.text || '').substring(0, 5000),
            html: parsed.html ? 'true' : 'false',
            messageId: parsed.messageId || '',
          };
          logger.info(`新邮件: ${vars.subject} (uid ${vars.uid})`);
          await sendWebhooks(this.config.webhooks, vars);
          if (msg.uid > maxUid) maxUid = msg.uid;
        } catch (parseErr) {
          logger.error('解析邮件失败:', parseErr.message);
        }
      }

      this._lastUid = maxUid;
      if (count === 0) {
        logger.debug('无新邮件');
      }
    } catch (fetchErr) {
      logger.error('获取新邮件失败:', fetchErr.message);
    }
  }

  getStatus() {
    return {
      running: this.running,
      connected: this.client?.usable || false,
    };
  }
}
