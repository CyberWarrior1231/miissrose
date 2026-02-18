const Filter = require('../models/Filter');

module.exports = (bot) => {
  bot.on('text', async (ctx, next) => {
    if (!ctx.group) return next();
    const text = (ctx.message.text || '').trim();
    if (!text || text.startsWith('.')) return next();

    const trigger = text.toLowerCase();
    const filter = await Filter.findOne({ chatId: ctx.chat.id, trigger });
    if (filter) {
      await ctx.reply(filter.response);
      return;
    }

    return next();
  });
};
