const Log = require('../models/Log');

async function writeLog(ctx, group, action, payload = {}) {
  await Log.create({
    chatId: ctx.chat?.id || payload.chatId,
    action,
    actorId: ctx.from?.id || null,
    targetId: payload.targetId || null,
    metadata: payload
  });

  if (group?.logChannelId) {
    const lines = [
      `#${action}`,
      payload.reason ? `Reason: ${payload.reason}` : '',
      payload.targetId ? `Target: ${payload.targetId}` : '',
      ctx.chat ? `Group: ${ctx.chat.title} (${ctx.chat.id})` : ''
    ].filter(Boolean);

    await ctx.telegram.sendMessage(group.logChannelId, lines.join('\n')).catch(() => {});
  }
}

module.exports = { writeLog };
