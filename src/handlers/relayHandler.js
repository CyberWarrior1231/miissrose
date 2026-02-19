const RelaySettings = require('../models/RelaySettings');
const { ownerId, relayAdminIds } = require('../config');

function isGroupChat(ctx) {
  return ['group', 'supergroup'].includes(ctx.chat?.type);
}

function isRelayAdmin(userId) {
  if (!userId) return false;
  if (ownerId && userId === ownerId) return true;
  return relayAdminIds.includes(userId);
}

function relayRecipients() {
  const recipients = new Set();
  if (ownerId) recipients.add(ownerId);
  for (const adminId of relayAdminIds) recipients.add(adminId);
  return [...recipients];
}

async function getRelaySettings() {
  let settings = await RelaySettings.findOne({ key: 'global' });
  if (!settings) settings = await RelaySettings.create({ key: 'global' });
  return settings;
}

function timestampLabel(date = new Date()) {
  const iso = date.toISOString();
  return iso.replace('T', ' ').replace('Z', ' UTC');
}

function messageType(message) {
  if (message.text) return 'Text';
  if (message.photo) return 'Photo';
  if (message.video) return 'Video';
  if (message.voice) return 'Voice';
  if (message.audio) return 'Audio';
  if (message.document) return 'Document';
  if (message.sticker) return 'Sticker';
  if (message.video_note) return 'Video note';
  if (message.animation) return 'Animation';
  if (message.poll) return 'Poll';
  if (message.contact) return 'Contact';
  if (message.location) return 'Location';
  return 'Other';
}

function contentLabel(message) {
  if (message.text) return message.text;
  if (message.caption) return `${message.caption} [${messageType(message)}]`;
  return messageType(message);
}

function relayHeader(ctx) {
  const user = ctx.from || {};
  const username = user.username ? `@${user.username}` : 'no_username';
  const replyContext = ctx.message.reply_to_message
    ? `\n↪️ Reply To Message ID: ${ctx.message.reply_to_message.message_id}`
    : '';

  return [
    '--------------------------------',
    `👤 Sender: ${user.first_name || 'Unknown'} (${username})`,
    `🆔 User ID: ${user.id || 'Unknown'}`,
    `💬 Content: ${contentLabel(ctx.message)}`,
    `📍 Group: ${ctx.chat?.title || 'Unknown Group'}`,
    `🆔 Group ID: ${ctx.chat?.id || 'Unknown'}`,
    `🕒 Time: ${timestampLabel(ctx.message?.date ? new Date(ctx.message.date * 1000) : new Date())}${replyContext}`,
    '',
    `[Internal Message ID: ${ctx.message?.message_id}]`,
    '--------------------------------'
  ].join('\n');
}

function extractRelayPointer(replyText = '') {
  const chatMatch = replyText.match(/🆔 Group ID:\s*(-?\d+)/);
  const messageMatch = replyText.match(/\[Internal Message ID:\s*(\d+)]/);
  if (!chatMatch || !messageMatch) return null;
  return { chatId: Number(chatMatch[1]), messageId: Number(messageMatch[1]) };
}

async function sendMirroredMessage(telegram, targetId, message, header) {
  if (message.text) {
    return telegram.sendMessage(targetId, header, { disable_web_page_preview: true }).catch(() => null);
  }

  if (message.photo) {
    const photo = message.photo[message.photo.length - 1];
    return telegram.sendPhoto(targetId, photo.file_id, { caption: header }).catch(() => null);
  }

  if (message.video) {
    return telegram.sendVideo(targetId, message.video.file_id, { caption: header }).catch(() => null);
  }

  if (message.document) {
    return telegram.sendDocument(targetId, message.document.file_id, { caption: header }).catch(() => null);
  }

  if (message.voice) {
    return telegram.sendVoice(targetId, message.voice.file_id, { caption: header }).catch(() => null);
  }

  if (message.audio) {
    return telegram.sendAudio(targetId, message.audio.file_id, { caption: header }).catch(() => null);
  }

  if (message.animation) {
    return telegram.sendAnimation(targetId, message.animation.file_id, { caption: header }).catch(() => null);
  }

  if (message.video_note) {
    const sent = await telegram.sendVideoNote(targetId, message.video_note.file_id).catch(() => null);
    if (sent?.message_id) {
      await telegram.sendMessage(targetId, header, { reply_to_message_id: sent.message_id, disable_web_page_preview: true }).catch(() => {});
    }
    return sent;
  }

  if (message.sticker) {
    const sent = await telegram.sendSticker(targetId, message.sticker.file_id).catch(() => null);
    if (sent?.message_id) {
      await telegram.sendMessage(targetId, header, { reply_to_message_id: sent.message_id, disable_web_page_preview: true }).catch(() => {});
    }
    return sent;
  }

  return telegram.sendMessage(targetId, header, { disable_web_page_preview: true }).catch(() => null);
}

