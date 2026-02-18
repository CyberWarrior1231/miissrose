const mongoose = require('mongoose');

const FilterSchema = new mongoose.Schema({
  chatId: { type: Number, required: true, index: true },
  trigger: { type: String, required: true },
  response: { type: String, required: true }
}, { timestamps: true });

FilterSchema.index({ chatId: 1, trigger: 1 }, { unique: true });

module.exports = mongoose.model('Filter', FilterSchema);
