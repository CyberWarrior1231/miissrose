const mongoose = require('mongoose');

const GroupSchema = new mongoose.Schema({
  chatId: { type: Number, unique: true, index: true, required: true },
  title: { type: String, default: '' },
  originalTitle: { type: String, default: '' },
  welcomeEnabled: { type: Boolean, default: false },
  welcomeMessage: { type: String, default: 'Welcome {user} to {group}!' },
  goodbyeEnabled: { type: Boolean, default: false },
  goodbyeMessage: { type: String, default: 'Goodbye {user}.' },
  locks: {
    stickers: { type: Boolean, default: false },
    gifs: { type: Boolean, default: false },
    photos: { type: Boolean, default: false },
    videos: { type: Boolean, default: false },
    links: { type: Boolean, default: false },
    voice: { type: Boolean, default: false },
    documents: { type: Boolean, default: false },
    polls: { type: Boolean, default: false }
  },
  badWords: [{ type: String }],
  antiSpamEnabled: { type: Boolean, default: true },
  antiFloodEnabled: { type: Boolean, default: true },
  antiLinkEnabled: { type: Boolean, default: true },
  captchaEnabled: { type: Boolean, default: true },
  serviceDeleteEnabled: { type: Boolean, default: false },
  keepServiceTypes: [{ type: String }],
  whitelistUsers: [{ type: Number }],
  logChannelId: { type: Number, default: null }
}, { timestamps: true });

module.exports = mongoose.model('Group', GroupSchema);
