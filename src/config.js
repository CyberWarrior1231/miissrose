const dotenv = require('dotenv');

dotenv.config();

module.exports = {
  botToken: process.env.BOT_TOKEN,
  mongoUri: process.env.MONGO_URI,
  port: Number(process.env.PORT || 3000),
  botUsername: process.env.BOT_USERNAME || '',
  defaultWarningLimit: Number(process.env.WARNING_LIMIT || 3),
  captchaTimeoutSeconds: Number(process.env.CAPTCHA_TIMEOUT_SECONDS || 120),
  floodWindowMs: Number(process.env.FLOOD_WINDOW_MS || 8000),
  floodMessageLimit: Number(process.env.FLOOD_MESSAGE_LIMIT || 6),
  ownerId: Number(process.env.OWNER_ID || 0)
};
