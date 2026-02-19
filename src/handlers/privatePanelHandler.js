const { Markup } = require('telegraf');
const Group = require('../models/Group');
const User = require('../models/User');
const Filter = require('../models/Filter');
const { mentionUser } = require('../utils/permissions');
const { ownerId } = require('../config');

const dmState = new Map();

function isPrivate(ctx) {
  return ctx.chat?.type === 'private';
}

function isOwner(ctx) {
  return Boolean(ownerId) && ctx.from?.id === ownerId;
}

function ownerOnlyKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🛡 Moderation Help', 'dm:help')],
    [Markup.button.callback('⚙️ Settings', 'dm:settings')],
    [Markup.button.callback('📢 Broadcast', 'dm:broadcast')],
    [Markup.button.callback('📊 Bot Stats', 'dm:stats')]
  ]);
}

function userKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🛡 Moderation Help', 'dm:help')]
  ]);
}

function adminKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📢 Broadcast', 'dm:broadcast')],
    [Markup.button.callback('🎉 Welcome Message', 'dm:welcome')],
    [Markup.button.callback('⚙️ Settings', 'dm:settings')],
    [Markup.button.callback('📊 Bot Stats', 'dm:stats')]
  ]);
}

function broadcastDraftKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('👀 Preview', 'dm:broadcast_preview')],
    [Markup.button.callback('✅ Send', 'dm:broadcast_send')],
    [Markup.button.callback('❌ Cancel', 'dm:broadcast_cancel')]
  ]);
}

function ownerRestrictedReply(ctx) {
  return ctx.reply('⛔ This feature is restricted to the bot owner.');
}

async function getManagedGroups(ctx) {
  const groups = await Group.find().sort({ updatedAt: -1 }).limit(200);
  const managed = [];
  for (const group of groups) {
    // eslint-disable-next-line no-await-in-loop
    const member = await ctx.telegram.getChatMember(group.chatId, ctx.from.id).catch(() => null);
    if (member && ['administrator', 'creator'].includes(member.status)) managed.push(group);
  }
  return managed;
}

function formatWelcomePreview(template, user, groupTitle) {
  return template
    .replaceAll('{first}', user.first_name || 'Admin')
    .replaceAll('{username}', user.username ? `@${user.username}` : mentionUser(user))
    .replaceAll('{chat}', groupTitle)
    .replaceAll('{group}', groupTitle)
    .replaceAll('{user}', mentionUser(user));
}

