const mongoose = require('mongoose');

const RelaySettingsSchema = new mongoose.Schema({
  key: { type: String, unique: true, default: 'global', index: true },
  enabled: { type: Boolean, default: false },
  mode: { type: String, enum: ['private', 'channel'], default: 'private' },
  channelId: { type: Number, default: null }
}, { timestamps: true });

module.exports = mongoose.model('RelaySettings', RelaySettingsSchema);
