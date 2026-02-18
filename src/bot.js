const { Telegraf } = require('telegraf');
const { botToken } = require('./config');
const groupContext = require('./middleware/groupContext');
const autoModeration = require('./middleware/autoModeration');
const registerAdminCommands = require('./handlers/adminCommands');
const registerFilterHandler = require('./handlers/filterHandler');
const registerServiceHandler = require('./handlers/serviceHandler');

if (!botToken) {
  throw new Error('BOT_TOKEN is required');
}

function createBot() {
  const bot = new Telegraf(botToken);

  bot.use(groupContext);
  bot.use(autoModeration);

  registerServiceHandler(bot);
  registerAdminCommands(bot);
  registerFilterHandler(bot);

  bot.catch((err, ctx) => {
    console.error('Bot error:', err, 'for update', ctx.updateType);
  });

  return bot;
}

module.exports = { createBot };
