const { Markup } = require('telegraf');
const Group = require('../models/Group');
const User = require('../models/User');
const Filter = require('../models/Filter');
const { mentionUser } = require('../utils/permissions');

const dmState = new Map();

function isPrivate(ctx) {
  return ctx.chat?.type === 'private';
}

function privateMainKeyboard(isAdminUser) {
  const rows = [
    [Markup.button.callback('❓ Help', 'dm:help'), Markup.button.callback('📚 Commands', 'dm:commands')]
  ];
  if (isAdminUser) rows.push([Markup.button.callback('🛡 Admin Panel', 'dm:admin')]);
  return Markup.inlineKeyboard(rows);
}

function adminKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📣 Broadcast', 'dm:broadcast')],
    [Markup.button.callback('🎉 Edit Welcome Message', 'dm:welcome')],
    [Markup.button.callback('🧠 Toggle Filters', 'dm:filters')],
    [Markup.button.callback('📊 View Stats', 'dm:stats')]
  ]);
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
    const managed = await getManagedGroups(ctx);
    const isAdminUser = managed.length > 0;

    await ctx.reply(
      `🌹 Welcome ${mentionUser(ctx.from)}\n\nI can help you manage your groups in MissRose style.`,
      {
        parse_mode: 'HTML',
        ...privateMainKeyboard(isAdminUser)
      }
    );
  });

  bot.command('help', async (ctx) => {
    if (!isPrivate(ctx)) return;
    await ctx.reply('🤝 Use /commands for available commands or open the Admin Panel to manage your groups.');
  });

  bot.command('commands', async (ctx) => {
    if (!isPrivate(ctx)) return;
    await ctx.reply(
      [
        '📚 Commands',
        '• /start - Open DM home',
        '• /help - Quick guidance',
        '• /commands - Show this list',
        '• /admin - Open private admin panel',
        '',
        'Group moderation commands stay in groups only (example: .ban, .mute, .warn, .lock).'
      ].join('\n')
    );
  });

  bot.command('admin', async (ctx) => {
    if (!isPrivate(ctx)) return;
    const managed = await getManagedGroups(ctx);
    if (!managed.length) {
      await ctx.reply('🚫 You are not an admin in any tracked group yet.');
      return;
    }

    const allGroupIds = (await Group.find({}, { chatId: 1 })).map((g) => g.chatId);
    dmState.set(ctx.from.id, { mode: 'idle', managedGroupIds: managed.map((g) => g.chatId), allGroupIds });
    await ctx.reply('🛡 Admin Panel\nChoose an action:', adminKeyboard());
  });

  bot.action(/^dm:(help|commands|admin|broadcast|welcome|filters|stats)$/, async (ctx) => {
    if (!isPrivate(ctx)) return;
    const action = ctx.match[1];

    if (action === 'help') {
      await ctx.answerCbQuery();
      await ctx.reply('🤝 Need help? Use /commands or open Admin Panel for advanced group controls.');
      return;
    }

    if (action === 'commands') {
      await ctx.answerCbQuery();
      await ctx.reply('📚 Quick commands: /start, /help, /commands, /admin\nModeration commands work only in groups.');
      return;
    }

    const managed = await getManagedGroups(ctx);
    if (!managed.length) {
      await ctx.answerCbQuery('No managed groups found.', { show_alert: true });
      return;
    }

    const allGroupIds = (await Group.find({}, { chatId: 1 })).map((g) => g.chatId);
    dmState.set(ctx.from.id, { mode: 'idle', managedGroupIds: managed.map((g) => g.chatId), allGroupIds });

    if (action === 'admin') {
      await ctx.answerCbQuery();
      await ctx.reply('🛡 Admin Panel\nChoose an action:', adminKeyboard());
      return;
    }

    if (action === 'broadcast') {
      await ctx.answerCbQuery();
      dmState.set(ctx.from.id, { mode: 'await_broadcast', managedGroupIds: managed.map((g) => g.chatId), allGroupIds });
      await ctx.reply('📣 Send the broadcast message now. It will be sent to all managed groups.');
      return;
    }

    if (action === 'welcome') {
      await ctx.answerCbQuery();
      dmState.set(ctx.from.id, { mode: 'await_welcome', managedGroupIds: managed.map((g) => g.chatId) });
      await ctx.reply('🎉 Send new welcome template for your groups. Variables: {first} {username} {chat}.\nUse [Button Text](https://example.com) on separate lines for buttons.');
      return;
    }

    if (action === 'filters') {
      await ctx.answerCbQuery();
      let updated = 0;
      for (const group of managed) {
        group.antiSpamEnabled = !group.antiSpamEnabled;
        // eslint-disable-next-line no-await-in-loop
        await group.save();
        updated += 1;
      }
      await ctx.reply(`🧠 Filters toggled for ${updated} groups (anti-spam switched).`);
      return;
    }

    if (action === 'stats') {
      await ctx.answerCbQuery();
      const groupIds = managed.map((g) => g.chatId);
      const usersTracked = await User.countDocuments({ chatId: { $in: groupIds } });
      const filters = await Filter.countDocuments({ chatId: { $in: groupIds } });
      await ctx.reply(
        [
          '📊 Admin Stats',
          `• Managed groups: ${managed.length}`,
          `• Tracked users: ${usersTracked}`,
          `• Active filters: ${filters}`
        ].join('\n')
      );
    }
  });

  bot.on('text', async (ctx, next) => {
    if (!isPrivate(ctx)) return next();

    const state = dmState.get(ctx.from.id);
    if (!state || !state.mode || state.mode === 'idle') return next();

    if (state.mode === 'await_broadcast') {
      const message = ctx.message.text.trim();
      if (!message) {
        await ctx.reply('⚠️ Empty broadcast ignored. Send plain text to continue.');
        return;
      }

      let delivered = 0;
      for (const chatId of state.allGroupIds || []) {
        // eslint-disable-next-line no-await-in-loop
        const sent = await ctx.telegram.sendMessage(chatId, `📣 Broadcast\n\n${message}`).then(() => true).catch(() => false);
        if (sent) delivered += 1;
      }

      dmState.set(ctx.from.id, { ...state, mode: 'idle' });
      await ctx.reply(`✅ Broadcast delivered to ${delivered}/${(state.allGroupIds || []).length} groups.`);
      return;
    }

    if (state.mode === 'await_welcome') {
      const template = ctx.message.text.trim();
      if (!template) {
        await ctx.reply('⚠️ Welcome template cannot be empty. Please send text with variables.');
        return;
      }

      await Group.updateMany(
        { chatId: { $in: state.managedGroupIds || [] } },
        { $set: { welcomeMessage: template, welcomeEnabled: true } }
      );

      const preview = formatWelcomePreview(template, ctx.from, 'Example Group');
      dmState.set(ctx.from.id, { ...state, mode: 'idle' });
      await ctx.reply('✅ Welcome message updated for your managed groups. Preview below:', { parse_mode: 'HTML' });
      await ctx.reply(preview, { parse_mode: 'HTML' });
      return;
    }

    return next();
  });
};
