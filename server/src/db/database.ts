import { getTableModel } from '../models';
import { disconnectDB } from '../config/db';
import { Place, Tag } from '../types';

const alasql = require('alasql');

export const TABLES = [
  'addons',
  'app_settings',
  'assignment_participants',
  'audit_log',
  'bucket_list',
  'budget_category_order',
  'budget_item_members',
  'budget_items',
  'categories',
  'collab_message_reactions',
  'collab_messages',
  'collab_notes',
  'collab_poll_votes',
  'collab_polls',
  'day_accommodations',
  'day_assignments',
  'day_notes',
  'days',
  'file_links',
  'google_place_photo_meta',
  'idempotency_keys',
  'invite_tokens',
  'journey_checkins',
  'journey_contributors',
  'journey_entries',
  'journey_entry_photos',
  'journey_location_trail',
  'journey_members',
  'journey_photos',
  'journey_share_tokens',
  'journey_trips',
  'journeys',
  'mcp_tokens',
  'migrations',
  'notification_channel_preferences',
  'notification_preferences',
  'notifications',
  'oauth_clients',
  'oauth_consents',
  'oauth_tokens',
  'packing_bag_members',
  'packing_bags',
  'packing_category_assignees',
  'packing_items',
  'packing_template_categories',
  'packing_template_items',
  'packing_templates',
  'password_reset_tokens',
  'photo_provider_fields',
  'photo_providers',
  'photos',
  'place_details_cache',
  'place_regions',
  'place_tags',
  'places',
  'reservation_day_positions',
  'reservation_endpoints',
  'reservations',
  'settings',
  'share_tokens',
  'tags',
  'todo_category_assignees',
  'todo_items',
  'trek_photo_cache_meta',
  'trek_photos',
  'trip_album_links',
  'trip_files',
  'trip_members',
  'trip_photos',
  'trips',
  'user_notice_dismissals',
  'users',
  'vacay_company_holidays',
  'vacay_entries',
  'vacay_holiday_calendars',
  'vacay_plan_members',
  'vacay_plans',
  'vacay_user_colors',
  'vacay_user_years',
  'vacay_years',
  'visited_countries',
  'visited_regions',
];

const TABLE_SET = new Set(TABLES);
const initializedTables = new Set<string>();
const dirtyTables = new Set<string>();
let flushTimer: NodeJS.Timeout | null = null;
let mongoReady = false;

function createMemoryTable(tableName: string): void {
  if (initializedTables.has(tableName)) return;
  alasql(`CREATE TABLE IF NOT EXISTS ${tableName}`);
  initializedTables.add(tableName);
}

function stripMongoId(row: Record<string, unknown>): Record<string, unknown> {
  const { _id, ...clean } = row;
  return clean;
}

function rowsFor(tableName: string): Record<string, unknown>[] {
  createMemoryTable(tableName);
  return alasql.tables[tableName].data;
}

function normalizeSql(sql: string): string {
  return sql
      .replace(/INSERT\s+OR\s+IGNORE\s+INTO/gi, 'INSERT INTO')
      .replace(/INSERT\s+OR\s+REPLACE\s+INTO/gi, 'INSERT INTO')
      .replace(/ON\s+CONFLICT\s*\([^)]+\)\s+DO\s+UPDATE\s+SET[\s\S]+$/gi, '')
      .replace(/datetime\s*\(\s*'now'\s*\)/gi, 'CURRENT_TIMESTAMP')
      .replace(/\bas\s+count\b/gi, 'as [count]')
      .replace(/CURRENT_TIMESTAMP/gi, `'${new Date().toISOString()}'`);
}

function touchedTables(sql: string): string[] {
  const names = new Set<string>();
  const patterns = [
    /\bINTO\s+([a-zA-Z0-9_]+)/gi,
    /\bUPDATE\s+([a-zA-Z0-9_]+)/gi,
    /\bDELETE\s+FROM\s+([a-zA-Z0-9_]+)/gi,
    /\bFROM\s+([a-zA-Z0-9_]+)/gi,
    /\bJOIN\s+([a-zA-Z0-9_]+)/gi,
  ];
  for (const pattern of patterns) {
    for (const match of sql.matchAll(pattern)) {
      if (TABLE_SET.has(match[1])) names.add(match[1]);
    }
  }
  return [...names];
}

function assignIds(tableName: string): number | bigint {
  const rows = rowsFor(tableName);
  const currentMax = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0);
  let next = currentMax + 1;
  let last = 0;

  for (const row of rows) {
    if (row.id === undefined || row.id === null) {
      row.id = next++;
      last = Number(row.id);
    }
  }

  return last;
}

