import { randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const root = fileURLToPath(new URL(".", import.meta.url));
const dbPath = process.env.SQLITE_PATH || join(root, "data", "adsflow.sqlite");
mkdirSync(dirname(dbPath), { recursive: true });

export const db = new DatabaseSync(dbPath);

db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    niche TEXT,
    business_goal TEXT,
    experience_level TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS clients (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    business_name TEXT,
    ad_account_id TEXT,
    status TEXT NOT NULL DEFAULT 'setup',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS oauth_states (
    state TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    client_id TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS meta_connections (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    client_id TEXT NOT NULL,
    meta_user_id TEXT,
    access_token TEXT NOT NULL,
    token_type TEXT,
    expires_at TEXT,
    scopes TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, client_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS instagram_profiles (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    client_id TEXT NOT NULL,
    page_id TEXT,
    page_name TEXT,
    instagram_id TEXT,
    username TEXT,
    name TEXT,
    biography TEXT,
    followers_count INTEGER,
    media_count INTEGER,
    website TEXT,
    profile_picture_url TEXT,
    imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, client_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS subscriptions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE,
    plan_key TEXT NOT NULL,
    status TEXT NOT NULL,
    provider TEXT,
    provider_customer_id TEXT,
    provider_subscription_id TEXT,
    trial_ends_at TEXT,
    current_period_ends_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

const userColumns = db.prepare("PRAGMA table_info(users)").all().map((column) => column.name);
if (!userColumns.includes("niche")) db.exec("ALTER TABLE users ADD COLUMN niche TEXT");
if (!userColumns.includes("business_goal")) db.exec("ALTER TABLE users ADD COLUMN business_goal TEXT");
if (!userColumns.includes("experience_level")) db.exec("ALTER TABLE users ADD COLUMN experience_level TEXT");

function hashPassword(password) {
  const salt = randomUUID();
  const key = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${key}`;
}

function verifyPassword(password, passwordHash) {
  const [salt, key] = passwordHash.split(":");
  const candidate = scryptSync(password, salt, 64);
  const stored = Buffer.from(key, "hex");
  return stored.length === candidate.length && timingSafeEqual(stored, candidate);
}

export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    niche: user.niche,
    businessGoal: user.business_goal,
    experienceLevel: user.experience_level,
    createdAt: user.created_at
  };
}

export function createUser({ name, email, password }) {
  const user = {
    id: randomUUID(),
    name: name || email.split("@")[0],
    email: email.trim().toLowerCase(),
    passwordHash: hashPassword(password)
  };

  db.prepare("INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)").run(
    user.id,
    user.name,
    user.email,
    user.passwordHash
  );

  return getUserByEmail(user.email);
}

export function getUserByEmail(email) {
  return db.prepare("SELECT * FROM users WHERE email = ?").get(email.trim().toLowerCase());
}

export function loginUser(email, password) {
  const user = getUserByEmail(email);
  if (!user || !verifyPassword(password, user.password_hash)) return null;
  return user;
}

export function createSession(userId) {
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString();
  db.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)").run(id, userId, expiresAt);
  return { id, expiresAt };
}

export function deleteSession(sessionId) {
  if (!sessionId) return;
  db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
}

export function getUserBySession(sessionId) {
  if (!sessionId) return null;
  return db
    .prepare(
      `SELECT users.*
       FROM sessions
       JOIN users ON users.id = sessions.user_id
       WHERE sessions.id = ? AND sessions.expires_at > datetime('now')`
    )
    .get(sessionId);
}

export function updateUserOnboarding(userId, input) {
  db.prepare(
    `UPDATE users
     SET niche = ?, business_goal = ?, experience_level = ?
     WHERE id = ?`
  ).run(input.niche || "", input.businessGoal || "", input.experienceLevel || "iniciante", userId);
  return db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
}

export function getSubscription(userId) {
  return db.prepare("SELECT * FROM subscriptions WHERE user_id = ?").get(userId);
}

export function upsertSubscription(userId, input) {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO subscriptions
      (id, user_id, plan_key, status, provider, provider_customer_id, provider_subscription_id,
       trial_ends_at, current_period_ends_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       plan_key = excluded.plan_key,
       status = excluded.status,
       provider = excluded.provider,
       provider_customer_id = excluded.provider_customer_id,
       provider_subscription_id = excluded.provider_subscription_id,
       trial_ends_at = excluded.trial_ends_at,
       current_period_ends_at = excluded.current_period_ends_at,
       updated_at = CURRENT_TIMESTAMP`
  ).run(
    id,
    userId,
    input.planKey,
    input.status,
    input.provider || "",
    input.providerCustomerId || "",
    input.providerSubscriptionId || "",
    input.trialEndsAt || null,
    input.currentPeriodEndsAt || null
  );
  return getSubscription(userId);
}

export function listClients(userId) {
  return db
    .prepare(
      `SELECT clients.*,
        CASE WHEN meta_connections.id IS NULL THEN 0 ELSE 1 END AS meta_connected
       FROM clients
       LEFT JOIN meta_connections
         ON meta_connections.client_id = clients.id AND meta_connections.user_id = clients.user_id
       WHERE clients.user_id = ?
       ORDER BY clients.created_at DESC`
    )
    .all(userId);
}

export function createClient(userId, input) {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO clients (id, user_id, name, business_name, ad_account_id, status)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    userId,
    input.name,
    input.businessName || "",
    input.adAccountId || "",
    input.status || "setup"
  );
  return db.prepare("SELECT * FROM clients WHERE id = ? AND user_id = ?").get(id, userId);
}

export function getClient(userId, clientId) {
  return db.prepare("SELECT * FROM clients WHERE id = ? AND user_id = ?").get(clientId, userId);
}

export function saveOauthState(userId, clientId) {
  const state = randomUUID();
  const expiresAt = new Date(Date.now() + 1000 * 60 * 10).toISOString();
  db.prepare("INSERT INTO oauth_states (state, user_id, client_id, expires_at) VALUES (?, ?, ?, ?)").run(
    state,
    userId,
    clientId,
    expiresAt
  );
  return state;
}

export function consumeOauthState(state) {
  const row = db
    .prepare("SELECT * FROM oauth_states WHERE state = ? AND expires_at > datetime('now')")
    .get(state);
  db.prepare("DELETE FROM oauth_states WHERE state = ?").run(state);
  return row;
}

export function saveMetaConnection({ userId, clientId, accessToken, tokenType, expiresIn, scopes, metaUserId }) {
  const id = randomUUID();
  const expiresAt = expiresIn ? new Date(Date.now() + Number(expiresIn) * 1000).toISOString() : null;
  db.prepare(
    `INSERT INTO meta_connections
      (id, user_id, client_id, meta_user_id, access_token, token_type, expires_at, scopes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, client_id) DO UPDATE SET
      meta_user_id = excluded.meta_user_id,
      access_token = excluded.access_token,
      token_type = excluded.token_type,
      expires_at = excluded.expires_at,
      scopes = excluded.scopes,
      updated_at = CURRENT_TIMESTAMP`
  ).run(id, userId, clientId, metaUserId || "", accessToken, tokenType || "", expiresAt, scopes || "");

  db.prepare("UPDATE clients SET status = 'active' WHERE id = ? AND user_id = ?").run(clientId, userId);
}

export function getMetaConnection(userId, clientId) {
  return db
    .prepare("SELECT * FROM meta_connections WHERE user_id = ? AND client_id = ?")
    .get(userId, clientId);
}

export function saveInstagramProfile(userId, clientId, input) {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO instagram_profiles
      (id, user_id, client_id, page_id, page_name, instagram_id, username, name, biography,
       followers_count, media_count, website, profile_picture_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, client_id) DO UPDATE SET
      page_id = excluded.page_id,
      page_name = excluded.page_name,
      instagram_id = excluded.instagram_id,
      username = excluded.username,
      name = excluded.name,
      biography = excluded.biography,
      followers_count = excluded.followers_count,
      media_count = excluded.media_count,
      website = excluded.website,
      profile_picture_url = excluded.profile_picture_url,
      imported_at = CURRENT_TIMESTAMP`
  ).run(
    id,
    userId,
    clientId,
    input.pageId || "",
    input.pageName || "",
    input.instagramId || "",
    input.username || "",
    input.name || "",
    input.biography || "",
    Number(input.followersCount || 0),
    Number(input.mediaCount || 0),
    input.website || "",
    input.profilePictureUrl || ""
  );

  return getInstagramProfile(userId, clientId);
}

export function getInstagramProfile(userId, clientId) {
  return db
    .prepare("SELECT * FROM instagram_profiles WHERE user_id = ? AND client_id = ?")
    .get(userId, clientId);
}
