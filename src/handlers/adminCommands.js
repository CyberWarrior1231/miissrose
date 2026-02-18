const { Markup } = require('telegraf');
const User = require('../models/User');
const Filter = require('../models/Filter');
const { isAdmin, parseDuration, mentionUser } = require('../utils/permissions');
const { writeLog } = require('../utils/logger');
const { defaultWarningLimit, captchaTimeoutSeconds } = require('../config');

const supportedLocks = ['stickers', 'gifs', 'photos', 'videos', 'links', 'voice', 'documents', 'polls'];

function parseCommand(text = '') {
  const [cmd, ...args] = text.trim().split(/\s+/);
  return { cmd: cmd.toLowerCase(), args };
}

function templateMessage(text, ctx, user) {
  return text
    .replaceAll('{user}', user ? mentionUser(user) : '')
    .replaceAll('{first}', user?.first_name || user?.firstName || 'there')
    .replaceAll('{username}', user?.username ? `@${user.username}` : mentionUser(user || { id: 0, first_name: 'user' }))
    .replaceAll('{group}', ctx.chat.title || 'this group')
    .replaceAll('{chat}', ctx.chat.title || 'this group');
}

function parseWelcomeButtons(raw = '') {
  const lines = raw.split('\n').map((line) => line.trim()).filter(Boolean);
  const buttons = [];
  for (const line of lines) {
    const match = line.match(/^\[([^\]]+)]\((https?:\/\/[^\s)]+)\)$/i);
    if (match) buttons.push(Markup.button.url(match[1], match[2]));
  }
  return buttons.length ? Markup.inlineKeyboard(buttons.map((btn) => [btn])) : null;
}

function styledActionMessage({ title, user, duration, chatName, admin, detail }) {
  const lines = [title, `👤 ${user}`, `📍 Chat: ${chatName}`, `🛡 By: ${admin}`];
  if (duration) lines.splice(2, 0, `⏱ Duration: ${duration}`);
  if (detail) lines.push(detail);
  return lines.join('\n');
}

async function resolveTarget(ctx, args) {
  if (ctx.message.reply_to_message?.from) return ctx.message.reply_to_message.from;
  if (!args[0]) return null;
  const id = Number(args[0]);
  if (!Number.isNaN(id)) return { id, first_name: String(id) };
  return null;
}

function commandUsage(cmd) {
  const usageMap = {
    '.ban': 'Usage: .ban [reply/user_id]',
    '.unban': 'Usage: .unban [user_id]',
    '.kick': 'Usage: .kick [reply/user_id]',
    '.promote': 'Usage: .promote [reply/user_id] [role]',
    '.demote': 'Usage: .demote [reply/user_id]',
    '.pin': 'Usage: Reply to a message with .pin',
    '.unpin': 'Usage: Reply to a message with .unpin',
    '.mute': 'Usage: .mute [reply/user_id] [1m|1h|1d] (duration optional)',
    '.unmute': 'Usage: .unmute [reply/user_id]',
    '.warn': 'Usage: .warn [reply/user_id]',
    '.warnings': 'Usage: .warnings [reply/user_id]',
    '.purge': 'Usage: .purge [reply to first message]',
    '.del': 'Usage: .del [reply]',
    '.lock': `Usage: .lock [${supportedLocks.join('|')}]`,
    '.unlock': `Usage: .unlock [${supportedLocks.join('|')}]`,
    '.delservice': 'Usage: .delservice [on/off]',
    '.keepservice': 'Usage: .keepservice [service_type]',
    '.settitle': 'Usage: .settitle [new_title]',
    '.welcome': 'Usage: .welcome [on/off] [message]',
    '.goodbye': 'Usage: .goodbye [on/off] [message]',
    '.filter': 'Usage: .filter [trigger] [response]',
    '.stop': 'Usage: .stop [trigger]',
    '.setlog': 'Usage: .setlog [channel_id]',
    '.whitelist': 'Usage: .whitelist [reply/user_id]',
    '.unwhitelist': 'Usage: .unwhitelist [reply/user_id]'
  };
  return usageMap[cmd] || 'Please check your command format and try again.';
}

