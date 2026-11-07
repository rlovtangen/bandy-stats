const https = require('https');

const BASE_URL = 'https://api.app04.nbf.clh.no/api/v1/ta';
const DEFAULT_TOURNAMENT_ID = 450237;
const TOURNAMENT_ID = process.argv[2] ? parseInt(process.argv[2], 10) : DEFAULT_TOURNAMENT_ID;

function fetch(url, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Failed to parse JSON from ${url}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeout, () => {
      req.destroy();
      reject(new Error(`Timeout fetching ${url}`));
    });
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getMatches(tournamentId) {
  const url = `${BASE_URL}/TournamentMatches/?tournamentId=${tournamentId}`;
  const data = await fetch(url);
  return data.matches || data;
}

async function getMatchIncidents(matchId, retries = 3) {
  const url = `${BASE_URL}/MatchIncidents/?matchId=${matchId}`;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fetch(url, 30000);
    } catch (e) {
      if (attempt === retries) {
        console.error(`\nFailed to fetch incidents for match ${matchId} after ${retries} attempts`);
        return { matchIncidents: [] };
      }
      await sleep(1000 * attempt);
    }
  }
}

async function getMatchTeamMembers(matchId, retries = 3) {
  const url = `${BASE_URL}/MatchTeamMembers/${matchId}/`;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fetch(url, 30000);
    } catch (e) {
      if (attempt === retries) {
        console.error(`\nFailed to fetch team members for match ${matchId} after ${retries} attempts`);
        return [];
      }
      await sleep(1000 * attempt);
    }
  }
}

