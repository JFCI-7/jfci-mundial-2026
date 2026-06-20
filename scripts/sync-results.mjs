#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TARGET = resolve(__dirname, "..", "mundial2026_calendario.json");
const SOURCE =
  "https://raw.githubusercontent.com/upbound-web/worldcup-live.json/master/2026/worldcup.json";

const NAME_MAP = {
  "united states": "USA",
  "usa": "United States",
  "bosnia and herzegovina": "Bosnia & Herzegovina",
  "bosnia & herzegovina": "Bosnia and Herzegovina",
  "democratic republic of the congo": "DR Congo",
  "dr congo": "Democratic Republic of the Congo",
  "curaçao": "Curacao",
  curacao: "Curaçao",
};

const norm = (name) => {
  const ascii = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/-/g, " ")
    .replace(/[^a-z ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return NAME_MAP[ascii] || name;
};

const findMatch = (sourceMatches, date, hName, aName) => {
  const nH = norm(hName);
  const nA = norm(aName);
  return sourceMatches.find((m) => {
    if (m.date !== date) return false;
    const s1 = norm(m.team1);
    const s2 = norm(m.team2);
    return (
      (s1 === nH && s2 === nA) ||
      (NAME_MAP[s1] === hName && NAME_MAP[s2] === aName)
    );
  });
};

const goalMinute = (g) => {
  let m = String(g.minute);
  if (g.offset) m += "+" + g.offset;
  return m;
};

const htFromGoals = (scorers) =>
  scorers.filter((s) => parseInt(s.minute, 10) <= 45).length;

const buildScorers = (goals, isHome, team1Norm, team2Norm) => {
  const teamName = isHome ? team1Norm : team2Norm;
  return goals
    .filter((g) => {
      const gTeam = g.owngoal
        ? isHome
          ? team2Norm
          : team1Norm
        : isHome
          ? team1Norm
          : team2Norm;
      return norm(gTeam) === norm(teamName);
    })
    .map((g) => {
      const scorer = { player: g.name, minute: goalMinute(g) };
      if (g.penalty) scorer.note = "penalty";
      if (g.owngoal) scorer.note = "OG";
      return scorer;
    });
};

// --- main ---
const targetData = JSON.parse(readFileSync(TARGET, "utf-8"));
const resp = await fetch(SOURCE);
if (!resp.ok) {
  console.error(`fetch failed: ${resp.status}`);
  process.exit(0);
}
const sourceData = await resp.json();
const srcMatches = sourceData.matches.filter((m) => m.score?.ft);

let updated = 0;
for (const tm of targetData.matches.group_stage) {
  if (tm.status === "finished") continue;

  const src = findMatch(srcMatches, tm.date, tm.home_team.name, tm.away_team.name);
  if (!src || !src.score?.ft) continue;

  const [h, a] = src.score.ft;
  tm.home_score = h;
  tm.away_score = a;
  tm.status = "finished";
  tm.time_elapsed = "90";

  if (src.score.ht) {
    tm.home_ht = src.score.ht[0];
    tm.away_ht = src.score.ht[1];
  } else {
    const hg = buildScorers(src.goals1 || [], true, src.team1, src.team2);
    const ag = buildScorers(src.goals2 || [], false, src.team1, src.team2);
    tm.home_ht = htFromGoals(hg);
    tm.away_ht = htFromGoals(ag);
  }

  tm.home_scorers = buildScorers(
    src.goals1 || [],
    true,
    src.team1,
    src.team2,
  );
  tm.away_scorers = buildScorers(
    src.goals2 || [],
    false,
    src.team1,
    src.team2,
  );

  console.log(
    `  ${tm.home_team.name} ${h}-${a} ${tm.away_team.name} (${tm.date})`,
  );
  updated++;
}

if (updated === 0) {
  console.log("No new results.");
  process.exit(0);
}

writeFileSync(TARGET, JSON.stringify(targetData, null, 2) + "\n");
console.log(`Synced ${updated} match(es).`);
