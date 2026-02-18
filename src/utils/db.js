const mongoose = require('mongoose');
const { mongoUri } = require('../config');

async function connectDb() {
  if (!mongoUri) throw new Error('MONGO_URI is required');
  await mongoose.connect(mongoUri);
  console.log('MongoDB connected');
}

module.exports = { connectDb };