module.exports = (bot) => {
  bot.start(async (ctx) => {
    if (!isPrivate(ctx)) return;
    
    await ctx.reply(
      [
        `✨ Welcome ${mentionUser(ctx.from)}`,
        '',
        'I’m ready to help you keep your communities safe and smooth.'
      ].join('\n'),
      {
        parse_mode: 'HTML',
        ...(isOwner(ctx) ? ownerOnlyKeyboard() : userKeyboard())
      }
    );
  });

  bot.command('help', async (ctx) => {
    if (!isPrivate(ctx)) return;
    await ctx.reply('🛡 Need a hand? Add me to your group and use moderation commands there anytime.');
  });

  bot.command('commands', async (ctx) => {
    if (!isPrivate(ctx)) return;
    await ctx.reply('🛡 Use /start here for quick access. All moderation actions work directly inside your groups.');
  });

  bot.command('admin', async (ctx) => {
    if (!isPrivate(ctx)) return;
    if (!isOwner(ctx)) return ownerRestrictedReply(ctx);

    const allGroupIds = (await Group.find({}, { chatId: 1 })).map((g) => g.chatId);
    dmState.set(ctx.from.id, { mode: 'idle', allGroupIds, broadcastDraft: '' });
    await ctx.reply('⚙️ Owner controls are ready.', adminKeyboard());
  });

  bot.action(/^dm:(help|settings|broadcast|welcome|stats|broadcast_preview|broadcast_send|broadcast_cancel)$/, async (ctx) => {
    if (!isPrivate(ctx)) return;
    const action = ctx.match[1];

    if (action === 'help') {
      await ctx.answerCbQuery();
      await ctx.reply('🛡 I can assist with bans, mutes, warnings, filters, welcomes, and more from your groups.');
      return;
    }

    if (!isOwner(ctx)) {
      await ctx.answerCbQuery('Owner only', { show_alert: true });
      await ownerRestrictedReply(ctx);
      return;
    }

    const allGroupIds = (await Group.find({}, { chatId: 1 })).map((g) => g.chatId);
    const current = dmState.get(ctx.from.id) || { mode: 'idle', broadcastDraft: '' };
    dmState.set(ctx.from.id, { ...current, allGroupIds });
    
    if (action === 'settings') {
      await ctx.answerCbQuery();
      const managed = await getManagedGroups(ctx);
      await ctx.reply(`⚙️ Settings\n\nConnected groups: ${managed.length}`);
      return;
    }

    if (action === 'stats') {
      await ctx.answerCbQuery();
      const usersTracked = await User.countDocuments({});
      const filters = await Filter.countDocuments({});
      await ctx.reply([
        '📊 Bot Stats',
        `• Groups: ${allGroupIds.length}`,
        `• Tracked members: ${usersTracked}`,
        `• Active filters: ${filters}`
      ].join('\n'));
      return;
    }

    
    if (action === 'welcome') {
      await ctx.answerCbQuery();
      dmState.set(ctx.from.id, { ...current, mode: 'await_welcome', allGroupIds });
      await ctx.reply('🎉 Send the new welcome text. Use {first}, {username}, and {group}.');
      return;
    }

    if (action === 'broadcast') {
      await ctx.answerCbQuery();
      dmState.set(ctx.from.id, { ...current, mode: 'await_broadcast', allGroupIds });
      await ctx.reply('📢 Send the message you want to broadcast.', broadcastDraftKeyboard());
      return;
    }

    if (action === 'broadcast_preview') {
      await ctx.answerCbQuery();
      const state = dmState.get(ctx.from.id);
      if (!state?.broadcastDraft) {
        await ctx.reply('⚠️ No draft yet. Send a message first.');
        return;
      }
      await ctx.reply('👀 Broadcast Preview');
      await ctx.reply(state.broadcastDraft);
      return;
    }

  if (action === 'broadcast_cancel') {
      await ctx.answerCbQuery();
      dmState.set(ctx.from.id, { mode: 'idle', allGroupIds, broadcastDraft: '' });
      await ctx.reply('✅ Broadcast canceled.');
      return;
    }

    if (action === 'broadcast_send') {
      await ctx.answerCbQuery();
      const state = dmState.get(ctx.from.id);
      if (!state?.broadcastDraft) {
        await ctx.reply('⚠️ No draft ready. Send a message first.');
        return;
      }

      let delivered = 0;
      for (const chatId of state.allGroupIds || []) {
        // eslint-disable-next-line no-await-in-loop
        const sent = await ctx.telegram.sendMessage(chatId, state.broadcastDraft).then(() => true).catch(() => false);
        if (sent) delivered += 1;
      }

      dmState.set(ctx.from.id, { mode: 'idle', allGroupIds, broadcastDraft: '' });
      await ctx.reply(`✅ Broadcast sent to ${delivered}/${(state.allGroupIds || []).length} groups.`);
      await ctx.telegram.sendMessage(ctx.from.id, `📝 Broadcast log\nDelivered: ${delivered}/${(state.allGroupIds || []).length}`);
    }
  });

  bot.on('text', async (ctx, next) => {
    if (!isPrivate(ctx)) return next();

    const state = dmState.get(ctx.from.id);
    if (!state || !state.mode || state.mode === 'idle') return next();

    if (!isOwner(ctx)) {
      dmState.delete(ctx.from.id);
      await ownerRestrictedReply(ctx);
      return;
    }

    if (state.mode === 'await_welcome') {
      const template = ctx.message.text.trim();
      if (!template) {
        await ctx.reply('⚠️ Please send a welcome message.');
        return;
      }

      await Group.updateMany(
        { chatId: { $in: state.allGroupIds || [] } },
        { $set: { welcomeMessage: template, welcomeEnabled: true } }
      );

      const preview = formatWelcomePreview(template, ctx.from, 'Example Group');
      dmState.set(ctx.from.id, { ...state, mode: 'idle' });
      await ctx.reply('✅ Welcome message refreshed. Preview:');
      await ctx.reply(preview, { parse_mode: 'HTML' });
      return;
    }

    if (state.mode === 'await_broadcast') {
      const message = ctx.message.text.trim();
      if (!message) {
        await ctx.reply('⚠️ Please send a valid message.');
        return;
      }

      dmState.set(ctx.from.id, { ...state, broadcastDraft: message });
      await ctx.reply('✅ Draft saved. You can preview, send, or cancel.', broadcastDraftKeyboard());
      return;
    }
   
    return next();
  });
};
