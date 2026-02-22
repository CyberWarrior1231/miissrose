// src/handlers/relayHandler.js
const RelaySettings = require('../models/RelaySettings');
const RelayMessageMap = require('../models/RelayMessageMap');
const { ownerId, relayAdminIds } = require('../config');

function isGroupChat(ctx) {
  return ['group', 'supergroup'].includes(ctx.chat?.type);
}

function isPrivateChat(ctx) {
  return ctx.chat?.type === 'private';
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

function isOwner(userId) {
  return Boolean(ownerId) && userId === ownerId;
}

async function storeRelayMapping(forwarded, sourceChatId, sourceMessageId) {
  if (!forwarded?.chat?.id || !forwarded?.message_id) return;

  await RelayMessageMap.findOneAndUpdate(
    {
      relayChatId: forwarded.chat.id,
      relayMessageId: forwarded.message_id
    },
    {
      relayChatId: forwarded.chat.id,
      relayMessageId: forwarded.message_id,
      originalChatId: sourceChatId,
      originalMessageId: sourceMessageId
    },
    { upsert: true, setDefaultsOnInsert: true }
  ).catch(() => {});
}

const lastRelayGroupByTarget = new Map();

function buildRelayHeader(ctx) {
  const groupTitle = ctx.chat?.title
    || [ctx.chat?.first_name, ctx.chat?.last_name].filter(Boolean).join(' ')
    || 'Unknown Group';
  const groupId = ctx.chat?.id || 'Unknown';
   return `📍 ${groupTitle} (${groupId})`;
}

function senderName(ctx) {
  return [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ')
    || (ctx.from?.username ? `@${ctx.from.username}` : 'Unknown');
}

function messageBody(ctx) {
  return (ctx.message?.text || ctx.message?.caption || '').trim() || '[Non-text message]';
}

function hasBotMention(ctx) {
  const entities = [
    ...(ctx.message?.entities || []),
    ...(ctx.message?.caption_entities || [])
  ];
  const text = ctx.message?.text || ctx.message?.caption || '';
  const botUsername = ctx.botInfo?.username;

  return entities.some((entity) => {
    if (entity.type === 'text_mention') {
      return entity.user?.id === ctx.botInfo?.id;
    }

    if (entity.type === 'mention' && botUsername) {
      const mention = text.slice(entity.offset, entity.offset + entity.length);
      return mention.toLowerCase() === `@${botUsername.toLowerCase()}`;
    }

    return false;
  });
}

function messagePrefix(ctx) {
  if (ctx.message?.reply_to_message?.from?.id === ctx.botInfo?.id) return '↩️ Reply to bot\n';
  if (hasBotMention(ctx)) return '🔔 Bot mentioned\n';
  return '';
}

function buildRelayLine(ctx) {
  return `${messagePrefix(ctx)}${senderName(ctx)}: ${messageBody(ctx)}`;
}

async function mirrorGroupMessage(ctx) {
  const settings = await getRelaySettings();
  if (!settings.enabled || !ctx.message) return;

  const chatIsGroup = isGroupChat(ctx);
  const privateRelayEnabled = settings.mode === 'private';
  const shouldRelay = chatIsGroup || (privateRelayEnabled && isPrivateChat(ctx));
  if (!shouldRelay) return;
  
  const targets = settings.mode === 'channel' && settings.channelId ? [settings.channelId] : relayRecipients();
  if (!targets.length) return;

  const relayHeader = buildRelayHeader(ctx);
  const relayLine = buildRelayLine(ctx);
  const currentGroupId = ctx.chat?.id;
  
  for (const targetId of targets) {
    if (lastRelayGroupByTarget.get(targetId) !== currentGroupId) {
      // eslint-disable-next-line no-await-in-loop
      await ctx.telegram.sendMessage(targetId, relayHeader).catch(() => null);
      lastRelayGroupByTarget.set(targetId, currentGroupId);
    }
   
    // eslint-disable-next-line no-await-in-loop
    const forwarded = await ctx.telegram.forwardMessage(targetId, ctx.chat.id, ctx.message.message_id).catch(() => null);
    // eslint-disable-next-line no-await-in-loop
    await storeRelayMapping(forwarded, ctx.chat.id, ctx.message.message_id);
  }
}

async function handleRemoteReply(ctx) {
  if (!ctx.message?.reply_to_message || !ctx.from) return;
  if (!isOwner(ctx.from.id)) return;

  const relayChatId = ctx.chat?.id;
  const relayMessageId = ctx.message.reply_to_message.message_id;
  if (!relayChatId || !relayMessageId) return;

  const mapping = await RelayMessageMap.findOne({ relayChatId, relayMessageId });
  if (!mapping) return;

  if (ctx.message.text) {
    const rawText = ctx.message.text.trim();
    const textToSend = rawText.toLowerCase().startsWith('.relay')
      ? rawText.replace(/^\.relay\s*/i, '').trim()
      : rawText;

    if (!textToSend) return;

    await ctx.telegram.sendMessage(mapping.originalChatId, textToSend, { reply_to_message_id: mapping.originalMessageId }).catch(() => {});
    return;
  }

  if (ctx.message.photo) {
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    await ctx.telegram.sendPhoto(mapping.originalChatId, photo.file_id, {
      caption: ctx.message.caption,
      reply_to_message_id: mapping.originalMessageId
    }).catch(() => {});
    return;
  }

  if (ctx.message.video) {
    await ctx.telegram.sendVideo(mapping.originalChatId, ctx.message.video.file_id, {
      caption: ctx.message.caption,
      reply_to_message_id: mapping.originalMessageId
    }).catch(() => {});
    return;
  }

  if (ctx.message.voice) {
    await ctx.telegram.sendVoice(mapping.originalChatId, ctx.message.voice.file_id, {
      caption: ctx.message.caption,
      reply_to_message_id: mapping.originalMessageId
    }).catch(() => {});
    return;
  }

  if (ctx.message.document) {
    await ctx.telegram.sendDocument(mapping.originalChatId, ctx.message.document.file_id, {
      caption: ctx.message.caption,
      reply_to_message_id: mapping.originalMessageId
    }).catch(() => {});
    return;
  }

  if (ctx.message.sticker) {
    await ctx.telegram.sendSticker(mapping.originalChatId, ctx.message.sticker.file_id, {
      reply_to_message_id: mapping.originalMessageId
    }).catch(() => {});
    return;
  }

  if (ctx.message.animation) {
    await ctx.telegram.sendAnimation(mapping.originalChatId, ctx.message.animation.file_id, {
      caption: ctx.message.caption,
      reply_to_message_id: mapping.originalMessageId
    }).catch(() => {});
  }
}

module.exports = (bot) => {
  // Global relay handler - must run before command handlers.
  bot.on('message', async (ctx, next) => {
    if (!ctx.message || !ctx.chat) return next();
    if (ctx.message.from?.id === ctx.botInfo?.id) return next();

    if (isGroupChat(ctx)) {
      const settings = await getRelaySettings();
      if (settings.mode === 'channel' && settings.channelId && ctx.chat.id === settings.channelId) {
        await handleRemoteReply(ctx);
        return next();
      }

      await mirrorGroupMessage(ctx);
      return next();
    }

    await handleRemoteReply(ctx);
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
