function getPenalty(idA, idB, idC, idD, players, matchHistory) {
  let penalty = 0;
  const pA = players[idA], pB = players[idB], pC = players[idC], pD = players[idD];
  
  // Skill Balancing
  penalty += (Math.abs(pA.level - pB.level) + Math.abs(pC.level - pD.level)) * 10;
  penalty += Math.abs((pA.level + pB.level) - (pC.level + pD.level)) * 50;

  // History Overlap
  const checkHistory = (targetId, otherId, isTeammate) => {
    for (const round of matchHistory) {
      for (const c of round.courts) {
        const sideA = c.sideA || [];
        const sideB = c.sideB || [];
        if (sideA.includes(targetId)) {
           if (isTeammate && sideA.includes(otherId)) penalty += 200;
           if (!isTeammate && sideB.includes(otherId)) penalty += 100;
        } else if (sideB.includes(targetId)) {
           if (isTeammate && sideB.includes(otherId)) penalty += 200;
           if (!isTeammate && sideA.includes(otherId)) penalty += 100;
        }
      }
    }
  };

  // Evaluate overlap combinations
  checkHistory(idA, idB, true);
  checkHistory(idC, idD, true);
  checkHistory(idA, idC, false);
  checkHistory(idA, idD, false);
  checkHistory(idB, idC, false);
  checkHistory(idB, idD, false);

  return penalty;
}

function autoMatchmake(courts, players, idleQueue, matchHistory) {
  let availableSlots = courts.length * 4;

  let allAvailablePlayers = [...idleQueue];
  courts.forEach(c => {
     if (c.sideA) c.sideA.forEach(pid => allAvailablePlayers.push(pid));
     if (c.sideB) c.sideB.forEach(pid => allAvailablePlayers.push(pid));
     c.sideA = [];
     c.sideB = [];
  });

  let playerPool = allAvailablePlayers.map(id => players[id]).filter(Boolean);
  
  // Sort by idle rounds descending
  playerPool.sort((a, b) => b.idle_rounds - a.idle_rounds);

  let topN = playerPool.slice(0, availableSlots);
  let leftOver = playerPool.slice(availableSlots);

  // Sort top N by level ASCENDING (1 is best, 10 is worst)
  topN.sort((a, b) => a.level - b.level);

  let pIdx = 0;
  for (let c of courts) {
    c.sideA = [];
    c.sideB = [];

    // Attempt to batch format doubles teams algorithmically
    if (topN.length - pIdx >= 4) {
      const id0 = topN[pIdx].id, id1 = topN[pIdx+1].id, id2 = topN[pIdx+2].id, id3 = topN[pIdx+3].id;
      
      const p1 = getPenalty(id0, id1, id2, id3, players, matchHistory); // (0,1) vs (2,3)
      const p2 = getPenalty(id0, id2, id1, id3, players, matchHistory); // (0,2) vs (1,3)
      const p3 = getPenalty(id0, id3, id1, id2, players, matchHistory); // (0,3) vs (1,2)

      let bestSideA, bestSideB;
      if (p1 <= p2 && p1 <= p3) { bestSideA = [id0, id1]; bestSideB = [id2, id3]; }
      else if (p2 <= p1 && p2 <= p3) { bestSideA = [id0, id2]; bestSideB = [id1, id3]; }
      else { bestSideA = [id0, id3]; bestSideB = [id1, id2]; }

      c.sideA = bestSideA;
      c.sideB = bestSideB;
      bestSideA.forEach(id => { players[id].courtId = c.id; players[id].side = 'A'; });
      bestSideB.forEach(id => { players[id].courtId = c.id; players[id].side = 'B'; });
      pIdx += 4;
    } else if (topN.length - pIdx >= 2) {
      // Not enough for doubles, just fill A and B normally
      let p1 = topN[pIdx++]; p1.courtId = c.id; p1.side = 'A'; c.sideA.push(p1.id);
      let p2 = topN[pIdx++]; p2.courtId = c.id; p2.side = 'B'; c.sideB.push(p2.id);
    } else {
      break; // 1 or 0 players left, skip matching
    }
  }

  let unmatchedPlayers = [];
  while (pIdx < topN.length) {
     unmatchedPlayers.push(topN[pIdx++].id);
  }

  const allIdleIds = [...unmatchedPlayers, ...leftOver.map(p => p.id)];
  allIdleIds.forEach(id => {
    if (players[id]) {
       players[id].courtId = null;
       players[id].side = null;
    }
  });
  
  return allIdleIds; // returning the new idleQueue mapped state
}

module.exports = { autoMatchmake, getPenalty };
