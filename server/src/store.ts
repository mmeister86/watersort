import { randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { copyFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Persistent per-player counters. */
export type Stats = {
  solved: number;
  moves: number;
  undos: number;
};

/** Partial counters sent by the client when a level is solved. */
export type StatsDelta = Partial<Stats>;

/** A player exactly as stored in `data.json`. */
export type Player = {
  id: string;
  name: string;
  color: string;
  level: number;
  stats: Stats;
  createdAt: string;
  updatedAt: string;
};

/** The whole `data.json` document. */
export type StoreData = {
  version: 1;
  players: Player[];
};

export type PlayerInput = {
  name: string;
  color: string;
};

export type ProgressUpdate = {
  level: number;
  statsDelta: StatsDelta;
};

export type StoreOptions = {
  dataDir: string;
  /** Injectable clock, used by tests to drive the daily backup. */
  now?: () => Date;
};

/** The subset of the store the HTTP layer depends on (easy to fake in tests). */
export interface PlayerStore {
  listPlayers(): Promise<Player[]>;
  createPlayer(input: PlayerInput): Promise<Player>;
  updateProgress(
    id: string,
    update: ProgressUpdate,
  ): Promise<Player | undefined>;
  deletePlayer(id: string): Promise<boolean>;
}

/** Thrown by `createPlayer` when the name is already taken (case-insensitive). */
export class PlayerNameConflictError extends Error {
  constructor(name: string) {
    super(`Player name already taken: ${name}`);
    this.name = 'PlayerNameConflictError';
  }
}

const STAT_KEYS = ['solved', 'moves', 'undos'] as const;

/** Validates one player entry loaded from disk. */
function parsePlayer(value: unknown): Player {
  if (typeof value !== 'object' || value === null) {
    throw new Error('data.json: player entry is not an object');
  }
  const record = value as Record<string, unknown>;
  const stats = record.stats;
  if (
    typeof record.id !== 'string' ||
    typeof record.name !== 'string' ||
    typeof record.color !== 'string' ||
    typeof record.level !== 'number' ||
    typeof record.createdAt !== 'string' ||
    typeof record.updatedAt !== 'string' ||
    typeof stats !== 'object' ||
    stats === null
  ) {
    throw new Error('data.json: player entry has an unexpected shape');
  }
  const statRecord = stats as Record<string, unknown>;
  if (
    typeof statRecord.solved !== 'number' ||
    typeof statRecord.moves !== 'number' ||
    typeof statRecord.undos !== 'number'
  ) {
    throw new Error('data.json: player stats have an unexpected shape');
  }
  return {
    id: record.id,
    name: record.name,
    color: record.color,
    level: record.level,
    stats: {
      solved: statRecord.solved,
      moves: statRecord.moves,
      undos: statRecord.undos,
    },
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/** Parses and validates the whole `data.json` document. */
function parseStoreData(value: unknown): StoreData {
  if (typeof value !== 'object' || value === null) {
    throw new Error('data.json: root is not an object');
  }
  const record = value as Record<string, unknown>;
  if (record.version !== 1) {
    throw new Error(`data.json: unsupported version ${String(record.version)}`);
  }
  if (!Array.isArray(record.players)) {
    throw new Error('data.json: players is not an array');
  }
  return { version: 1, players: record.players.map(parsePlayer) };
}

/** A player id: `p_` plus five crypto-random lowercase hex characters. */
function createPlayerId(): string {
  return `p_${randomBytes(3).toString('hex').slice(0, 5)}`;
}

/** Returns a copy so callers cannot mutate the in-memory store. */
function clonePlayer(player: Player): Player {
  return { ...player, stats: { ...player.stats } };
}

/**
 * Probes that `dataDir` is writable by creating and deleting a probe file.
 * Throws on failure; the process entry point turns that into a hard exit.
 */
export function probeDataDir(dataDir: string): void {
  mkdirSync(dataDir, { recursive: true });
  const probe = join(dataDir, '.write-probe');
  writeFileSync(probe, 'ok', 'utf8');
  rmSync(probe, { force: true });
}

/**
 * In-memory player store backed by a single JSON file. Reads come from
 * memory; every mutation is serialized through one promise chain so no two
 * writes ever overlap. Writes are atomic (tmp file + rename) and the file is
 * copied to `data.json.bak` before the first write of a new day.
 */
export class Store implements PlayerStore {
  private readonly dataDir: string;
  private readonly dataPath: string;
  private readonly tmpPath: string;
  private readonly bakPath: string;
  private readonly now: () => Date;
  private data: StoreData;
  private lastBackupDay: string | null = null;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(options: StoreOptions) {
    this.dataDir = options.dataDir;
    this.now = options.now ?? (() => new Date());
    this.dataPath = join(this.dataDir, 'data.json');
    this.tmpPath = join(this.dataDir, 'data.json.tmp');
    this.bakPath = join(this.dataDir, 'data.json.bak');

    mkdirSync(this.dataDir, { recursive: true });
    this.data = this.load();
  }

  /** Loads `data.json`, creating an empty document when it does not exist. */
  private load(): StoreData {
    if (!existsSync(this.dataPath)) {
      const initial: StoreData = { version: 1, players: [] };
      writeFileSync(this.tmpPath, JSON.stringify(initial, null, 2), 'utf8');
      renameSync(this.tmpPath, this.dataPath);
      return initial;
    }
    const parsed: unknown = JSON.parse(readFileSync(this.dataPath, 'utf8'));
    return parseStoreData(parsed);
  }

  /** Serializes a mutation behind all previously enqueued ones. */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.chain.then(task);
    this.chain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /** Copies the current file aside before the first write of a new day. */
  private async backupOncePerDay(): Promise<void> {
    const day = this.now().toISOString().slice(0, 10);
    if (this.lastBackupDay === day) {
      return;
    }
    if (existsSync(this.dataPath)) {
      await copyFile(this.dataPath, this.bakPath);
    }
    this.lastBackupDay = day;
  }

  /** Atomically writes the in-memory document to disk. */
  private async persist(): Promise<void> {
    await this.backupOncePerDay();
    await writeFile(this.tmpPath, JSON.stringify(this.data, null, 2), 'utf8');
    await rename(this.tmpPath, this.dataPath);
  }

  async listPlayers(): Promise<Player[]> {
    return this.data.players.map(clonePlayer);
  }

  async createPlayer(input: PlayerInput): Promise<Player> {
    return this.enqueue(async () => {
      const lower = input.name.toLowerCase();
      if (this.data.players.some((player) => player.name.toLowerCase() === lower)) {
        throw new PlayerNameConflictError(input.name);
      }
      const timestamp = this.now().toISOString();
      const player: Player = {
        id: createPlayerId(),
        name: input.name,
        color: input.color,
        level: 1,
        stats: { solved: 0, moves: 0, undos: 0 },
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      this.data.players.push(player);
      await this.persist();
      return clonePlayer(player);
    });
  }

  async updateProgress(
    id: string,
    update: ProgressUpdate,
  ): Promise<Player | undefined> {
    return this.enqueue(async () => {
      const player = this.data.players.find((entry) => entry.id === id);
      if (player === undefined) {
        return undefined;
      }
      player.level = Math.max(player.level, update.level);
      for (const key of STAT_KEYS) {
        player.stats[key] += update.statsDelta[key] ?? 0;
      }
      player.updatedAt = this.now().toISOString();
      await this.persist();
      return clonePlayer(player);
    });
  }

  async deletePlayer(id: string): Promise<boolean> {
    return this.enqueue(async () => {
      const index = this.data.players.findIndex((player) => player.id === id);
      if (index === -1) {
        return false;
      }
      this.data.players.splice(index, 1);
      await this.persist();
      return true;
    });
  }
}
