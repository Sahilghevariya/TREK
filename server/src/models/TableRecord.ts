import mongoose, { Schema } from 'mongoose';

const dynamicSchema = new Schema({}, {
  strict: false,
  versionKey: false,
});

const modelCache = new Map<string, mongoose.Model<Record<string, unknown>>>();

export function getTableModel(tableName: string): mongoose.Model<Record<string, unknown>> {
  const existing = modelCache.get(tableName);
  if (existing) return existing;

  const modelName = `Table_${tableName}`;
  const model = mongoose.models[modelName] as mongoose.Model<Record<string, unknown>> | undefined
      ?? mongoose.model<Record<string, unknown>>(modelName, dynamicSchema, tableName);
  modelCache.set(tableName, model);
  return model;
}

