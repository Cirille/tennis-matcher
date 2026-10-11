import test from 'node:test';
import assert from 'node:assert/strict';
import { sendAdminCommand } from './adminCommand.js';

test('commands never buffer while offline', async () => {
  let calls = 0;
  await assert.rejects(sendAdminCommand({ connected: false, timeout() { calls++; } }, {}, 'add_court', {}, 'test-id'), /Connection lost/);
  assert.equal(calls, 0);
});
test('lost acknowledgments retry the identical command, including its ID and revision', async () => {
  const calls = [];
  const socket = { connected: true, timeout() { return { emit(event, payload, callback) { calls.push({ event, payload }); callback(calls.length === 1 ? new Error('timeout') : null, { success: true }); } }; } };
  await sendAdminCommand(socket, { sessionId: 'session-a', revision: 3 }, 'toggle_game', false, 'same-id');
  assert.equal(calls.length, 2); assert.deepEqual(calls[0], calls[1]); assert.equal(calls[0].payload.revision, 3);
});
test('a conflict is surfaced without blindly retrying a new revision', async () => {
  let attempts = 0;
  const socket = { connected: true, timeout() { return { emit(event, payload, callback) { attempts++; callback(null, { success: false, error: 'Session changed', code: 'CONFLICT' }); } }; } };
  await assert.rejects(sendAdminCommand(socket, { sessionId: 's', revision: 4 }, 'toggle_game', false, 'id'), /Session changed/);
  assert.equal(attempts, 1);
});
