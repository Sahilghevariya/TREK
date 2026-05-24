import fs from 'fs';
import path from 'path';
import { TABLES, reinitialize } from '../db/database';
import { getTableModel } from '../models';

const dataDir = path.join(__dirname, '../../data');
const baselinePath = path.join(dataDir, 'mongo-baseline.json');

async function resetDemoUser(): Promise<void> {
  if (!fs.existsSync(baselinePath)) {
    console.log('[Demo Reset] No baseline found, skipping. Admin must save baseline first.');
    return;
  }

  const { db } = require('../db/database');
  const adminEmail = process.env.DEMO_ADMIN_EMAIL || 'admin@nomad.app';
  interface AdminData { password_hash: string; maps_api_key: string | null; openweather_api_key: string | null; unsplash_api_key: string | null; avatar: string | null; }
  const adminData = db.prepare(
    'SELECT password_hash, maps_api_key, openweather_api_key, unsplash_api_key, avatar FROM users WHERE email = ?'
  ).get(adminEmail) as AdminData | undefined;

  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8')) as Record<string, unknown[]>;
  for (const tableName of TABLES) {
    const model = getTableModel(tableName);
    await model.deleteMany({});
    const rows = baseline[tableName] || [];
    if (rows.length > 0) await model.insertMany(rows, { ordered: false });
  }

  await reinitialize();

  if (adminData) {
    const { db: freshDb } = require('../db/database');
    freshDb.prepare(
      'UPDATE users SET password_hash = ?, maps_api_key = ?, openweather_api_key = ?, unsplash_api_key = ?, avatar = ? WHERE email = ?'
    ).run(
      adminData.password_hash,
      adminData.maps_api_key,
      adminData.openweather_api_key,
      adminData.unsplash_api_key,
      adminData.avatar,
      adminEmail
    );
  }

  console.log('[Demo Reset] MongoDB restored from baseline');
}

async function saveBaseline(): Promise<void> {
  const baseline: Record<string, unknown[]> = {};
  for (const tableName of TABLES) {
    baseline[tableName] = await getTableModel(tableName).find({}).lean();
  }
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(baselinePath, JSON.stringify(baseline, null, 2));
  console.log('[Demo] Baseline saved');
}

function hasBaseline(): boolean {
  return fs.existsSync(baselinePath);
}

export { resetDemoUser, saveBaseline, hasBaseline };