async function main() {
  console.log('Henter kamper fra turnering', TOURNAMENT_ID, '...\n');

  const matchesData = await getMatches(TOURNAMENT_ID);
  const matches = Array.isArray(matchesData) ? matchesData : matchesData.matches || [];

  console.log(`Fant ${matches.length} kamper\n`);

  // Player stats: { personId: { firstName, lastName, goals, assists, team, gamesPlayed } }
  const playerStats = {};
  const gamesPlayedCount = {}; // Track games played separately to avoid duplicates

  // Create lookup for match team names
  const matchTeams = {};
  for (const m of matches) {
    matchTeams[m.matchId] = {
      home: m.hometeam || '',
      away: m.awayteam || ''
    };
  }

  let processedCount = 0;

  // Filter to only matches that have been played (have a result and not walkover)
  const playedMatches = matches.filter(m => {
    const hasResult = m.matchResult && m.matchResult.homeGoals !== null && m.matchResult.awayGoals !== null;
    const isWalkover = m.nonPlayReason || (m.matchResult?.matchEndResult || '').toLowerCase().includes('walkover');
    return hasResult && !isWalkover;
  });

  const walkovers = matches.filter(m => m.nonPlayReason || (m.matchResult?.matchEndResult || '').toLowerCase().includes('walkover')).length;
  const pending = matches.length - playedMatches.length - walkovers;

  console.log(`Spilte kamper: ${playedMatches.length}, Walkovers: ${walkovers}, Kommende: ${pending}\n`);
  console.log(`Henter hendelser fra ${playedMatches.length} spilte kamper...\n`);

  // Process in batches of 5 with delay between batches
  const batchSize = 5;
  for (let i = 0; i < playedMatches.length; i += batchSize) {
    const batch = playedMatches.slice(i, i + batchSize);

    // Fetch both incidents and team members in parallel
    const [incidentResults, memberResults] = await Promise.all([
      Promise.all(batch.map(m => getMatchIncidents(m.matchId))),
      Promise.all(batch.map(m => getMatchTeamMembers(m.matchId)))
    ]);

    // Small delay between batches to avoid rate limiting
    if (i + batchSize < playedMatches.length) {
      await sleep(500);
    }

    for (let j = 0; j < batch.length; j++) {
      const match = batch[j];
      const incidents = incidentResults[j].matchIncidents || [];
      const members = memberResults[j] || [];
      const teams = matchTeams[match.matchId] || { home: '', away: '' };

      // Count games played from team members
      for (const member of members) {
        if (member.memberType !== 'Player' || !member.played) continue;

        const { personId, firstName, lastName, teamOrgId } = member;
        if (!personId) continue;

        // Initialize games played tracking
        if (!gamesPlayedCount[personId]) {
          gamesPlayedCount[personId] = new Set();
        }
        gamesPlayedCount[personId].add(match.matchId);

        // Determine team name from teamOrgId
        const isHomeTeam = teamOrgId === match.hometeamId;
        const teamName = isHomeTeam ? teams.home : teams.away;

        // Initialize player if not exists
        if (!playerStats[personId]) {
          playerStats[personId] = {
            personId,
            firstName: firstName || '',
            lastName: lastName || '',
            team: teamName,
            goals: 0,
            assists: 0
          };
        }

        // Update team name if we have it
        if (teamName && !playerStats[personId].team) {
          playerStats[personId].team = teamName;
        }
      }

      // Process incidents for goals and assists
      for (const incident of incidents) {
        const subType = incident.incidentSubType;
        if (subType !== 'Målscorer' && subType !== 'Assist') continue;

        const { personId, firstName, lastName, team } = incident;
        if (!personId) continue;

        // Map H/B to actual team name
        const teamName = team === 'H' ? teams.home : team === 'B' ? teams.away : '';

        if (!playerStats[personId]) {
          playerStats[personId] = {
            personId,
            firstName: firstName || '',
            lastName: lastName || '',
            team: teamName,
            goals: 0,
            assists: 0
          };
        }

        // Update team name if we have it (in case first incident didn't have it)
        if (teamName && !playerStats[personId].team) {
          playerStats[personId].team = teamName;
        }

        if (subType === 'Målscorer') {
          playerStats[personId].goals++;
        } else if (subType === 'Assist') {
          playerStats[personId].assists++;
        }
      }
    }

    processedCount += batch.length;
    process.stdout.write(`\rBehandlet ${processedCount}/${playedMatches.length} kamper`);
  }

  // Add games played count to player stats
  for (const personId in playerStats) {
    playerStats[personId].gamesPlayed = gamesPlayedCount[personId]?.size || 0;
  }

  console.log('\n\n');

  // Convert to array and sort
  const players = Object.values(playerStats);

  // Top scorers
  const topScorers = [...players]
    .filter(p => p.goals > 0)
    .sort((a, b) => b.goals - a.goals)
    .slice(0, 20);

  // Top assists
  const topAssisters = [...players]
    .filter(p => p.assists > 0)
    .sort((a, b) => b.assists - a.assists)
    .slice(0, 20);

  // Top points (goals + assists)
  const topPoints = [...players]
    .map(p => ({ ...p, points: p.goals + p.assists }))
    .filter(p => p.points > 0)
    .sort((a, b) => b.points - a.points)
    .slice(0, 20);

  // Print results
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('                    TOPPSCORERE (MÅL)');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('Plass  Mål  Spiller                              PersonId');
  console.log('───────────────────────────────────────────────────────────────');
  topScorers.forEach((p, i) => {
    const name = `${p.firstName} ${p.lastName}`.padEnd(35);
    console.log(`${String(i + 1).padStart(3)}.  ${String(p.goals).padStart(3)}  ${name}  ${p.personId}`);
  });

  console.log('\n');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('                    TOPPSPILLERE (ASSISTS)');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('Plass  Ast  Spiller                              PersonId');
  console.log('───────────────────────────────────────────────────────────────');
  topAssisters.forEach((p, i) => {
    const name = `${p.firstName} ${p.lastName}`.padEnd(35);
    console.log(`${String(i + 1).padStart(3)}.  ${String(p.assists).padStart(3)}  ${name}  ${p.personId}`);
  });

  console.log('\n');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('                 TOPPSPILLERE (MÅL + ASSISTS)');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('Plass  Mål  Ast  Tot  Spiller                    PersonId');
  console.log('───────────────────────────────────────────────────────────────');
  topPoints.forEach((p, i) => {
    const name = `${p.firstName} ${p.lastName}`.padEnd(27);
    console.log(`${String(i + 1).padStart(3)}.  ${String(p.goals).padStart(3)}  ${String(p.assists).padStart(3)}  ${String(p.points).padStart(3)}  ${name}  ${p.personId}`);
  });

  // Summary
  const totalGoals = players.reduce((sum, p) => sum + p.goals, 0);
  const totalAssists = players.reduce((sum, p) => sum + p.assists, 0);
  const uniquePlayers = players.length;

  console.log('\n');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('                         OPPSUMMERING');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Totalt kamper:           ${matches.length}`);
  console.log(`Spilte kamper:           ${playedMatches.length}`);
  console.log(`Walkovers:               ${walkovers}`);
  console.log(`Kommende kamper:         ${pending}`);
  console.log(`Totalt antall mål:       ${totalGoals}`);
  console.log(`Totalt antall assists:   ${totalAssists}`);
  console.log(`Unike spillere:          ${uniquePlayers}`);

  // Export to CSV
  const fs = require('fs');

  // All players CSV (sorted by total points)
  const allPlayersSorted = [...players]
    .map(p => ({ ...p, points: p.goals + p.assists }))
    .sort((a, b) => b.points - a.points || b.goals - a.goals);

  const csvHeader = 'rank;personId;firstName;lastName;team;gamesPlayed;goals;assists;points;goalsPerGame;assistsPerGame;pointsPerGame\n';
  const csvRows = allPlayersSorted.map((p, index) => {
    const gp = p.gamesPlayed || 0;
    const goalsPerGame  = gp > 0 ? (p.goals   / gp).toFixed(2) : '0.00';
    const assistsPerGame = gp > 0 ? (p.assists / gp).toFixed(2) : '0.00';
    const pointsPerGame  = gp > 0 ? (p.points  / gp).toFixed(2) : '0.00';
    return `${index + 1};${p.personId};${p.firstName};${p.lastName};${p.team || ''};${gp};${p.goals};${p.assists};${p.points};${goalsPerGame};${assistsPerGame};${pointsPerGame}`;
  }).join('\n');

  const csvContent = csvHeader + csvRows;
  const csvFilename = `bandy-stats-${TOURNAMENT_ID}.csv`;
  fs.writeFileSync(csvFilename, csvContent);

  console.log('\n');
  console.log(`CSV eksportert til: ${csvFilename}`);
}

main().catch(console.error);
