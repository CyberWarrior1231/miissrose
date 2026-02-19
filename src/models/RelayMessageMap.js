const mongoose = require('mongoose');

const RelayMessageMapSchema = new mongoose.Schema({
  relayChatId: { type: Number, required: true, index: true },
  relayMessageId: { type: Number, required: true, index: true },
  originalChatId: { type: Number, required: true },
  originalMessageId: { type: Number, required: true }
}, { timestamps: true });

RelayMessageMapSchema.index({ relayChatId: 1, relayMessageId: 1 }, { unique: true });

module.exports = mongoose.model('RelayMessageMap', RelayMessageMapSchema);
