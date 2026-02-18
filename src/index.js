const express = require('express');
const { port } = require('./config');
const { connectDb } = require('./utils/db');
const { createBot } = require('./bot');

async function start() {
  await connectDb();

  const app = express();
  app.get('/', (_req, res) => {
    res.status(200).json({ status: 'ok', service: 'miissrose-bot' });
  });
  app.get('/health', (_req, res) => {
    res.status(200).send('healthy');
  });

  app.listen(port, () => {
    console.log(`Express server listening on ${port}`);
  });

  const bot = createBot();
  await bot.launch({ dropPendingUpdates: true });
  console.log('Bot started in polling mode');

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

start().catch((err) => {
  console.error('Fatal startup error', err);
  process.exit(1);
});
