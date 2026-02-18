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
    .replace('{user}', user ? mentionUser(user) : '')
    .replace('{group}', ctx.chat.title || 'this group');
}

async function resolveTarget(ctx, args) {
  if (ctx.message.reply_to_message?.from) return ctx.message.reply_to_message.from;
  if (!args[0]) return null;
  const id = Number(args[0]);
  if (!Number.isNaN(id)) {
    return { id, first_name: String(id) };
  }
  return null;
}

async function ensureAdmin(ctx) {
  if (!(await isAdmin(ctx))) {
    await ctx.reply('Admin-only command.');
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

    if (cmd === '.verify') {
      return next();
    }

    const adminOnlyCommands = [
      '.ban', '.unban', '.kick', '.promote', '.demote', '.roles', '.pin', '.unpin', '.vc', '.mute', '.unmute',
      '.warn', '.warnings', '.purge', '.del', '.lock', '.unlock', '.admins', '.bots', '.users', '.zombies',
      '.delservice', '.keepservice', '.servicestatus', '.settitle', '.restoretitle', '.welcome', '.goodbye',
      '.filter', '.filters', '.stop', '.setlog', '.clearlog', '.whitelist', '.unwhitelist'
    ];

    if (adminOnlyCommands.includes(cmd) && !(await ensureAdmin(ctx))) return;

    if (cmd === '.ban') {
      const target = await resolveTarget(ctx, args);
      if (!target) return ctx.reply('Usage: .ban [reply/user_id]');
      await ctx.banChatMember(target.id).catch(() => {});
      await ctx.reply(`Banned ${target.id}`);
      await writeLog(ctx, ctx.group, 'ban', { targetId: target.id });
      return;
    }

    if (cmd === '.unban') {
      const id = Number(args[0]);
      if (!id) return ctx.reply('Usage: .unban [user_id]');
      await ctx.unbanChatMember(id).catch(() => {});
      await ctx.reply(`Unbanned ${id}`);
      await writeLog(ctx, ctx.group, 'unban', { targetId: id });
      return;
    }

    if (cmd === '.kick') {
      const target = await resolveTarget(ctx, args);
      if (!target) return ctx.reply('Usage: .kick [reply/user_id]');
      await ctx.banChatMember(target.id).catch(() => {});
      await ctx.unbanChatMember(target.id).catch(() => {});
      await ctx.reply(`Kicked ${target.id}`);
      await writeLog(ctx, ctx.group, 'kick', { targetId: target.id });
      return;
    }

    if (cmd === '.promote') {
      const target = await resolveTarget(ctx, args);
      const role = args.slice(1).join(' ') || undefined;
      if (!target) return ctx.reply('Usage: .promote [reply/user_id] [role]');
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
      await ctx.reply(`Promoted ${target.id}${role ? ` as ${role}` : ''}`);
      return;
    }

    if (cmd === '.demote') {
      const target = await resolveTarget(ctx, args);
      if (!target) return ctx.reply('Usage: .demote [reply/user_id]');
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
      await ctx.reply(`Demoted ${target.id}`);
      return;
    }

    if (cmd === '.roles') return ctx.reply('Usage: .promote [reply/user_id] [role]\nRole is optional custom admin title.');

    if (cmd === '.pin') {
      if (!ctx.message.reply_to_message) return ctx.reply('Reply to a message with .pin');
      await ctx.pinChatMessage(ctx.message.reply_to_message.message_id, { disable_notification: false }).catch(() => {});
      return ctx.reply('Pinned.');
    }

    if (cmd === '.unpin') {
      if (!ctx.message.reply_to_message) return ctx.reply('Reply to a message with .unpin');
      await ctx.unpinChatMessage(ctx.message.reply_to_message.message_id).catch(() => {});
      return ctx.reply('Unpinned.');
    }

    if (cmd === '.vc') {
      await ctx.telegram.callApi('createVideoChat', { chat_id: ctx.chat.id }).catch(async () => {
        await ctx.reply('Could not start voice chat via Bot API in this chat/client version.');
      });
      return;
    }

    if (cmd === '.mute') {
      const target = await resolveTarget(ctx, args);
      if (!target) return ctx.reply('Usage: .mute [reply/user_id] [time]');
      const secs = parseDuration(args[1] || '1h') || 3600;
      const until = Math.floor(Date.now() / 1000) + secs;
      await ctx.restrictChatMember(target.id, { can_send_messages: false }, { until_date: until }).catch(() => {});
      await User.findOneAndUpdate({ chatId: ctx.chat.id, userId: target.id }, { mutedUntil: new Date(until * 1000) }, { upsert: true });
      await ctx.reply(`Muted ${target.id} for ${secs}s`);
      await writeLog(ctx, ctx.group, 'mute', { targetId: target.id });
      return;
    }

    if (cmd === '.unmute') {
      const target = await resolveTarget(ctx, args);
      if (!target) return ctx.reply('Usage: .unmute [reply/user_id]');
      await ctx.restrictChatMember(target.id, {
        can_send_messages: true,
        can_send_other_messages: true,
        can_send_polls: true,
        can_add_web_page_previews: true,
        can_change_info: false,
        can_invite_users: true,
        can_pin_messages: false
      }).catch(() => {});
      await User.findOneAndUpdate({ chatId: ctx.chat.id, userId: target.id }, { mutedUntil: null }, { upsert: true });
      await ctx.reply(`Unmuted ${target.id}`);
      await writeLog(ctx, ctx.group, 'unmute', { targetId: target.id });
      return;
    }

    if (cmd === '.warn') {
      const target = await resolveTarget(ctx, args);
      if (!target) return ctx.reply('Usage: .warn [reply/user_id]');
      const user = await User.findOneAndUpdate(
        { chatId: ctx.chat.id, userId: target.id },
        { $inc: { warnings: 1 } },
        { upsert: true, new: true }
      );
      await ctx.reply(`Warned ${target.id}. Warnings: ${user.warnings}/${defaultWarningLimit}`);
      await writeLog(ctx, ctx.group, 'warn', { targetId: target.id, reason: `Count ${user.warnings}` });
      if (user.warnings >= defaultWarningLimit) {
        await ctx.banChatMember(target.id).catch(() => {});
        await ctx.unbanChatMember(target.id).catch(() => {});
        await User.updateOne({ chatId: ctx.chat.id, userId: target.id }, { warnings: 0 });
      }
      return;
    }

    if (cmd === '.warnings') {
      const target = await resolveTarget(ctx, args);
      if (!target) return ctx.reply('Usage: .warnings [user_id/reply]');
      const user = await User.findOne({ chatId: ctx.chat.id, userId: target.id });
      return ctx.reply(`Warnings for ${target.id}: ${user?.warnings || 0}`);
    }

    if (cmd === '.purge') {
      if (!ctx.message.reply_to_message) return ctx.reply('Usage: .purge [reply]');
      const from = ctx.message.reply_to_message.message_id;
      const to = ctx.message.message_id;
      let deleted = 0;
      for (let i = from; i <= to; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        const ok = await ctx.deleteMessage(i).then(() => true).catch(() => false);
        if (ok) deleted += 1;
      }
      return ctx.reply(`Purged ${deleted} messages.`);
    }

    if (cmd === '.del') {
      if (!ctx.message.reply_to_message) return ctx.reply('Usage: .del [reply]');
      await ctx.deleteMessage(ctx.message.reply_to_message.message_id).catch(() => {});
      await ctx.deleteMessage().catch(() => {});
      return;
    }

    if (cmd === '.lock' || cmd === '.unlock') {
      const lock = (args[0] || '').toLowerCase();
      if (!supportedLocks.includes(lock)) return ctx.reply(`Usage: .${cmd.slice(1)} [${supportedLocks.join('|')}]`);
      ctx.group.locks[lock] = cmd === '.lock';
      await ctx.group.save();
      return ctx.reply(`${cmd === '.lock' ? 'Locked' : 'Unlocked'} ${lock}`);
    }

    if (cmd === '.admins') {
      const admins = await ctx.getChatAdministrators();
      const textOut = admins.map((a) => `• ${a.user.first_name} (${a.status})`).join('\n');
      return ctx.reply(`Admins:\n${textOut}`);
    }

    if (cmd === '.bots') {
      const users = await User.find({ chatId: ctx.chat.id, username: { $ne: '' } }).limit(500);
      const bots = users.filter((u) => u.username.endsWith('bot'));
      return ctx.reply(`Bots seen in group:\n${bots.map((b) => `• @${b.username}`).join('\n') || 'None'}`);
    }

    if (cmd === '.users') {
      const page = Number(args[0] || 1);
      const limit = 20;
      const users = await User.find({ chatId: ctx.chat.id }).sort({ updatedAt: -1 }).skip((page - 1) * limit).limit(limit);
      const total = await User.countDocuments({ chatId: ctx.chat.id });
      const lines = users.map((u) => `• ${u.firstName || u.userId} (${u.userId})`);
      return ctx.reply(`Users page ${page}/${Math.max(1, Math.ceil(total / limit))}:\n${lines.join('\n') || 'No users tracked.'}`);
    }

    if (cmd === '.zombies') {
      const zombies = await User.find({ chatId: ctx.chat.id, isDeletedLikely: true });
      return ctx.reply(`Deleted accounts found: ${zombies.length}\n${zombies.map((z) => `• ${z.userId}`).join('\n')}`);
    }

    if (cmd === '.delservice') {
      const state = (args[0] || '').toLowerCase();
      if (!['on', 'off'].includes(state)) return ctx.reply('Usage: .delservice [on/off]');
      ctx.group.serviceDeleteEnabled = state === 'on';
      await ctx.group.save();
      return ctx.reply(`Service message deletion: ${state}`);
    }

    if (cmd === '.keepservice') {
      const t = (args[0] || '').toLowerCase();
      if (!t) return ctx.reply('Usage: .keepservice [service_type]');
      if (!ctx.group.keepServiceTypes.includes(t)) ctx.group.keepServiceTypes.push(t);
      await ctx.group.save();
      return ctx.reply(`Will keep service type: ${t}`);
    }

    if (cmd === '.servicestatus') {
      return ctx.reply(`delservice: ${ctx.group.serviceDeleteEnabled ? 'on' : 'off'}\nkept: ${ctx.group.keepServiceTypes.join(', ') || 'none'}`);
    }

    if (cmd === '.settitle') {
      const title = args.join(' ');
      if (!title) return ctx.reply('Usage: .settitle [new_title]');
      if (!ctx.group.originalTitle) ctx.group.originalTitle = ctx.chat.title;
      await ctx.setChatTitle(title).catch(() => {});
      ctx.group.title = title;
      await ctx.group.save();
      return ctx.reply(`Title set to: ${title}`);
    }

    if (cmd === '.restoretitle') {
      if (!ctx.group.originalTitle) return ctx.reply('No original title saved.');
      await ctx.setChatTitle(ctx.group.originalTitle).catch(() => {});
      return ctx.reply(`Restored title to ${ctx.group.originalTitle}`);
    }

    if (cmd === '.welcome') {
      const state = (args[0] || '').toLowerCase();
      if (!['on', 'off'].includes(state)) return ctx.reply('Usage: .welcome [on/off] [message]');
      ctx.group.welcomeEnabled = state === 'on';
      if (args.slice(1).length) ctx.group.welcomeMessage = args.slice(1).join(' ');
      await ctx.group.save();
      return ctx.reply(`Welcome ${state}`);
    }

    if (cmd === '.goodbye') {
      const state = (args[0] || '').toLowerCase();
      if (!['on', 'off'].includes(state)) return ctx.reply('Usage: .goodbye [on/off] [message]');
      ctx.group.goodbyeEnabled = state === 'on';
      if (args.slice(1).length) ctx.group.goodbyeMessage = args.slice(1).join(' ');
      await ctx.group.save();
      return ctx.reply(`Goodbye ${state}`);
    }

    if (cmd === '.filter') {
      const trigger = (args[0] || '').toLowerCase();
      const response = args.slice(1).join(' ');
      if (!trigger || !response) return ctx.reply('Usage: .filter [trigger] [response]');
      await Filter.findOneAndUpdate({ chatId: ctx.chat.id, trigger }, { response }, { upsert: true });
      return ctx.reply(`Filter saved: ${trigger}`);
    }

    if (cmd === '.filters') {
      const filters = await Filter.find({ chatId: ctx.chat.id }).sort({ trigger: 1 });
      return ctx.reply(`Filters:\n${filters.map((f) => `• ${f.trigger}`).join('\n') || 'No filters.'}`);
    }

    if (cmd === '.stop') {
      const trigger = (args[0] || '').toLowerCase();
      if (!trigger) return ctx.reply('Usage: .stop [trigger]');
      await Filter.deleteOne({ chatId: ctx.chat.id, trigger });
      return ctx.reply(`Filter removed: ${trigger}`);
    }

    if (cmd === '.setlog') {
      const id = Number(args[0]);
      if (!id) return ctx.reply('Usage: .setlog [channel_id]');
      ctx.group.logChannelId = id;
      await ctx.group.save();
      return ctx.reply(`Log channel set to ${id}`);
    }

    if (cmd === '.clearlog') {
      ctx.group.logChannelId = null;
      await ctx.group.save();
      return ctx.reply('Log channel removed.');
    }

    if (cmd === '.whitelist' || cmd === '.unwhitelist') {
      const target = await resolveTarget(ctx, args);
      if (!target) return ctx.reply(`Usage: ${cmd} [reply/user_id]`);
      const isAdd = cmd === '.whitelist';
      if (isAdd && !ctx.group.whitelistUsers.includes(target.id)) ctx.group.whitelistUsers.push(target.id);
      if (!isAdd) ctx.group.whitelistUsers = ctx.group.whitelistUsers.filter((id) => id !== target.id);
      await ctx.group.save();
      await User.findOneAndUpdate({ chatId: ctx.chat.id, userId: target.id }, { isWhitelisted: isAdd }, { upsert: true });
      return ctx.reply(`${isAdd ? 'Whitelisted' : 'Removed from whitelist'} ${target.id}`);
    }

    return ctx.reply('Unknown command.');
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
          `Verification required for ${mentionUser(member)}. Click below within ${captchaTimeoutSeconds}s.`,
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
        await ctx.reply(templateMessage(ctx.group.welcomeMessage, ctx, member), { parse_mode: 'HTML' });
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
    await ctx.editMessageText('User verified successfully.');
  });
};