async function mirrorToTargets(ctx, settings) {
  const header = relayHeader(ctx);
  const targets = settings.mode === 'channel' && settings.channelId ? [settings.channelId] : relayRecipients();

  for (const targetId of targets) {
    // eslint-disable-next-line no-await-in-loop
    await sendMirroredMessage(ctx.telegram, targetId, ctx.message, header);
  }
}

async function handleRemoteReply(ctx) {
  if (!isRelayAdmin(ctx.from?.id)) return;
  if (!ctx.message?.reply_to_message) return;

  const pointerSource = [ctx.message.reply_to_message.text, ctx.message.reply_to_message.caption].filter(Boolean).join('\n');
  const pointer = extractRelayPointer(pointerSource);
  if (!pointer) return;

  if (ctx.message.text) {
    await ctx.telegram.sendMessage(pointer.chatId, ctx.message.text, { reply_to_message_id: pointer.messageId }).catch(() => {});
    return;
  }

  if (ctx.message.photo) {
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    await ctx.telegram.sendPhoto(pointer.chatId, photo.file_id, { caption: ctx.message.caption, reply_to_message_id: pointer.messageId }).catch(() => {});
    return;
  }

  if (ctx.message.video) {
    await ctx.telegram.sendVideo(pointer.chatId, ctx.message.video.file_id, { caption: ctx.message.caption, reply_to_message_id: pointer.messageId }).catch(() => {});
    return;
  }

  if (ctx.message.document) {
    await ctx.telegram.sendDocument(pointer.chatId, ctx.message.document.file_id, { caption: ctx.message.caption, reply_to_message_id: pointer.messageId }).catch(() => {});
    return;
  }

  if (ctx.message.voice) {
    await ctx.telegram.sendVoice(pointer.chatId, ctx.message.voice.file_id, { caption: ctx.message.caption, reply_to_message_id: pointer.messageId }).catch(() => {});
    return;
  }

  if (ctx.message.sticker) {
    await ctx.telegram.sendSticker(pointer.chatId, ctx.message.sticker.file_id, { reply_to_message_id: pointer.messageId }).catch(() => {});
  }
}

module.exports = (bot) => {
  bot.on('message', async (ctx, next) => {
    if (!ctx.message || !ctx.chat) return next();
    if (ctx.message.from?.id === ctx.botInfo?.id) return next();

    if (isGroupChat(ctx)) {
      const settings = await getRelaySettings();
      if (settings.enabled) await mirrorToTargets(ctx, settings);
      return next();
    }

    if (['private', 'channel', 'supergroup'].includes(ctx.chat.type)) {
      await handleRemoteReply(ctx);
    }

    return next();
  });

  bot.on('text', async (ctx, next) => {
    const text = (ctx.message?.text || '').trim();
    if (!text.toLowerCase().startsWith('.relay')) return next();

    if (ctx.from?.id !== ownerId) {
      await ctx.reply('⛔ Relay controls are owner-only.');
      return;
    }

    const settings = await getRelaySettings();
    const parts = text.split(/\s+/);
    const action = (parts[1] || '').toLowerCase();

    if (action === 'on') {
      settings.enabled = true;
      await settings.save();
      await ctx.reply('✅ Relay is now enabled.');
      return;
    }

    if (action === 'off') {
      settings.enabled = false;
      await settings.save();
      await ctx.reply('✅ Relay is now disabled.');
      return;
    }

    if (action === 'private') {
      settings.mode = 'private';
      settings.channelId = null;
      await settings.save();
      await ctx.reply('✅ Relay destination set to private owner/admin inbox.');
      return;
    }

    if (action === 'channel') {
      const channelId = Number(parts[2]);
      if (Number.isNaN(channelId)) {
        await ctx.reply('⚠️ Usage: .relay channel <channel_id>');
        return;
      }
      settings.mode = 'channel';
      settings.channelId = channelId;
      await settings.save();
      await ctx.reply(`✅ Relay destination set to channel/group: ${channelId}`);
      return;
    }

    await ctx.reply([
      '⚙️ Relay Controls',
      `• Status: ${settings.enabled ? 'ON' : 'OFF'}`,
      `• Mode: ${settings.mode}`,
      `• Channel ID: ${settings.channelId || 'not set'}`,
      '',
      'Commands:',
      '.relay on',
      '.relay off',
      '.relay private',
      '.relay channel <channel_id>'
    ].join('\n'));
  });
};
