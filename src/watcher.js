import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { sendWebhooks } from './webhook.js';
import logger from './logger.js';

const NOOP_INTERVAL = 30000;

export class GmailWatcher {
  constructor(config) {
    this.config = config;
    this.client = null;
    this.running = false;
    this._reconnectTimer = null;
    this._noopTimer = null;
    this._lastUid = 0;
    this._checking = false; // 防并发锁
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
    if (this._noopTimer) clearInterval(this._noopTimer);
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

      const lock = await this.client.getMailboxLock('INBOX');
      this._lastUid = this.client.mailbox.uidNext - 1;
      logger.info(`uidNext=${this._lastUid + 1}，从 ${this._lastUid + 1} 开始监听`);
      lock.release();

      // NOOP 兜底
      this._noopTimer = setInterval(() => {
        if (this.client?.usable && !this._checking) {
          this.client.noop().catch(() => {});
          logger.debug('NOOP 触发检查');
          this._checkNew();
        }
      }, NOOP_INTERVAL);

      // IDLE 循环
      while (this.running) {
        try {
          logger.debug('进入 IDLE...');
          await this.client.idle();
          logger.debug('IDLE 返回');
          await this._checkNew();
        } catch (idleErr) {
          logger.warn('IDLE 异常:', idleErr.message);
          break;
        }
      }
    } catch (err) {
      logger.error('IMAP 连接失败:', err.message);
    } finally {
      if (this._noopTimer) { clearInterval(this._noopTimer); this._noopTimer = null; }
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
    if (this._checking) {
      logger.debug('跳过 _checkNew（上一轮未结束）');
      return;
    }
    if (!this.client || !this.client.usable) return;

    this._checking = true;
    try {
      const uidRange = `${this._lastUid + 1}:*`;
      logger.debug(`fetch uid ${uidRange} (lastUid=${this._lastUid})`);
      const messages = this.client.fetch(
        { uid: uidRange },
        { uid: true, source: true, envelope: true, internalDate: true }
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
      if (count > 0) {
        logger.info(`处理了 ${count} 封新邮件，lastUid=${this._lastUid}`);
      } else {
        logger.debug('无新邮件');
      }
    } catch (fetchErr) {
      logger.error('获取新邮件失败:', fetchErr.message);
    } finally {
      this._checking = false;
    }
  }

  getStatus() {
    return {
      running: this.running,
      connected: this.client?.usable || false,
    };
  }
}