function getInsertIgnoreId(sql: string, params: unknown[]): { tableName: string; id: unknown } | null {
  const match = sql.match(/INSERT\s+OR\s+IGNORE\s+INTO\s+([a-zA-Z0-9_]+)\s*\(([^)]+)\)\s+VALUES\s*\(([^)]+)\)/i);
  if (!match) return null;

  const tableName = match[1];
  const columns = match[2].split(',').map(column => column.trim().replace(/["'`\[\]]/g, ''));
  const idIndex = columns.indexOf('id');
  if (idIndex < 0) return null;

  if (params.length > idIndex) return { tableName, id: params[idIndex] };

  const values = match[3].split(',').map(value => value.trim().replace(/^['"]|['"]$/g, ''));
  return { tableName, id: values[idIndex] };
}

async function flushTable(tableName: string): Promise<void> {
  if (!mongoReady) return;
  const model = getTableModel(tableName);
  const rows = rowsFor(tableName).map(row => ({ ...row }));
  await model.deleteMany({});
  if (rows.length > 0) await model.insertMany(rows, { ordered: false });
}

function scheduleFlush(tableNames: string[]): void {
  for (const tableName of tableNames) dirtyTables.add(tableName);
  if (flushTimer) return;

  flushTimer = setTimeout(() => {
    void flushDirtyTables();
  }, 25);
}

async function flushDirtyTables(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }

  const pending = [...dirtyTables];
  dirtyTables.clear();
  for (const tableName of pending) {
    try {
      await flushTable(tableName);
    } catch (err) {
      dirtyTables.add(tableName);
      console.error(`[MongoDB] Failed to persist ${tableName}:`, err);
    }
  }
}

export async function initializeMongoStore(): Promise<void> {
  for (const tableName of TABLES) {
    createMemoryTable(tableName);
    const rows = await getTableModel(tableName).find({}).lean();
    alasql.tables[tableName].data = rows.map(stripMongoId);
  }
  mongoReady = true;
}

interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

function execute(sql: string, params: unknown[] = []): unknown[] {
  const normalized = normalizeSql(sql);
  return alasql(normalized, params);
}

const db = {
  prepare(sql: string) {
    return {
      get(...params: unknown[]) {
        const result = execute(sql, params);
        return Array.isArray(result) ? result[0] : result;
      },
      all(...params: unknown[]) {
        const result = execute(sql, params);
        return Array.isArray(result) ? result : [];
      },
      run(...params: unknown[]): RunResult {
        const insertIgnore = getInsertIgnoreId(sql, params);
        if (insertIgnore) {
          const exists = rowsFor(insertIgnore.tableName).some(row => row.id === insertIgnore.id);
          if (exists) return { changes: 0, lastInsertRowid: 0 };
        }

        const affectedTables = touchedTables(sql);
        let lastInsertRowid: number | bigint = 0;
        const result = execute(sql, params);

        for (const tableName of affectedTables) {
          lastInsertRowid = assignIds(tableName) || lastInsertRowid;
        }
        scheduleFlush(affectedTables);

        return {
          changes: typeof result === 'number' ? result : 0,
          lastInsertRowid,
        };
      },
    };
  },
  exec(sql: string): void {
    for (const statement of sql.split(';').map(part => part.trim()).filter(Boolean)) {
      const upper = statement.toUpperCase();
      if (
        upper.startsWith('CREATE TABLE') ||
        upper.startsWith('CREATE INDEX') ||
        upper.startsWith('BEGIN') ||
        upper.startsWith('COMMIT') ||
        upper.startsWith('ROLLBACK')
      ) {
        continue;
      }
      const affectedTables = touchedTables(statement);
      execute(statement);
      for (const tableName of affectedTables) assignIds(tableName);
      scheduleFlush(affectedTables);
    }
  },
  transaction<T extends (...args: any[]) => any>(fn: T): T {
    return ((...args: Parameters<T>) => fn(...args)) as T;
  },
  close(): void {
    void closeDb();
  },
};

async function closeDb(): Promise<void> {
  await flushDirtyTables();
  await disconnectDB();
  mongoReady = false;
  console.log('[DB] MongoDB connection closed');
}

async function reinitialize(): Promise<void> {
  console.log('[DB] Reinitializing MongoDB-backed data cache...');
  await initializeMongoStore();
  console.log('[DB] MongoDB-backed data cache reinitialized successfully');
}

interface PlaceWithCategory extends Place {
  category_name: string | null;
  category_color: string | null;
  category_icon: string | null;
}

interface PlaceWithTags extends Place {
  category: { id: number; name: string; color: string; icon: string } | null;
  tags: Tag[];
}

function getPlaceWithTags(placeId: number | string): PlaceWithTags | null {
  const place = db.prepare(`
    SELECT p.*, c.name as category_name, c.color as category_color, c.icon as category_icon
    FROM places p
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE p.id = ?
  `).get(placeId) as PlaceWithCategory | undefined;

  if (!place) return null;

  const tags = db.prepare(`
    SELECT t.* FROM tags t
    JOIN place_tags pt ON t.id = pt.tag_id
    WHERE pt.place_id = ?
  `).all(placeId) as Tag[];

  return {
    ...place,
    category: place.category_id ? {
      id: place.category_id,
      name: place.category_name!,
      color: place.category_color!,
      icon: place.category_icon!,
    } : null,
    tags,
  };
}

interface TripAccess {
  id: number;
  user_id: number;
}

function canAccessTrip(tripId: number | string, userId: number): TripAccess | undefined {
  return db.prepare(`
    SELECT t.id, t.user_id FROM trips t
    LEFT JOIN trip_members m ON m.trip_id = t.id AND m.user_id = ?
    WHERE t.id = ? AND (t.user_id = ? OR m.user_id IS NOT NULL)
  `).get(userId, tripId, userId) as TripAccess | undefined;
}

function isOwner(tripId: number | string, userId: number): boolean {
  return !!db.prepare('SELECT id FROM trips WHERE id = ? AND user_id = ?').get(tripId, userId);
}

export { db, closeDb, reinitialize, getPlaceWithTags, canAccessTrip, isOwner };
