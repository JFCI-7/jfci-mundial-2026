// ============== DB.js — SQLite (sql.js) ==============
// Almacena SOLO datos del usuario (no datos oficiales del torneo).
// Tablas:
//   user_scores  → overrides de marcadores
//   predictions  → quiniela
//   notes        → notas libres por partido
//   preferences  → preferencias UI (filtros, vista activa, último refresh)

const DB = (() => {
  let SQL = null;
  let db = null;
  const STORAGE_KEY = "mundial2026_userdb_v2";

  const init = async () => {
    SQL = await initSqlJs({
      locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/${file}`
    });
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const bytes = Uint8Array.from(atob(saved), c => c.charCodeAt(0));
        db = new SQL.Database(bytes);
      } catch (e) {
        console.warn("DB corrupta, recreando:", e);
        db = new SQL.Database();
        createSchema();
        save();
      }
    } else {
      db = new SQL.Database();
      createSchema();
      save();
    }
  };

  const createSchema = () => {
    db.run(`
      CREATE TABLE IF NOT EXISTS user_scores (
        match_id   TEXT PRIMARY KEY,
        home_score INTEGER NOT NULL,
        away_score INTEGER NOT NULL,
        status     TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS predictions (
        match_id   TEXT PRIMARY KEY,
        home_pred  INTEGER NOT NULL,
        away_pred  INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      );
      // Migración: añadir columna winner para eliminatorias
      try { run("ALTER TABLE predictions ADD COLUMN winner TEXT"); } catch (_) {}
      CREATE TABLE IF NOT EXISTS notes (
        match_id   TEXT PRIMARY KEY,
        text       TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS preferences (
        key   TEXT PRIMARY KEY,
        value TEXT
      );
    `);
  };

  const save = () => {
    const data = db.export();
    const b64 = btoa(String.fromCharCode.apply(null, data));
    localStorage.setItem(STORAGE_KEY, b64);
  };

  const exec = (sql, params = []) => {
    if (!db) return [];
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  };

  const run = (sql, params = []) => {
    if (!db) return;
    const stmt = db.prepare(sql);
    stmt.bind(params);
    stmt.step();
    stmt.free();
    save();
  };

  // ===== USER SCORES =====
  const setUserScore = (matchId, home, away, status) => {
    run(
      `INSERT INTO user_scores (match_id, home_score, away_score, status, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(match_id) DO UPDATE SET
         home_score=excluded.home_score,
         away_score=excluded.away_score,
         status=excluded.status,
         updated_at=excluded.updated_at`,
      [String(matchId), home, away, status, new Date().toISOString()]
    );
  };

  const getUserScore = (matchId) => {
    return exec("SELECT * FROM user_scores WHERE match_id = ?", [String(matchId)])[0] || null;
  };

  const getAllUserScores = () => {
    return exec("SELECT * FROM user_scores");
  };

  const clearUserScore = (matchId) => {
    run("DELETE FROM user_scores WHERE match_id = ?", [String(matchId)]);
  };

  const clearAllUserScores = () => {
    run("DELETE FROM user_scores");
  };

  // ===== PREDICTIONS =====
  // `extra` puede tener { winner: "home"|"away" } para eliminatorias
  const setPrediction = (matchId, home, away, extra = null) => {
    const winner = extra && extra.winner ? extra.winner : null;
    run(
      `INSERT INTO predictions (match_id, home_pred, away_pred, winner, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(match_id) DO UPDATE SET
         home_pred=excluded.home_pred,
         away_pred=excluded.away_pred,
         winner=excluded.winner,
         updated_at=excluded.updated_at`,
      [String(matchId), home, away, winner, new Date().toISOString()]
    );
  };

  const getAllPredictions = () => exec("SELECT * FROM predictions");

  const clearAllPredictions = () => run("DELETE FROM predictions");

  // ===== NOTES =====
  const setNote = (matchId, text) => {
    run(
      `INSERT INTO notes (match_id, text, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(match_id) DO UPDATE SET
         text=excluded.text,
         updated_at=excluded.updated_at`,
      [String(matchId), text, new Date().toISOString()]
    );
  };

  const getNote = (matchId) => {
    return exec("SELECT text FROM notes WHERE match_id = ?", [String(matchId)])[0]?.text || "";
  };

  // ===== PREFERENCES =====
  const setPref = (key, value) => {
    run(
      `INSERT INTO preferences (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
      [key, String(value)]
    );
  };

  const getPref = (key, def = null) => {
    const r = exec("SELECT value FROM preferences WHERE key = ?", [key])[0];
    return r ? r.value : def;
  };

  // ===== RESET =====
  const resetAll = () => {
    localStorage.removeItem(STORAGE_KEY);
    location.reload();
  };

  return {
    init, save,
    setUserScore, getUserScore, getAllUserScores, clearUserScore, clearAllUserScores,
    setPrediction, getAllPredictions, clearAllPredictions,
    setNote, getNote,
    setPref, getPref,
    resetAll,
  };
})();
