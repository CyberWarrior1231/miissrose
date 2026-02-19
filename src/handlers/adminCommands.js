const { Markup } = require('telegraf');
const User = require('../models/User');
const Filter = require('../models/Filter');
const { isAdmin, parseDuration, mentionUser } = require('../utils/permissions');
const { writeLog } = require('../utils/logger');
const { defaultWarningLimit, captchaTimeoutSeconds } = require('../config');

const supportedLocks = ['stickers', 'gifs', 'photos', 'videos', 'links', 'voice', 'documents', 'polls'];

function escapeRegExp(input = '') {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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

function humanizeDuration(seconds) {
  if (!seconds) return 'until manually unmuted';
  if (seconds % 86400 === 0) return `${seconds / 86400} day${seconds / 86400 === 1 ? '' : 's'}`;
  if (seconds % 3600 === 0) return `${seconds / 3600} hour${seconds / 3600 === 1 ? '' : 's'}`;
  if (seconds % 60 === 0) return `${seconds / 60} minute${seconds / 60 === 1 ? '' : 's'}`;
  return `${seconds} seconds`;
}

function styledActionMessage({ title, user, duration, chatName, admin, detail }) {
  const lines = [title, `👤 ${user}`];
  if (duration) lines.push(`⏱ Duration: ${duration}`);
  lines.push(`📍 Group: ${chatName}`, `🛡 By: ${admin}`);
  if (detail) lines.push(detail);
  return lines.join('\n');
}

function extractApiErrorMessage(error) {
  return error?.response?.description || error?.description || error?.message || 'Unknown Telegram API error.';
}

function baseChatPermissions() {
  return {
    can_send_messages: true,
    can_send_media_messages: true,
    can_send_other_messages: true,
    can_send_polls: true,
    can_add_web_page_previews: true,
    can_change_info: false,
    can_invite_users: true,
    can_pin_messages: false,
    can_manage_topics: false,
    can_send_audios: true,
    can_send_documents: true,
    can_send_photos: true,
    can_send_videos: true,
    can_send_video_notes: true,
    can_send_voice_notes: true
  };
}

function buildPermissionsFromLocks(locks = {}) {
  const permissions = baseChatPermissions();

  if (locks.links) {
    permissions.can_add_web_page_previews = false;
  }
  if (locks.photos) {
    permissions.can_send_photos = false;
    permissions.can_send_media_messages = false;
  }
  if (locks.videos || locks.gifs) {
    permissions.can_send_videos = false;
    permissions.can_send_video_notes = false;
    permissions.can_send_media_messages = false;
  }
  if (locks.voice) {
    permissions.can_send_voice_notes = false;
    permissions.can_send_audios = false;
    permissions.can_send_media_messages = false;
  }
  if (locks.documents) {
    permissions.can_send_documents = false;
    permissions.can_send_media_messages = false;
  }
  if (locks.stickers) {
    permissions.can_send_other_messages = false;
  }
  if (locks.polls) {
    permissions.can_send_polls = false;
  }

  if (Object.values(locks).every(Boolean)) {
    return {
      ...permissions,
      can_send_messages: false,
      can_send_media_messages: false,
      can_send_other_messages: false,
      can_send_polls: false,
      can_add_web_page_previews: false,
      can_invite_users: false,
      can_send_audios: false,
      can_send_documents: false,
      can_send_photos: false,
      can_send_videos: false,
      can_send_video_notes: false,
      can_send_voice_notes: false
    };
  }

  return permissions;
}

async function resolveTarget(ctx, args) {
  if (ctx.message.reply_to_message?.from) {
    return { target: ctx.message.reply_to_message.from, consumedArgs: 0 };
  }

  const rawTarget = args[0];
  if (!rawTarget) return { target: null, consumedArgs: 0 };

  const id = Number(rawTarget);
  if (!Number.isNaN(id)) {
    return { target: { id, first_name: String(id) }, consumedArgs: 1 };
  }

  if (rawTarget.startsWith('@')) {
    const username = rawTarget.slice(1).toLowerCase();
    if (!username) return { target: null, consumedArgs: 0 };
    let resolvedFromApi = null;
    try {
      const apiUser = await ctx.telegram.getChat(`@${username}`);
      if (apiUser?.id) {
        resolvedFromApi = {
          id: apiUser.id,
          username: apiUser.username,
          first_name: apiUser.first_name || apiUser.username || username
        };
      }
    } catch {
      // Fallback to local user registry if Telegram API cannot resolve this username.
    }

    if (resolvedFromApi) {
      return { target: resolvedFromApi, consumedArgs: 1 };
    }

    const knownUser = await User.findOne({ chatId: ctx.chat.id, username: new RegExp(`^${escapeRegExp(username)}$`, 'i') });
    if (!knownUser) return { target: null, consumedArgs: 0 };

    return {
      target: {
        id: knownUser.userId,
        username: knownUser.username,
        first_name: knownUser.firstName || knownUser.username || String(knownUser.userId)
      },
      consumedArgs: 1
    };
  }

  return { target: null, consumedArgs: 0 };
}

function userInfoMessage(user, chat) {
  return [
    '🪪 <b>User Information</b>',
    `👤 Name: ${(user.first_name || user.firstName || '')} ${(user.last_name || user.lastName || '')}`.trim(),
    `🆔 User ID: <code>${user.id || user.userId}</code>`,
    `🔗 Username: ${user.username ? `@${user.username}` : 'Not set'}`,
    `🤖 Bot: ${user.is_bot ? 'Yes' : 'No'}`,
    `📍 Chat ID: <code>${chat.id}</code>`,
    `🏠 Chat: ${chat.title || chat.id}`
  ].join('\n');
}

function commandUsage(cmd) {
  const usageMap = {
    '.ban': 'Usage: .ban [reply/user_id/@username]',
    '.unban': 'Usage: .unban [reply/user_id/@username]',
    '.kick': 'Usage: .kick [reply/user_id/@username]',
    '.promote': 'Usage: .promote [reply/user_id/@username] [role]',
    '.demote': 'Usage: .demote [reply/user_id/@username]',
    '.pin': 'Usage: Reply to a message with .pin',
    '.unpin': 'Usage: Reply to a message with .unpin',
    '.mute': 'Usage: .mute [reply/user_id/@username] [1m|1h|1d] (duration optional)',
    '.unmute': 'Usage: .unmute [reply/user_id/@username]',
    '.warn': 'Usage: .warn [reply/user_id/@username]',
    '.warnings': 'Usage: .warnings [reply/user_id/@username]',
    '.purge': 'Usage: .purge [reply to first message]',
    '.del': 'Usage: .del [reply]',
    '.lock': `Usage: .lock [${supportedLocks.join('|')}|all]`,
    '.unlock': `Usage: .unlock [${supportedLocks.join('|')}|all]`,
    '.delservice': 'Usage: .delservice [on/off]',
    '.keepservice': 'Usage: .keepservice [service_type]',
    '.settitle': 'Usage: .settitle [new_title]',
    '.welcome': 'Usage: .welcome [on/off] [message]',
    '.goodbye': 'Usage: .goodbye [on/off] [message]',
    '.filter': 'Usage: .filter [trigger] [response]',
    '.stop': 'Usage: .stop [trigger]',
    '.setlog': 'Usage: .setlog [channel_id]',
    '.whitelist': 'Usage: .whitelist [reply/user_id/@username]',
    '.unwhitelist': 'Usage: .unwhitelist [reply/user_id/@username]',
    '.id': 'Usage: .id [reply/user_id/@username]'
  };
  return usageMap[cmd] || 'Please check your command format and try again.';
}

function targetResolutionError(args = []) {
  const raw = args[0] || '';
  if (raw.startsWith('@')) {
    return `❌ I couldn't resolve ${raw}.
• Ensure the username is correct.
• Ask the user to send a message in this group first.
• Or use reply / numeric user ID.`;
  }
  return null;
}

async function ensureAdmin(ctx) {
  if (!(await isAdmin(ctx))) {
    await ctx.reply('⛔ You need admin rights in this group to use this command.');
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
    
    if (cmd === '.id') {
      const { target } = await resolveTarget(ctx, args);
      const resolutionError = targetResolutionError(args);
      if (!target && resolutionError) return ctx.reply(resolutionError);
      const subject = target || ctx.from;
      return ctx.reply(userInfoMessage(subject, ctx.chat), { parse_mode: 'HTML' });
    }
    
    if (cmd === '.ban') {
      const { target } = await resolveTarget(ctx, args);
      if (!target) return ctx.reply(targetResolutionError(args) || commandUsage(cmd));
      const result = await ctx.banChatMember(target.id).then(() => ({ ok: true })).catch((error) => ({ ok: false, error }));
      if (!result.ok) return ctx.reply(`❌ Ban failed: ${extractApiErrorMessage(result.error)}`);
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
      const { target } = await resolveTarget(ctx, args);
      if (!target) return ctx.reply(targetResolutionError(args) || commandUsage(cmd));
      const result = await ctx.unbanChatMember(target.id).then(() => ({ ok: true })).catch((error) => ({ ok: false, error }));
      if (!result.ok) return ctx.reply(`❌ Unban failed: ${extractApiErrorMessage(result.error)}`);
      await ctx.reply(styledActionMessage({
        title: '✅ User Unbanned',
        user: mentionUser(target),
        chatName,
        admin: actor
      }), { parse_mode: 'HTML' });
      await writeLog(ctx, ctx.group, 'unban', { targetId: target.id });
      return;
    }

    if (cmd === '.kick') {
      const { target } = await resolveTarget(ctx, args);
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
      const { target, consumedArgs } = await resolveTarget(ctx, args);
      const role = args.slice(consumedArgs).join(' ') || undefined;
      if (!target) return ctx.reply(targetResolutionError(args) || commandUsage(cmd));
      const promoted = await ctx.telegram.promoteChatMember(ctx.chat.id, target.id, {
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
      }).then(() => ({ ok: true })).catch((error) => ({ ok: false, error }));

      if (!promoted) {
        return ctx.reply('⚠️ Promotion failed. Please check my admin rights and target validity.');
      }

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
       const { target } = await resolveTarget(ctx, args);
      if (!target) return ctx.reply(targetResolutionError(args) || commandUsage(cmd));

      const demoted = await ctx.telegram.promoteChatMember(ctx.chat.id, target.id, {
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
      }).then(() => true).catch(() => false);

      if (!demoted) {
        return ctx.reply('⚠️ Demotion failed. Please ensure target is an admin and I have full admin rights.');
      }
      
      await ctx.reply(styledActionMessage({
        title: '🔽 User Demoted',
        user: mentionUser(target),
        chatName,
        admin: actor
      }), { parse_mode: 'HTML' });
      return;
    }

    if (cmd === '.roles') return ctx.reply('💡 Usage: .promote [reply/user_id/@username] [role]\nRole sets a custom admin title.');

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
      const { target, consumedArgs } = await resolveTarget(ctx, args);
      if (!target) return ctx.reply(targetResolutionError(args) || commandUsage(cmd));
      const duration = parseDuration(args[consumedArgs]);
      const untilDate = duration ? Math.floor((Date.now() + duration * 1000) / 1000) : 0;

      const muteResult = await ctx.restrictChatMember(target.id, { can_send_messages: false }, { until_date: untilDate })
        .then(() => ({ ok: true }))
        .catch((error) => ({ ok: false, error }));

      if (!muteResult.ok) {
        await ctx.reply(`❌ Mute failed: ${extractApiErrorMessage(muteResult.error)}`);
        return;
      }
      
      await User.findOneAndUpdate(
        { chatId: ctx.chat.id, userId: target.id },
        { mutedUntil: duration ? new Date(Date.now() + duration * 1000) : null },
        { upsert: true }
      );

      await ctx.reply(styledActionMessage({
        title: '🔇 User Muted',
        user: mentionUser(target),
        duration: humanizeDuration(duration),
        chatName,
        admin: actor
      }), { parse_mode: 'HTML' });
      await ctx.reply(`✅ Successfully restricted ${mentionUser(target)}.`, { parse_mode: 'HTML' });
      await writeLog(ctx, ctx.group, 'mute', { targetId: target.id, reason: duration ? `for ${duration}s` : 'indefinite' });
      return;
    }

    if (cmd === '.unmute') {
      const { target } = await resolveTarget(ctx, args);
      if (!target) return ctx.reply(targetResolutionError(args) || commandUsage(cmd));
      
      const unmuteResult = await ctx.restrictChatMember(target.id, baseChatPermissions())
        .then(() => ({ ok: true }))
        .catch((error) => ({ ok: false, error }));

      if (!unmuteResult.ok) {
        await ctx.reply(`❌ Unmute failed: ${extractApiErrorMessage(unmuteResult.error)}`);
        return;
      }

      await User.findOneAndUpdate({ chatId: ctx.chat.id, userId: target.id }, { mutedUntil: null }, { upsert: true });

      await ctx.reply(styledActionMessage({
        title: '🔊 User Unmuted',
        user: mentionUser(target),
        chatName,
        admin: actor
      }), { parse_mode: 'HTML' });
      await ctx.reply(`✅ Successfully unrestricted ${mentionUser(target)}.`, { parse_mode: 'HTML' });
      await writeLog(ctx, ctx.group, 'unmute', { targetId: target.id });
      return;
    }

    if (cmd === '.warn') {
      const { target } = await resolveTarget(ctx, args);
      if (!target) return ctx.reply(targetResolutionError(args) || commandUsage(cmd));
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
      const { target } = await resolveTarget(ctx, args);
      if (!target) return ctx.reply(targetResolutionError(args) || commandUsage(cmd));
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
      const lockAll = lock === 'all';
      if (!lockAll && !supportedLocks.includes(lock)) return ctx.reply(commandUsage(cmd));

      const nextState = cmd === '.lock';
      const targets = lockAll ? supportedLocks : [lock];
      const nextLocks = { ...ctx.group.locks };
      for (const lockType of targets) {
       nextLocks[lockType] = nextState;
      }

       if (lockAll) {
        const permissions = nextState
          ? buildPermissionsFromLocks(Object.fromEntries(supportedLocks.map((item) => [item, true])))
          : baseChatPermissions();

        const lockResult = await ctx.telegram.setChatPermissions(ctx.chat.id, permissions)
          .then(() => ({ ok: true }))
          .catch((error) => ({ ok: false, error }));
        if (!lockResult.ok) {
          return ctx.reply(`❌ ${nextState ? 'Lock' : 'Unlock'} failed: ${extractApiErrorMessage(lockResult.error)}`);
        }
      }

      ctx.group.locks = nextLocks;
      await ctx.group.save();
      await ctx.reply(styledActionMessage({
        title: `${nextState ? '🔒 Lock Enabled' : '🔓 Lock Disabled'}`,
        user: `Content: ${lockAll ? 'all permissions' : lock}`,
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
      await ctx.reply(styledActionMessage({
        title: `👋 Goodbye ${state === 'on' ? 'Enabled' : 'Disabled'}`,
        user: 'Departing members',
        chatName,
        admin: actor
      }), { parse_mode: 'HTML' });
      return;
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
      return ctx.reply(styledActionMessage({
        title: '🧹 Filter Removed',
        user: trigger,
        chatName,
        admin: actor
      }), { parse_mode: 'HTML' });
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
      const { target } = await resolveTarget(ctx, args);
      if (!target) return ctx.reply(commandUsage(cmd));
      const isAdd = cmd === '.whitelist';
      if (isAdd && !ctx.group.whitelistUsers.includes(target.id)) ctx.group.whitelistUsers.push(target.id);
      if (!isAdd) ctx.group.whitelistUsers = ctx.group.whitelistUsers.filter((id) => id !== target.id);
      await ctx.group.save();
      await User.findOneAndUpdate({ chatId: ctx.chat.id, userId: target.id }, { isWhitelisted: isAdd }, { upsert: true });
      return ctx.reply(`${isAdd ? '✅ Whitelisted' : '❎ Removed from whitelist'} ${mentionUser(target)}`, { parse_mode: 'HTML' });
    }

    return ctx.reply('ℹ️ MissLily could not match that command. Open /start in DM for the full guidance panel.');
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