async function ensureAdmin(ctx) {
  if (!(await isAdmin(ctx))) {
    await ctx.reply('🚫 This command is for group admins only.');
    return false;
  }
  return true;
}

function scheduleCaptchaKick(ctx, group, userId) {
  setTimeout(async () => {
    const state = await User.findOne({ chatId: ctx.chat.id, userId });
    if (state?.verificationPending) {
      await ctx.telegram.banChatMember(ctx.chat.id, userId).catch(() => {});
      await ctx.telegram.unbanChatMember(ctx.chat.id, userId).catch(() => {});
      await writeLog(ctx, group, 'captcha_timeout_kick', { targetId: userId });
    }
  }, captchaTimeoutSeconds * 1000);
}

module.exports = (bot) => {
  bot.on('text', async (ctx, next) => {
    const text = ctx.message.text || '';

    if (!ctx.group || !text.startsWith('.')) return next();

    const { cmd, args } = parseCommand(text);

    if (cmd === '.verify') return next();

    const adminOnlyCommands = [
      '.ban', '.unban', '.kick', '.promote', '.demote', '.roles', '.pin', '.unpin', '.vc', '.mute', '.unmute',
      '.warn', '.warnings', '.purge', '.del', '.lock', '.unlock', '.admins', '.bots', '.users', '.zombies',
      '.delservice', '.keepservice', '.servicestatus', '.settitle', '.restoretitle', '.welcome', '.goodbye',
      '.filter', '.filters', '.stop', '.setlog', '.clearlog', '.whitelist', '.unwhitelist'
    ];

    if (adminOnlyCommands.includes(cmd) && !(await ensureAdmin(ctx))) return;

    const actor = mentionUser(ctx.from);
    const chatName = ctx.chat.title || 'this group';
    
    if (cmd === '.ban') {
      const target = await resolveTarget(ctx, args);
      if (!target) return ctx.reply(commandUsage(cmd));
      await ctx.banChatMember(target.id).catch(() => {});
      await ctx.reply(styledActionMessage({
        title: '🚫 User Banned',
        user: mentionUser(target),
        chatName,
        admin: actor
      }), { parse_mode: 'HTML' });
      await writeLog(ctx, ctx.group, 'ban', { targetId: target.id });
      return;
    }

    if (cmd === '.unban') {
      const id = Number(args[0]);
      if (!id) return ctx.reply(commandUsage(cmd));
      const target = { id, first_name: String(id) };
      await ctx.unbanChatMember(id).catch(() => {});
      await ctx.reply(styledActionMessage({
        title: '✅ User Unbanned',
        user: mentionUser(target),
        chatName,
        admin: actor
      }), { parse_mode: 'HTML' });
      await writeLog(ctx, ctx.group, 'unban', { targetId: id });
      return;
    }

    if (cmd === '.kick') {
      const target = await resolveTarget(ctx, args);
      if (!target) return ctx.reply(commandUsage(cmd));
      await ctx.banChatMember(target.id).catch(() => {});
      await ctx.unbanChatMember(target.id).catch(() => {});
      await ctx.reply(styledActionMessage({
        title: '👢 User Kicked',
        user: mentionUser(target),
        chatName,
        admin: actor
      }), { parse_mode: 'HTML' });
      await writeLog(ctx, ctx.group, 'kick', { targetId: target.id });
      return;
    }

    if (cmd === '.promote') {
      const target = await resolveTarget(ctx, args);
      const role = args.slice(1).join(' ') || undefined;
      if (!target) return ctx.reply(commandUsage(cmd));
      await ctx.promoteChatMember(target.id, {
        can_manage_chat: true,
        can_delete_messages: true,
        can_manage_video_chats: true,
        can_restrict_members: true,
        can_invite_users: true,
        can_pin_messages: true,
        can_change_info: false,
        can_post_stories: true,
        can_edit_stories: true,
        can_delete_stories: true
      }).catch(() => {});
      if (role) await ctx.setChatAdministratorCustomTitle(target.id, role).catch(() => {});
      await ctx.reply(styledActionMessage({
        title: '🆙 User Promoted',
        user: mentionUser(target),
        chatName,
        admin: actor,
        detail: role ? `🏷 Role: ${role}` : undefined
      }), { parse_mode: 'HTML' });
      return;
    }

    if (cmd === '.demote') {
      const target = await resolveTarget(ctx, args);
      if (!target) return ctx.reply(commandUsage(cmd));
      await ctx.promoteChatMember(target.id, {
        can_manage_chat: false,
        can_delete_messages: false,
        can_manage_video_chats: false,
        can_restrict_members: false,
        can_invite_users: false,
        can_pin_messages: false,
        can_change_info: false,
        can_post_stories: false,
        can_edit_stories: false,
        can_delete_stories: false
      }).catch(() => {});
      await ctx.reply(styledActionMessage({
        title: '🔽 User Demoted',
        user: mentionUser(target),
        chatName,
        admin: actor
      }), { parse_mode: 'HTML' });
      return;
    }

    if (cmd === '.roles') return ctx.reply('💡 Usage: .promote [reply/user_id] [role]\nRole sets a custom admin title.');

    if (cmd === '.pin') {
      if (!ctx.message.reply_to_message) return ctx.reply(commandUsage(cmd));
      await ctx.pinChatMessage(ctx.message.reply_to_message.message_id, { disable_notification: false }).catch(() => {});
      return ctx.reply(`📌 Message pinned by ${actor}`, { parse_mode: 'HTML' });
    }

    if (cmd === '.unpin') {
      if (!ctx.message.reply_to_message) return ctx.reply(commandUsage(cmd));
      await ctx.unpinChatMessage(ctx.message.reply_to_message.message_id).catch(() => {});
      return ctx.reply(`📍 Message unpinned by ${actor}`, { parse_mode: 'HTML' });
    }

    if (cmd === '.vc') {
      await ctx.telegram.callApi('createVideoChat', { chat_id: ctx.chat.id }).catch(async () => {
        await ctx.reply('⚠️ I could not start a voice chat here. Please check Telegram client/API support.');
      });
      return;
    }

    if (cmd === '.mute') {
      const target = await resolveTarget(ctx, args);
      if (!target) return ctx.reply(commandUsage(cmd));
      const duration = parseDuration(args[1]);
      const untilDate = duration ? Math.floor((Date.now() + duration * 1000) / 1000) : 0;

      await ctx.restrictChatMember(target.id, { can_send_messages: false }, { until_date: untilDate }).catch(() => {});
      await User.findOneAndUpdate(
        { chatId: ctx.chat.id, userId: target.id },
        { mutedUntil: duration ? new Date(Date.now() + duration * 1000) : null },
        { upsert: true }
      );

      await ctx.reply(styledActionMessage({
        title: '🔇 User Muted',
        user: mentionUser(target),
        duration: duration ? `${args[1]}` : 'until manually unmuted',
        chatName,
        admin: actor
      }), { parse_mode: 'HTML' });
      await writeLog(ctx, ctx.group, 'mute', { targetId: target.id, reason: duration ? `for ${duration}s` : 'indefinite' });
      return;
    }

    if (cmd === '.unmute') {
      const target = await resolveTarget(ctx, args);
      if (!target) return ctx.reply(commandUsage(cmd));
      
      await ctx.restrictChatMember(target.id, {
        can_send_messages: true,
        can_send_other_messages: true,
        can_send_polls: true,
        can_add_web_page_previews: true,
        can_invite_users: true
      }).catch(() => {});
      await User.findOneAndUpdate({ chatId: ctx.chat.id, userId: target.id }, { mutedUntil: null }, { upsert: true });

      await ctx.reply(styledActionMessage({
        title: '🔊 User Unmuted',
        user: mentionUser(target),
        chatName,
        admin: actor
      }), { parse_mode: 'HTML' });
      await writeLog(ctx, ctx.group, 'unmute', { targetId: target.id });
      return;
    }

    if (cmd === '.warn') {
      const target = await resolveTarget(ctx, args);
      if (!target) return ctx.reply(commandUsage(cmd));
      const user = await User.findOneAndUpdate(
        { chatId: ctx.chat.id, userId: target.id },
        { $inc: { warnings: 1 } },
        { upsert: true, new: true }
      );
     await ctx.reply(styledActionMessage({
        title: '⚠️ User Warned',
        user: mentionUser(target),
        chatName,
        admin: actor,
        detail: `📊 Warnings: ${user.warnings}/${defaultWarningLimit}`
      }), { parse_mode: 'HTML' });
      await writeLog(ctx, ctx.group, 'warn', { targetId: target.id, reason: `Count ${user.warnings}` });
      if (user.warnings >= defaultWarningLimit) {
        await ctx.banChatMember(target.id).catch(() => {});
        await ctx.unbanChatMember(target.id).catch(() => {});
        await User.updateOne({ chatId: ctx.chat.id, userId: target.id }, { warnings: 0 });
        await ctx.reply(`🚨 ${mentionUser(target)} reached the warning limit and was removed.`, { parse_mode: 'HTML' });
      }
      return;
    }

    if (cmd === '.warnings') {
      const target = await resolveTarget(ctx, args);
      if (!target) return ctx.reply(commandUsage(cmd));
      const user = await User.findOne({ chatId: ctx.chat.id, userId: target.id });
      return ctx.reply(`📊 Warnings for ${mentionUser(target)}: ${user?.warnings || 0}/${defaultWarningLimit}`, { parse_mode: 'HTML' });
    }

    if (cmd === '.purge') {
      if (!ctx.message.reply_to_message) return ctx.reply(commandUsage(cmd));
      const from = ctx.message.reply_to_message.message_id;
      const to = ctx.message.message_id;
      let deleted = 0;
      for (let i = from; i <= to; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        const ok = await ctx.deleteMessage(i).then(() => true).catch(() => false);
        if (ok) deleted += 1;
      }
      return ctx.reply(`🧹 Purged ${deleted} messages.`);
    }

    if (cmd === '.del') {
      if (!ctx.message.reply_to_message) return ctx.reply(commandUsage(cmd));
      await ctx.deleteMessage(ctx.message.reply_to_message.message_id).catch(() => {});
      await ctx.deleteMessage().catch(() => {});
      return;
    }

    if (cmd === '.lock' || cmd === '.unlock') {
      const lock = (args[0] || '').toLowerCase();
      if (!supportedLocks.includes(lock)) return ctx.reply(commandUsage(cmd));
      ctx.group.locks[lock] = cmd === '.lock';
      await ctx.group.save();
      await ctx.reply(styledActionMessage({
        title: `${cmd === '.lock' ? '🔒 Lock Enabled' : '🔓 Lock Disabled'}`,
        user: `Content: ${lock}`,
        chatName,
        admin: actor
      }), { parse_mode: 'HTML' });
      return;
    }

    if (cmd === '.admins') {
      const admins = await ctx.getChatAdministrators();
      const textOut = admins.map((a) => `• ${a.user.first_name} (${a.status})`).join('\n');
      return ctx.reply(`🛡 Group Admins:\n${textOut}`);
    }

    if (cmd === '.bots') {
      const users = await User.find({ chatId: ctx.chat.id, username: { $ne: '' } }).limit(500);
      const bots = users.filter((u) => u.username.endsWith('bot'));
      return ctx.reply(`🤖 Bots seen in group:\n${bots.map((b) => `• @${b.username}`).join('\n') || 'None'}`);
    }

    if (cmd === '.users') {
      const page = Number(args[0] || 1);
      const limit = 20;
      const users = await User.find({ chatId: ctx.chat.id }).sort({ updatedAt: -1 }).skip((page - 1) * limit).limit(limit);
      const total = await User.countDocuments({ chatId: ctx.chat.id });
      const lines = users.map((u) => `• ${u.firstName || u.userId} (${u.userId})`);
      return ctx.reply(`👥 Users page ${page}/${Math.max(1, Math.ceil(total / limit))}:\n${lines.join('\n') || 'No users tracked yet.'}`);
    }

    if (cmd === '.zombies') {
      const zombies = await User.find({ chatId: ctx.chat.id, isDeletedLikely: true });
      return ctx.reply(`🧟 Deleted accounts found: ${zombies.length}\n${zombies.map((z) => `• ${z.userId}`).join('\n') || 'None'}`);
    }

    if (cmd === '.delservice') {
      const state = (args[0] || '').toLowerCase();
      if (!['on', 'off'].includes(state)) return ctx.reply(commandUsage(cmd));
      ctx.group.serviceDeleteEnabled = state === 'on';
      await ctx.group.save();
      return ctx.reply(`🧰 Service message cleanup: ${state}`);
    }

    if (cmd === '.keepservice') {
      const t = (args[0] || '').toLowerCase();
      if (!t) return ctx.reply(commandUsage(cmd));
      if (!ctx.group.keepServiceTypes.includes(t)) ctx.group.keepServiceTypes.push(t);
      await ctx.group.save();
      return ctx.reply(`🛟 Keeping service type: ${t}`);
    }

    if (cmd === '.servicestatus') {
      return ctx.reply(`🧾 Service moderation\n• deletion: ${ctx.group.serviceDeleteEnabled ? 'on' : 'off'}\n• kept: ${ctx.group.keepServiceTypes.join(', ') || 'none'}`);
    }

    if (cmd === '.settitle') {
      const title = args.join(' ');
      if (!title) return ctx.reply(commandUsage(cmd));
      if (!ctx.group.originalTitle) ctx.group.originalTitle = ctx.chat.title;
      await ctx.setChatTitle(title).catch(() => {});
      ctx.group.title = title;
      await ctx.group.save();
      return ctx.reply(`📝 Group title updated to: ${title}`);
    }

    if (cmd === '.restoretitle') {
      if (!ctx.group.originalTitle) return ctx.reply('ℹ️ No original title is saved yet.');
      await ctx.setChatTitle(ctx.group.originalTitle).catch(() => {});
      return ctx.reply(`♻️ Restored title to ${ctx.group.originalTitle}`);
    }

    if (cmd === '.welcome') {
      const state = (args[0] || '').toLowerCase();
      if (!['on', 'off'].includes(state)) return ctx.reply(commandUsage(cmd));
      ctx.group.welcomeEnabled = state === 'on';
      if (args.slice(1).length) ctx.group.welcomeMessage = args.slice(1).join(' ');
      await ctx.group.save();
      await ctx.reply(styledActionMessage({
        title: `🎉 Welcome ${state === 'on' ? 'Enabled' : 'Disabled'}`,
        user: 'New members',
        chatName,
        admin: actor
      }), { parse_mode: 'HTML' });
      return;
    }

    if (cmd === '.goodbye') {
      const state = (args[0] || '').toLowerCase();
      if (!['on', 'off'].includes(state)) return ctx.reply(commandUsage(cmd));
      ctx.group.goodbyeEnabled = state === 'on';
      if (args.slice(1).length) ctx.group.goodbyeMessage = args.slice(1).join(' ');
      await ctx.group.save();
      return ctx.reply(`👋 Goodbye messages: ${state}`);
    }

    if (cmd === '.filter') {
      const trigger = (args[0] || '').toLowerCase();
      const response = args.slice(1).join(' ');
      if (!trigger || !response) return ctx.reply(commandUsage(cmd));
      await Filter.findOneAndUpdate({ chatId: ctx.chat.id, trigger }, { response }, { upsert: true });
      await ctx.reply(styledActionMessage({
        title: '🧠 Filter Saved',
        user: trigger,
        chatName,
        admin: actor,
        detail: `💬 Reply: ${response}`
      }), { parse_mode: 'HTML' });
      return;
    }

    if (cmd === '.filters') {
      const filters = await Filter.find({ chatId: ctx.chat.id }).sort({ trigger: 1 });
      return ctx.reply(`🧠 Active Filters:\n${filters.map((f) => `• ${f.trigger}`).join('\n') || 'No filters configured.'}`);
    }

    if (cmd === '.stop') {
      const trigger = (args[0] || '').toLowerCase();
      if (!trigger) return ctx.reply(commandUsage(cmd));
      await Filter.deleteOne({ chatId: ctx.chat.id, trigger });
      return ctx.reply(`🧹 Filter removed: ${trigger}`);
    }

    if (cmd === '.setlog') {
      const id = Number(args[0]);
      if (!id) return ctx.reply(commandUsage(cmd));
      ctx.group.logChannelId = id;
      await ctx.group.save();
      return ctx.reply(`📒 Log channel set to ${id}`);
    }

    if (cmd === '.clearlog') {
      ctx.group.logChannelId = null;
      await ctx.group.save();
      return ctx.reply('🗑 Log channel removed.');
    }

    if (cmd === '.whitelist' || cmd === '.unwhitelist') {
      const target = await resolveTarget(ctx, args);
      if (!target) return ctx.reply(commandUsage(cmd));
      const isAdd = cmd === '.whitelist';
      if (isAdd && !ctx.group.whitelistUsers.includes(target.id)) ctx.group.whitelistUsers.push(target.id);
      if (!isAdd) ctx.group.whitelistUsers = ctx.group.whitelistUsers.filter((id) => id !== target.id);
      await ctx.group.save();
      await User.findOneAndUpdate({ chatId: ctx.chat.id, userId: target.id }, { isWhitelisted: isAdd }, { upsert: true });
      return ctx.reply(`${isAdd ? '✅ Whitelisted' : '❎ Removed from whitelist'} ${mentionUser(target)}`, { parse_mode: 'HTML' });
    }

    return ctx.reply('🤖 I do not recognize that command. Try /help in DM for command guidance.');
  });

  bot.on('new_chat_members', async (ctx) => {
    if (!ctx.group) return;
    for (const member of ctx.message.new_chat_members) {
      await User.findOneAndUpdate(
        { chatId: ctx.chat.id, userId: member.id },
        {
          username: member.username || '',
          firstName: member.first_name || '',
          lastName: member.last_name || '',
          verificationPending: false,
          verificationDeadline: null
        },
        { upsert: true }
      );

      if (ctx.group.captchaEnabled) {
        await ctx.restrictChatMember(member.id, { can_send_messages: false }).catch(() => {});
        await User.updateOne(
          { chatId: ctx.chat.id, userId: member.id },
          {
            verificationPending: true,
            verificationDeadline: new Date(Date.now() + captchaTimeoutSeconds * 1000)
          }
        );
        await ctx.reply(
          `✅ Verification required for ${mentionUser(member)}. Please verify within ${captchaTimeoutSeconds}s.`,
          {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([
              Markup.button.callback('✅ Verify', `verify:${ctx.chat.id}:${member.id}`)
            ])
          }
        );
        scheduleCaptchaKick(ctx, ctx.group, member.id);
      }

      if (ctx.group.welcomeEnabled) {
        const welcomeText = templateMessage(ctx.group.welcomeMessage, ctx, member);
        const keyboard = parseWelcomeButtons(welcomeText);
        const cleaned = welcomeText
          .split('\n')
          .filter((line) => !line.trim().match(/^\[[^\]]+]\(https?:\/\/[^\s)]+\)$/i))
          .join('\n');
        await ctx.reply(cleaned, { parse_mode: 'HTML', ...(keyboard || {}) });
      }

      await writeLog(ctx, ctx.group, 'join', { targetId: member.id });
    }
  });

  bot.on('left_chat_member', async (ctx) => {
    if (!ctx.group) return;
    const member = ctx.message.left_chat_member;
    if (ctx.group.goodbyeEnabled) {
      await ctx.reply(templateMessage(ctx.group.goodbyeMessage, ctx, member), { parse_mode: 'HTML' });
    }
    await writeLog(ctx, ctx.group, 'leave', { targetId: member.id });
  });

  bot.action(/verify:(-?\d+):(\d+)/, async (ctx) => {
    const chatId = Number(ctx.match[1]);
    const userId = Number(ctx.match[2]);
    if (ctx.from.id !== userId) return ctx.answerCbQuery('This button is not for you.', { show_alert: true });

    const user = await User.findOne({ chatId, userId });
    if (!user?.verificationPending) return ctx.answerCbQuery('Already verified.');

    await ctx.telegram.restrictChatMember(chatId, userId, {
      can_send_messages: true,
      can_send_other_messages: true,
      can_send_polls: true,
      can_add_web_page_previews: true,
      can_invite_users: true
    }).catch(() => {});

    user.verificationPending = false;
    user.verificationDeadline = null;
    await user.save();

    await ctx.answerCbQuery('Verified!');
    await ctx.editMessageText('✅ User verified successfully.');
  });
};
