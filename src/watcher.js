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

      // 打开 INBOX，只读未删除的
      const lock = await this.client.getMailboxLock('INBOX');
      const initialUid = this.client.mailbox.uidNext;
      lock.release();
      logger.info(`INBOX 当前 uidNext: ${initialUid}`);

      // 进入 IDLE 循环
      while (this.running) {
        try {
          logger.debug('进入 IDLE...');
          await this.client.idle();

          // IDLE 结束（有事件或超时），检查新邮件
          await this._checkNew();
        } catch (idleErr) {
          logger.warn('IDLE 异常:', idleErr.message);
          break; // 跳出循环进重连
        }
      }
    } catch (err) {
      logger.error('IMAP 连接失败:', err.message);
    } finally {
      try { await this.client.logout(); } catch {}
      this.client = null;
    }

    // 重连
    if (this.running) {
      const delay = this.config.pollFallback || 30000;
      logger.info(`${delay / 1000}s 后重连...`);
      this._reconnectTimer = setTimeout(() => this._connect(), delay);
    }
  }

  async _checkNew() {
    if (!this.client || !this.client.usable) return;

    try {
      // 搜索最近 60 秒内到达的邮件
      const since = new Date(Date.now() - 60000);
      const messages = this.client.fetch(
        { since },
        {
          uid: true,
          source: true,
          envelope: true,
          internalDate: true,
        }
      );

      for await (const msg of messages) {
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
        } catch (parseErr) {
          logger.error('解析邮件失败:', parseErr.message);
        }
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
