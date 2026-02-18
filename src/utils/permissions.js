const Group = require('../models/Group');

async function getOrCreateGroup(chat) {
  let group = await Group.findOne({ chatId: chat.id });
  if (!group) {
    group = await Group.create({
      chatId: chat.id,
      title: chat.title || '',
      originalTitle: chat.title || ''
    });
  }
  return group;
}

async function isAdmin(ctx, userId = ctx.from?.id) {
  if (!ctx.chat || !userId) return false;
  try {
    const member = await ctx.telegram.getChatMember(ctx.chat.id, userId);
    return ['administrator', 'creator'].includes(member.status);
  } catch {
    return false;
  }
}

function parseDuration(input) {
  if (!input) return null;
  const match = input.match(/^(\d+)([smhd])$/i);
  if (!match) return null;
  const n = Number(match[1]);
  const unit = match[2].toLowerCase();
  const mult = unit === 's' ? 1 : unit === 'm' ? 60 : unit === 'h' ? 3600 : 86400;
  return n * mult;
}

function escapeHtml(text = '') {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function mentionUser(user) {
  return `<a href="tg://user?id=${user.id}">${escapeHtml(user.first_name || user.username || String(user.id))}</a>`;
}

module.exports = { getOrCreateGroup, isAdmin, parseDuration, mentionUser };
