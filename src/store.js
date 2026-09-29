import session from 'express-session';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { defaultSettings } from './policy.js';

export function createStore(pool) {
  const query = async (sql, values = []) => (await pool.execute(sql, values))[0];
  return {
    async createOAuthState(sessionId, state, expires) {
      const digest = value => createHash('sha256').update(value).digest('hex');
      await query('INSERT INTO oauth_states (state_hash, session_hash, expires) VALUES (?, ?, ?)', [digest(state), digest(sessionId), expires]);
    },
    async consumeOAuthState(sessionId, state) {
      const digest = value => createHash('sha256').update(value).digest('hex');
      const result = await query('DELETE FROM oauth_states WHERE state_hash = ? AND session_hash = ? AND expires > ?', [digest(state), digest(sessionId), Date.now()]);
      return result.affectedRows === 1;
    },
    async getSettings(guildId) {
      const rows = await query('SELECT config, version FROM guild_settings WHERE guild_id = ?', [guildId]);
      return rows[0] ? { settings: rows[0].config, version: rows[0].version } : { settings: defaultSettings(), version: 0 };
    },
    async saveSettings(guildId, settings, expectedVersion, actorId) {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        await connection.execute('INSERT IGNORE INTO guild_settings (guild_id, config) VALUES (?, ?)', [guildId, JSON.stringify(defaultSettings())]);
        const [rows] = await connection.execute('SELECT version FROM guild_settings WHERE guild_id = ? FOR UPDATE', [guildId]);
        if (rows[0].version !== expectedVersion) throw Object.assign(new Error('Settings changed. Reload before saving.'), { status: 409 });
        await connection.execute('UPDATE guild_settings SET config = ?, version = version + 1 WHERE guild_id = ?', [JSON.stringify(settings), guildId]);
        await connection.execute('INSERT INTO settings_audit (guild_id, actor_id, event) VALUES (?, ?, ?)', [guildId, actorId, `Saved settings; mode=${settings.mode}`]);
        await connection.commit();
        return { settings, version: expectedVersion + 1 };
      } catch (error) { await connection.rollback(); throw error; }
      finally { connection.release(); }
    },
    async addCase(item) {
      try {
        const result = await query(`INSERT INTO moderation_cases
          (guild_id, channel_id, message_id, author_id, message_hash, policy_version, content, matches, model, requested_action, outcome)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [item.guildId, item.channelId, item.messageId, item.authorId, item.messageHash, item.policyVersion,
          item.content.slice(0, 4000), JSON.stringify(item.matches), item.model, item.requestedAction, item.outcome]);
        return String(result.insertId);
      } catch (error) { if (error.code === 'ER_DUP_ENTRY') return null; throw error; }
    },
    async getCase(guildId, id) {
      return (await query('SELECT * FROM moderation_cases WHERE guild_id = ? AND id = ?', [guildId, id]))[0];
    },
    async finishCase(guildId, id, outcome, actorId = null) {
      await query('UPDATE moderation_cases SET outcome = ?, reviewed_by = ? WHERE guild_id = ? AND id = ?', [outcome, actorId, guildId, id]);
    },
    async claimCase(guildId, id, actorId) {
      const result = await query("UPDATE moderation_cases SET outcome = 'reviewing', reviewed_by = ? WHERE guild_id = ? AND id = ? AND outcome IN ('monitored', 'logged', 'delete_failed')", [actorId, guildId, id]);
      return result.affectedRows === 1;
    },
    async listCases(guildId, before = '18446744073709551615') {
      return query('SELECT * FROM moderation_cases WHERE guild_id = ? AND id < ? ORDER BY id DESC LIMIT 50', [guildId, before]);
    },
    async audit(guildId) { return query('SELECT * FROM settings_audit WHERE guild_id = ? ORDER BY id DESC LIMIT 20', [guildId]); },
    async stats(guildId) {
      const [row] = await query(`SELECT COUNT(*) AS total, COALESCE(SUM(outcome IN ('deleted', 'deleted_timed_out', 'deleted_timeout_failed', 'deleted_timeout_skipped')), 0) AS removed,
        COALESCE(SUM(outcome IN ('monitored', 'logged', 'delete_failed')), 0) AS review
        FROM moderation_cases WHERE guild_id = ?`, [guildId]);
      return row;
    },
    async forgetGuild(guildId) {
      // No table is shared across guilds without a guild_id predicate.
      for (const table of ['moderation_cases', 'settings_audit', 'guild_settings']) {
        await query(`DELETE FROM ${table} WHERE guild_id = ?`, [guildId]);
      }
    },
    async cleanup() {
      await query('DELETE FROM moderation_cases WHERE created_at < CURRENT_TIMESTAMP - INTERVAL 30 DAY');
      await query('DELETE FROM settings_audit WHERE created_at < CURRENT_TIMESTAMP - INTERVAL 30 DAY');
      await query('DELETE FROM dashboard_sessions WHERE expires < ?', [Date.now()]);
      await query('DELETE FROM oauth_states WHERE expires < ?', [Date.now()]);
      // A process crash must never cause an in-flight punishment to be retried automatically.
      await query("UPDATE moderation_cases SET outcome = 'interrupted' WHERE outcome IN ('pending', 'reviewing') AND created_at < CURRENT_TIMESTAMP - INTERVAL 5 MINUTE");
    },
  };
}

export class MysqlSessionStore extends session.Store {
  constructor(pool, secret) {
    super();
    this.pool = pool;
    this.key = createHash('sha256').update(secret).digest();
  }
  get(id, callback) {
    this.pool.execute('SELECT payload FROM dashboard_sessions WHERE id = ? AND expires > ?', [id, Date.now()])
      .then(([rows]) => {
        if (!rows.length) return callback(null, null);
        const packed = Buffer.from(rows[0].payload, 'base64');
        const decipher = createDecipheriv('aes-256-gcm', this.key, packed.subarray(0, 12));
        decipher.setAuthTag(packed.subarray(12, 28));
        callback(null, JSON.parse(Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]).toString()));
      }).catch(callback);
  }
  set(id, value, callback = () => {}) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
    const payload = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
    const expires = new Date(value.cookie.expires).getTime();
    this.pool.execute('INSERT INTO dashboard_sessions (id, payload, expires) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE payload = VALUES(payload), expires = VALUES(expires)', [id, payload, expires])
      .then(() => callback()).catch(callback);
  }
  destroy(id, callback = () => {}) {
    this.pool.execute('DELETE FROM dashboard_sessions WHERE id = ?', [id]).then(() => callback()).catch(callback);
  }
}
