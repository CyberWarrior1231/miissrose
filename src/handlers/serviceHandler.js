const adminMentionCooldown = new Map();
const ADMIN_MENTION_COOLDOWN_MS = 45_000;

function hasAdminCall(text = '') {
  return /(^|\s)(@admin|\.admin|\/admin)(\s|$)/i.test(text);
}

function buildJumpLink(ctx) {
  if (ctx.chat.username) return `https://t.me/${ctx.chat.username}/${ctx.message.message_id}`;
  const internalId = String(ctx.chat.id).replace('-100', '');
  return `https://t.me/c/${internalId}/${ctx.message.message_id}`;
}

module.exports = (bot) => {
  bot.on('message', async (ctx, next) => {
    if (!ctx.group || !ctx.group.serviceDeleteEnabled) return next();

    const serviceTypes = [
      'new_chat_title',
      'new_chat_photo',
      'delete_chat_photo',
      'group_chat_created',
      'supergroup_chat_created',
      'new_chat_members',
      'left_chat_member',
      'pinned_message'
    ];

    const found = serviceTypes.find((type) => ctx.message[type] !== undefined);
    if (!found) return next();
    if (ctx.group.keepServiceTypes.includes(found)) return next();

    await ctx.deleteMessage().catch(() => {});
  });

  bot.on('text', async (ctx, next) => {
    if (!ctx.group) return next();
    const text = ctx.message.text || '';
    if (!hasAdminCall(text)) return next();

    const key = `${ctx.chat.id}:${ctx.from.id}`;
    const now = Date.now();
    const last = adminMentionCooldown.get(key) || 0;
    if (now - last < ADMIN_MENTION_COOLDOWN_MS) return next();
    adminMentionCooldown.set(key, now);

    const admins = await ctx.getChatAdministrators().catch(() => []);
    const jumpLink = buildJumpLink(ctx);
    const fromUser = ctx.from.username ? `@${ctx.from.username}` : (ctx.from.first_name || ctx.from.id);
    const report = [
      '🚨 Admin Mentioned',
      `👤 From: ${fromUser}`,
      `💬 Message: ${text}`,
      `📍 Group: ${ctx.chat.title || ctx.chat.id}`,
      `🔗 <a href="${jumpLink}">Jump to message</a>`
    ].join('\n');

    for (const admin of admins) {
      // eslint-disable-next-line no-await-in-loop
      await ctx.telegram.sendMessage(admin.user.id, report, { parse_mode: 'HTML', disable_web_page_preview: true }).catch(() => {});
    }

    return next();
  });
};
