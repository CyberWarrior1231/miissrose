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
};
