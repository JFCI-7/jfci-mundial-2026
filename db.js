// ============== DB.js — SQLite (sql.js) ==============
// Almacena SOLO datos del usuario (no datos oficiales del torneo).
// Tablas:
//   user_scores  → overrides de marcadores
//   predictions  → quiniela
//   notes        → notas libres por partido
//   preferences  → preferencias UI (filtros, vista activa, último refresh)
//
// Sync a Vercel KV (opcional):
//   El user puede iniciar sesión con email + PIN opcional. La identidad se
//   hashea con SHA-256 (en cliente, vía Web Crypto) y se guarda en
//   localStorage. Pull/PUT contra /api/predictions (serverless).

const DB = (() => {
  let SQL = null;
  let db = null;
  const STORAGE_KEY = "mundial2026_userdb_v2";
  const USERID_KEY = "mundial2026_userid";     // u:hash → datos del usuario
  const EMAILID_KEY = "mundial2026_emailid";   // m:hash → metadata (has_pin)
  const LAST_SYNC_KEY = "mundial2026_last_sync";
  const SYNC_ENDPOINT = "/api/predictions";

  // Estado de sync
  let syncState = {
    enabled: false,        // server responde 503 si no hay KV configurado
    lastSync: null,        // ISO string
    inFlight: null,        // Promise actual (debounce)
    pendingPush: false,    // hay cambios sin subir
  };

  // Listeners para notificar a la UI cuando cambia el estado de sync
  const syncListeners = new Set();
  const onSyncChange = (fn) => { syncListeners.add(fn); return () => syncListeners.delete(fn); };
  const emitSync = () => syncListeners.forEach(fn => { try { fn(syncState); } catch (_) {} });

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
    // Hidratar lastSync desde localStorage
    syncState.lastSync = localStorage.getItem(LAST_SYNC_KEY) || null;
  };

  const createSchema = () => {
    // IMPORTANTE: cada statement se ejecuta por separado. sql.js 1.10.3 no
    // maneja bien multi-statement cuando dentro del string hay un try/catch
    // JS que contiene comillas, lo que produce errores tipo
    // "near '/': syntax error". Un statement por llamada = 100% confiable.
    db.run(`CREATE TABLE IF NOT EXISTS user_scores (
      match_id   TEXT PRIMARY KEY,
      home_score INTEGER NOT NULL,
      away_score INTEGER NOT NULL,
      status     TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS predictions (
      match_id   TEXT PRIMARY KEY,
      home_pred  INTEGER NOT NULL,
      away_pred  INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    )`);

    // Migración: añadir columna winner para eliminatorias.
    // Comprobamos primero si la columna existe (PRAGMA table_info) para no
    // depender de un try/catch externo al try del run().
    try {
      const cols = db.exec("PRAGMA table_info(predictions)");
      const hasWinner = cols[0] && cols[0].values.some(row => row[1] === "winner");
      if (!hasWinner) {
        db.run("ALTER TABLE predictions ADD COLUMN winner TEXT");
      }
    } catch (_) { /* tabla aún no existe → se creará en pasos siguientes */ }

    db.run(`CREATE TABLE IF NOT EXISTS notes (
      match_id   TEXT PRIMARY KEY,
      text       TEXT,
      updated_at TEXT NOT NULL
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS preferences (
      key   TEXT PRIMARY KEY,
      value TEXT
    )`);

    save();
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
    schedulePush();
  };

  const getUserScore = (matchId) => {
    return exec("SELECT * FROM user_scores WHERE match_id = ?", [String(matchId)])[0] || null;
  };

  const getAllUserScores = () => {
    return exec("SELECT * FROM user_scores");
  };

  const clearUserScore = (matchId) => {
    run("DELETE FROM user_scores WHERE match_id = ?", [String(matchId)]);
    schedulePush();
  };

  const clearAllUserScores = () => {
    run("DELETE FROM user_scores");
    schedulePush();
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
    schedulePush();
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
    schedulePush();
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
    schedulePush();
  };

  const getPref = (key, def = null) => {
    const r = exec("SELECT value FROM preferences WHERE key = ?", [key])[0];
    return r ? r.value : def;
  };

  // ===== AUTH (Pass-the-hash) =====
  const sha256Hex = async (text) => {
    const buf = new TextEncoder().encode(text);
    const hash = await crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
  };

  const validateEmail = (email) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
  };

  const validatePin = (pin) => {
    return /^\d{4}$/.test(String(pin || "").trim());
  };

  // setUserCredentials(email, pin?): hashea email+pin y guarda en localStorage.
  // El email NUNCA se guarda en disco (solo en la función, mientras se procesa).
  const setUserCredentials = async (email, pin) => {
    const cleanEmail = String(email || "").trim().toLowerCase();
    if (!validateEmail(cleanEmail)) throw new Error("invalid_email");
    if (pin !== undefined && pin !== null && pin !== "" && !validatePin(pin)) {
      throw new Error("invalid_pin");
    }
    const pinPart = pin ? String(pin).trim() : "";
    const fullHash = await sha256Hex(`mundial2026|${cleanEmail}|${pinPart}`);
    const emailHash = await sha256Hex(`mundial2026|${cleanEmail}|`);
    localStorage.setItem(USERID_KEY, fullHash);
    localStorage.setItem(EMAILID_KEY, emailHash);
    return { fullHash, emailHash };
  };

  const getUserId = () => {
    return localStorage.getItem(USERID_KEY) || null;
  };

  const getEmailId = () => {
    return localStorage.getItem(EMAILID_KEY) || null;
  };

  const clearUserCredentials = () => {
    localStorage.removeItem(USERID_KEY);
    localStorage.removeItem(EMAILID_KEY);
    localStorage.removeItem(LAST_SYNC_KEY);
    syncState.lastSync = null;
    syncState.enabled = false;
    emitSync();
  };

  // validateCredentials(email, pin): chequea el server ANTES de guardar.
  // Retorna { status } con uno de:
  //   "ok"            — credenciales válidas (o email nuevo)
  //   "wrong_pin"     — el email existe con PIN, pero el PIN es incorrecto
  //   "pin_required"  — el email existe con PIN, el usuario no lo ingresó
  //   "pin_unexpected"— el email existe SIN PIN, el usuario ingresó uno
  //   "network_error" — no se pudo contactar al server
  //   "kv_unavailable"— server sin KV configurado (cliente debe caer a local)
  const validateCredentials = async (email, pin) => {
    const cleanEmail = String(email || "").trim().toLowerCase();
    if (!validateEmail(cleanEmail)) return { status: "ok" };
    const pinPart = pin ? String(pin).trim() : "";
    const fullHash = await sha256Hex(`mundial2026|${cleanEmail}|${pinPart}`);
    const emailHash = await sha256Hex(`mundial2026|${cleanEmail}|`);
    const enteredPin = pinPart.length > 0;

    try {
      // 1) Si el server no tiene KV, dejamos pasar (modo local).
      if (!process.env_placeholder) {
        // No tenemos cómo chequear server-side availability desde el cliente;
        // simplemente intentamos la metadata y manejamos errores.
      }
      const meta = await getMetadata(emailHash);
      // meta puede ser null (no existe metadata) o { has_pin: true } o null
      const serverHasPin = !!(meta && meta.data && meta.data.has_pin);

      if (serverHasPin) {
        if (!enteredPin) {
          return { status: "pin_required" };
        }
        // Usuario ingresó PIN, verificar que el full_hash exista
        const data = await fetchData(`u:${fullHash}`);
        if (!data) return { status: "wrong_pin" };
        return { status: "ok" };
      } else {
        if (enteredPin) {
          return { status: "pin_unexpected" };
        }
        // No PIN en server, no PIN ingresado: signup normal
        return { status: "ok" };
      }
    } catch (err) {
      return { status: "network_error", message: err && err.message };
    }
  };

  // getMetadata(emailHash): lee m:<emailHash> del server.
  const getMetadata = async (emailHash) => {
    try {
      const r = await fetch(`${SYNC_ENDPOINT}?u=m:${emailHash}`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(8000),
      });
      if (r.status === 404) return null;
      if (r.status === 503) {
        syncState.enabled = false;
        emitSync();
        return null;
      }
      if (!r.ok) return null;
      return await r.json();
    } catch (_) {
      return null;
    }
  };

  // pushMetadata(emailHash, meta): escribe m:<emailHash> al server.
  const pushMetadata = async (emailHash, meta) => {
    try {
      await fetch(`${SYNC_ENDPOINT}?u=m:${emailHash}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(meta),
        signal: AbortSignal.timeout(8000),
      });
    } catch (_) { /* best-effort */ }
  };

  const fetchData = async (fullKey) => {
    try {
      const r = await fetch(`${SYNC_ENDPOINT}?u=${fullKey}`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(8000),
      });
      if (r.status === 404) return null;
      if (!r.ok) return null;
      return await r.json();
    } catch (_) {
      return null;
    }
  };

  // wipeLocalData: borra las 4 tablas del usuario pero NO toca userid/last_sync
  // (la auth se debe limpiar aparte con clearUserCredentials).
  // El server mantiene los datos, así que un re-login con el mismo email los
  // restaura vía pullFromServer → importData.
  const wipeLocalData = () => {
    run("DELETE FROM predictions");
    run("DELETE FROM user_scores");
    run("DELETE FROM notes");
    run("DELETE FROM preferences");
  };

  // ===== SYNC =====
  const exportData = () => {
    return {
      predictions: getAllPredictions(),
      user_scores: getAllUserScores(),
      notes: exec("SELECT * FROM notes"),
      preferences: exec("SELECT * FROM preferences"),
    };
  };

  const importData = (data) => {
    if (!data || typeof data !== "object") return false;
    // Reemplazar predicciones (last-write-wins por match_id)
    if (Array.isArray(data.predictions)) {
      // Limpiar y re-insertar
      run("DELETE FROM predictions");
      for (const p of data.predictions) {
        if (!p || !p.match_id) continue;
        const winner = p.winner || null;
        run(
          `INSERT INTO predictions (match_id, home_pred, away_pred, winner, updated_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(match_id) DO UPDATE SET
             home_pred=excluded.home_pred,
             away_pred=excluded.away_pred,
             winner=excluded.winner,
             updated_at=excluded.updated_at`,
          [String(p.match_id), p.home_pred ?? 0, p.away_pred ?? 0, winner, p.updated_at || new Date().toISOString()]
        );
      }
    }
    if (Array.isArray(data.user_scores)) {
      run("DELETE FROM user_scores");
      for (const s of data.user_scores) {
        if (!s || !s.match_id) continue;
        run(
          `INSERT INTO user_scores (match_id, home_score, away_score, status, updated_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(match_id) DO UPDATE SET
             home_score=excluded.home_score,
             away_score=excluded.away_score,
             status=excluded.status,
             updated_at=excluded.updated_at`,
          [String(s.match_id), s.home_score ?? 0, s.away_score ?? 0, s.status || "finished", s.updated_at || new Date().toISOString()]
        );
      }
    }
    if (Array.isArray(data.notes)) {
      run("DELETE FROM notes");
      for (const n of data.notes) {
        if (!n || !n.match_id) continue;
        run(
          `INSERT INTO notes (match_id, text, updated_at)
           VALUES (?, ?, ?)
           ON CONFLICT(match_id) DO UPDATE SET
             text=excluded.text,
             updated_at=excluded.updated_at`,
          [String(n.match_id), n.text || "", n.updated_at || new Date().toISOString()]
        );
      }
    }
    if (Array.isArray(data.preferences)) {
      run("DELETE FROM preferences");
      for (const p of data.preferences) {
        if (!p || !p.key) continue;
        run(
          `INSERT INTO preferences (key, value) VALUES (?, ?)
           ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
          [p.key, String(p.value || "")]
        );
      }
    }
    return true;
  };

  const isLocalEmpty = () => {
    return getAllPredictions().length === 0
      && getAllUserScores().length === 0
      && exec("SELECT * FROM notes").length === 0;
  };

  // pullFromServer: trae los datos del server y los importa (last-write-wins
  // por diseño: reemplaza local con server). Retorna { status, ... }.
  const pullFromServer = async () => {
    const userId = getUserId();
    const emailId = getEmailId();
    if (!userId) return { status: "no_user" };
    syncState.inFlight = (async () => {
      try {
        const r = await fetch(`${SYNC_ENDPOINT}?u=u:${userId}`, {
          method: "GET",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(8000),
        });
        if (r.status === 404) {
          // Verificar si el email existe con metadata (PIN incorrecto o falta PIN).
          if (emailId && userId !== emailId) {
            // El usuario actual tiene PIN (userId != emailId). Chequear metadata.
            const meta = await getMetadata(emailId);
            if (meta && meta.data && meta.data.has_pin) {
              // Email existe con PIN, pero los datos no están en este userId → PIN incorrecto.
              return { status: "wrong_pin" };
            }
          } else if (emailId && userId === emailId) {
            // El usuario actual NO tiene PIN. Chequear si email requiere PIN.
            const meta = await getMetadata(emailId);
            if (meta && meta.data && meta.data.has_pin) {
              return { status: "pin_required" };
            }
          }
          // Usuario nuevo en server. Si local no está vacío, lo subimos.
          if (!isLocalEmpty()) {
            await pushToServerNow();
            syncState.lastSync = new Date().toISOString();
            localStorage.setItem(LAST_SYNC_KEY, syncState.lastSync);
            syncState.enabled = true;
            syncState.pendingPush = false;
            emitSync();
            return { status: "uploaded_local", hadChanges: true };
          }
          syncState.enabled = true;
          emitSync();
          return { status: "empty" };
        }
        if (r.status === 503) {
          syncState.enabled = false;
          emitSync();
          return { status: "kv_unavailable" };
        }
        if (!r.ok) {
          return { status: "error", code: r.status };
        }
        const remote = await r.json();
        // El server devuelve { data: {...}, updated_at: "..." }
        if (!remote || !remote.data) {
          return { status: "invalid_response" };
        }
        // Importar siempre (last-write-wins)
        const localWasEmpty = isLocalEmpty();
        importData(remote.data);
        syncState.lastSync = remote.updated_at || new Date().toISOString();
        localStorage.setItem(LAST_SYNC_KEY, syncState.lastSync);
        syncState.enabled = true;
        syncState.pendingPush = false;
        emitSync();
        return { status: "pulled", hadChanges: !localWasEmpty, updated_at: syncState.lastSync };
      } catch (err) {
        return { status: "network_error", message: err && err.message };
      } finally {
        syncState.inFlight = null;
      }
    })();
    return syncState.inFlight;
  };

  const pushToServerNow = async () => {
    const userId = getUserId();
    const emailId = getEmailId();
    if (!userId) return { status: "no_user" };
    syncState.inFlight = (async () => {
      try {
        const payload = exportData();
        const r = await fetch(`${SYNC_ENDPOINT}?u=u:${userId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(8000),
        });
        if (r.status === 503) {
          syncState.enabled = false;
          emitSync();
          return { status: "kv_unavailable" };
        }
        if (!r.ok) {
          return { status: "error", code: r.status };
        }
        const body = await r.json();
        syncState.lastSync = body.updated_at || new Date().toISOString();
        localStorage.setItem(LAST_SYNC_KEY, syncState.lastSync);
        syncState.enabled = true;
        syncState.pendingPush = false;
        emitSync();
        // Si el usuario tiene PIN, también escribir metadata m:<emailId>.
        if (emailId && userId !== emailId) {
          await pushMetadata(emailId, { has_pin: true, updated_at: syncState.lastSync });
        }
        return { status: "pushed", updated_at: syncState.lastSync };
      } catch (err) {
        return { status: "network_error", message: err && err.message };
      } finally {
        syncState.inFlight = null;
      }
    })();
    return syncState.inFlight;
  };

  // schedulePush: encola un PUT debounced (1.5s). Llamado por set/setPrediction/etc.
  const schedulePush = (delay = 1500) => {
    if (!getUserId()) return;
    syncState.pendingPush = true;
    emitSync();
    if (syncState._pushTimer) clearTimeout(syncState._pushTimer);
    syncState._pushTimer = setTimeout(() => {
      pushToServerNow().catch(() => {});
    }, delay);
  };

  const getSyncState = () => ({ ...syncState });

  const getLastSync = () => syncState.lastSync;

  // ===== RESET =====
  const resetAll = () => {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(USERID_KEY);
    localStorage.removeItem(LAST_SYNC_KEY);
    location.reload();
  };

  return {
    init, save,
    setUserScore, getUserScore, getAllUserScores, clearUserScore, clearAllUserScores,
    setPrediction, getAllPredictions, clearAllPredictions,
    setNote, getNote,
    setPref, getPref,
    // Auth + sync
    setUserCredentials, getUserId, getEmailId, clearUserCredentials, wipeLocalData,
    validateCredentials,
    pullFromServer, pushToServerNow, schedulePush,
    getSyncState, getLastSync, onSyncChange,
    validateEmail, validatePin,
    resetAll,
  };
})();
