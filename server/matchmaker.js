function historyIndex(history) {
  const teammates = new Map(), opponents = new Map();
  const key = (a, b) => [a, b].sort().join(':');
  const add = (map, a, b) => map.set(key(a, b), (map.get(key(a, b)) || 0) + 1);
  for (const round of history) for (const court of round.courts) {
    const a = court.sideA || [], b = court.sideB || [];
    if (a.length === 2) add(teammates, ...a);
    if (b.length === 2) add(teammates, ...b);
    for (const first of a) for (const second of b) add(opponents, first, second);
  }
  return { teammate: (a, b) => teammates.get(key(a, b)) || 0, opponent: (a, b) => opponents.get(key(a, b)) || 0 };
}
function getPenalty(a, b, c, d, players, history, index = historyIndex(history)) {
  const level = id => players[id].level;
  return (Math.abs(level(a) - level(b)) + Math.abs(level(c) - level(d))) * 10
    + Math.abs(level(a) + level(b) - level(c) - level(d)) * 50
    + (index.teammate(a, b) + index.teammate(c, d)) * 200
    + (index.opponent(a, c) + index.opponent(a, d) + index.opponent(b, c) + index.opponent(b, d)) * 100;
}
function autoMatchmake(courts, players, idleQueue, matchHistory) {
  const ids = [...new Set([...idleQueue, ...courts.flatMap(c => [...c.sideA, ...c.sideB])])].filter(id => Object.hasOwn(players, id));
  const available = ids.map(id => players[id]).filter(p => p.available !== false).sort((a, b) => b.idle_rounds - a.idle_rounds);
  // Choose who plays by waiting time first; only then optimize teams.
  const slots = Math.min(courts.length * 4, available.length);
  const selected = available.slice(0, slots - slots % 2).sort((a, b) => a.level - b.level).map(p => p.id);
  const index = historyIndex(matchHistory);
  const bestGroup = group => {
    const [a, b, c, d] = group;
    return [[a, b, c, d], [a, c, b, d], [a, d, b, c]].map(ids => ({ ids, score: getPenalty(...ids, players, matchHistory, index) })).sort((a, b) => a.score - b.score)[0];
  };
  const groups = [];
  let position = 0;
  while (selected.length - position >= 4) { groups.push(bestGroup(selected.slice(position, position + 4))); position += 4; }
  // Bounded adjacent-court exchanges avoid trapping the same four people together.
  // Waiting-time priority is unchanged and skill balance remains in the score.
  for (let pass = 0; pass < 2; pass++) for (let i = 0; i + 1 < groups.length; i++) {
    let left = groups[i], right = groups[i + 1];
    for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) {
      const x = [...left.ids], y = [...right.ids]; [x[a], y[b]] = [y[b], x[a]];
      const nextLeft = bestGroup(x), nextRight = bestGroup(y);
      if (nextLeft.score + nextRight.score < left.score + right.score) { left = nextLeft; right = nextRight; }
    }
    groups[i] = left; groups[i + 1] = right;
  }
  for (const court of courts) { court.sideA = []; court.sideB = []; }
  const used = new Set();
  const assign = (court, id, side) => { court['side' + side].push(id); players[id].courtId = court.id; players[id].side = side; used.add(id); };
  groups.forEach((group, i) => group.ids.forEach((id, j) => assign(courts[i], id, j < 2 ? 'A' : 'B')));
  if (selected.length - position >= 2 && courts[groups.length]) {
    assign(courts[groups.length], selected[position], 'A'); assign(courts[groups.length], selected[position + 1], 'B');
  }
  const idle = ids.filter(id => !used.has(id));
  idle.forEach(id => { players[id].courtId = null; players[id].side = null; });
  return idle;
}
module.exports = { autoMatchmake, getPenalty };
