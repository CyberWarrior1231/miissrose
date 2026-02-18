const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  userId: { type: Number, required: true, index: true },
  chatId: { type: Number, required: true, index: true },
  username: { type: String, default: '' },
  firstName: { type: String, default: '' },
  lastName: { type: String, default: '' },
  warnings: { type: Number, default: 0 },
  mutedUntil: { type: Date, default: null },
  isWhitelisted: { type: Boolean, default: false },
  verificationPending: { type: Boolean, default: false },
  verificationDeadline: { type: Date, default: null },
  isDeletedLikely: { type: Boolean, default: false }
}, { timestamps: true });

UserSchema.index({ userId: 1, chatId: 1 }, { unique: true });

module.exports = mongoose.model('User', UserSchema);
