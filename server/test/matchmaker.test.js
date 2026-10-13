const test = require('node:test');
const assert = require('node:assert/strict');
const { autoMatchmake } = require('../matchmaker');

function setup(count, courtCount = 1) {
  const players = Object.fromEntries(Array.from({ length: count }, (_, i) => [String(i), { id: String(i), level: 5, idle_rounds: 0, available: true, courtId: null, side: null }]));
  const courts = Array.from({ length: courtCount }, (_, i) => ({ id: `court-${i}`, sideA: [], sideB: [] }));
  return { players, courts };
}
test('matchmaking preserves every player exactly once for odd counts and duplicate input', () => {
  for (const count of [0, 1, 2, 3, 5, 7, 17]) {
    const { players, courts } = setup(count, 3);
    const idle = autoMatchmake(courts, players, [...Object.keys(players), ...Object.keys(players)], []);
    const assigned = courts.flatMap(c => [...c.sideA, ...c.sideB]);
    assert.equal(new Set([...idle, ...assigned]).size, count);
    assert.equal(idle.length + assigned.length, count);
    assert.ok(courts.every(c => c.sideA.length === c.sideB.length && c.sideA.length <= 2));
  }
});
test('waiting players take priority and availability is independent of phone connectivity', () => {
  const { players, courts } = setup(7);
  players['6'].idle_rounds = 3; players['6'].disconnected = true;
  players['0'].available = false; players['0'].idle_rounds = 99;
  const idle = autoMatchmake(courts, players, Object.keys(players), []);
  assert.equal(idle.includes('6'), false); assert.equal(idle.includes('0'), true);
});
test('equal-level doubles rotate partners and exchange players across courts', () => {
  const { players, courts } = setup(8, 2);
  const firstIdle = autoMatchmake(courts, players, Object.keys(players), []);
  const first = structuredClone(courts);
  autoMatchmake(courts, players, firstIdle, [{ courts: first }]);
  const oldGroup = new Set([...first[0].sideA, ...first[0].sideB]);
  assert.ok([...courts[0].sideA, ...courts[0].sideB].some(id => !oldGroup.has(id)));
  for (const court of courts) for (const side of ['sideA', 'sideB']) {
    assert.ok(first.every(old => !['sideA', 'sideB'].some(previous => old[previous].every(id => court[side].includes(id)))));
  }
});
test('the longest-waiting player still plays when an odd player must sit out', () => {
  const { players, courts } = setup(7, 2);
  players['6'].idle_rounds = 4; players['6'].level = 10;
  const idle = autoMatchmake(courts, players, Object.keys(players), []);
  assert.equal(idle.includes('6'), false); assert.equal(idle.length, 1);
});
test('skill balancing chooses equal team totals when possible', () => {
  const { players, courts } = setup(4);
  [1, 2, 9, 10].forEach((level, i) => { players[String(i)].level = level; });
  autoMatchmake(courts, players, Object.keys(players), []);
  const total = side => courts[0][side].reduce((sum, id) => sum + players[id].level, 0);
  assert.equal(total('sideA'), total('sideB'));
});
