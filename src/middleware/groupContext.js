const { getOrCreateGroup } = require('../utils/permissions');

module.exports = async (ctx, next) => {
  if (ctx.chat && ['group', 'supergroup'].includes(ctx.chat.type)) {
    ctx.group = await getOrCreateGroup(ctx.chat);
  }
  await next();
};
