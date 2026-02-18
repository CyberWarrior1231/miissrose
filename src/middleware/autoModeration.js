const User = require('../models/User');
const { writeLog } = require('../utils/logger');
const { floodWindowMs, floodMessageLimit } = require('../config');

const floodTracker = new Map();

function containsLink(text = '') {
  return /(https?:\/\/|t\.me\/|telegram\.me\/|www\.)/i.test(text);
}

module.exports = async (ctx, next) => {
  if (!ctx.group || !ctx.message || ctx.message.text?.startsWith('.')) return next();

  const from = ctx.from;
  if (!from) return next();

  const user = await User.findOneAndUpdate(
    { chatId: ctx.chat.id, userId: from.id },
    {
      username: from.username || '',
      firstName: from.first_name || '',
      lastName: from.last_name || '',
      isDeletedLikely: from.is_bot ? false : (from.first_name === 'Deleted Account')
    },
    { upsert: true, new: true }
  );

  if (ctx.group.whitelistUsers.includes(from.id) || user.isWhitelisted) return next();

  const text = ctx.message.text || ctx.message.caption || '';
  const lower = text.toLowerCase();

  if (ctx.group.antiLinkEnabled && containsLink(text)) {
    await ctx.deleteMessage().catch(() => {});
    await writeLog(ctx, ctx.group, 'anti_link_delete', { targetId: from.id, reason: 'Link blocked' });
    return;
  }

  if (ctx.group.badWords.some((w) => lower.includes(w.toLowerCase()))) {
    await ctx.deleteMessage().catch(() => {});
    await writeLog(ctx, ctx.group, 'badword_delete', { targetId: from.id, reason: 'Bad word detected' });
    return;
  }

  if (ctx.group.antiFloodEnabled) {
    const key = `${ctx.chat.id}:${from.id}`;
    const now = Date.now();
    const timestamps = (floodTracker.get(key) || []).filter((x) => now - x < floodWindowMs);
    timestamps.push(now);
    floodTracker.set(key, timestamps);

    if (timestamps.length > floodMessageLimit) {
      await ctx.deleteMessage().catch(() => {});
      await ctx.restrictChatMember(from.id, { can_send_messages: false }, { until_date: Math.floor((Date.now() + 5 * 60_000) / 1000) }).catch(() => {});
      await writeLog(ctx, ctx.group, 'anti_flood_mute', { targetId: from.id, reason: 'Flood detected' });
      return;
    }
  }

  if (ctx.group.antiSpamEnabled && text.length > 900) {
    await ctx.deleteMessage().catch(() => {});
    await writeLog(ctx, ctx.group, 'anti_spam_delete', { targetId: from.id, reason: 'Spam payload too long' });
    return;
  }

  const lockHit = (
    (ctx.group.locks.photos && ctx.message.photo) ||
    (ctx.group.locks.videos && ctx.message.video) ||
    (ctx.group.locks.documents && ctx.message.document) ||
    (ctx.group.locks.voice && (ctx.message.voice || ctx.message.audio)) ||
    (ctx.group.locks.polls && ctx.message.poll) ||
    (ctx.group.locks.stickers && ctx.message.sticker) ||
    (ctx.group.locks.gifs && (ctx.message.animation || (ctx.message.document && ctx.message.document.mime_type === 'video/mp4')))
  );

  if (lockHit) {
    await ctx.deleteMessage().catch(() => {});
    await writeLog(ctx, ctx.group, 'locked_content_delete', { targetId: from.id });
    return;
  }

  await next();
};
