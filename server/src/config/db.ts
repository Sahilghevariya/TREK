import mongoose from 'mongoose';

const DEFAULT_MONGO_URI = 'mongodb://127.0.0.1:27017/trek-main';

export async function connectDB(): Promise<typeof mongoose> {
  const mongoUri = process.env.MONGO_URI || DEFAULT_MONGO_URI;

  mongoose.set('strictQuery', false);
  const connection = await mongoose.connect(mongoUri);
  console.log('MongoDB Connected');
  return connection;
}

export async function disconnectDB(): Promise<void> {
  await mongoose.disconnect();
}

