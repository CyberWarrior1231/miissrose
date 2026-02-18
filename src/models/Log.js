const mongoose = require('mongoose');

const LogSchema = new mongoose.Schema({
  chatId: { type: Number, required: true, index: true },
  action: { type: String, required: true },
  actorId: { type: Number, default: null },
  targetId: { type: Number, default: null },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true });

module.exports = mongoose.model('Log', LogSchema);
