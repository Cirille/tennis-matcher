export function sendAdminCommand(socket, state, action, value, id = crypto.randomUUID()) {
  const command = { id, sessionId: state.sessionId, revision: state.revision, action, value };
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const send = () => {
      if (!socket.connected) return reject(new Error('Connection lost. Reconnect before making changes.'));
      attempts++;
      socket.timeout(7000).emit('admin_command', command, (error, result) => {
        // Same durable command ID on retry: a lost acknowledgment cannot duplicate a round.
        if (error && attempts < 2 && socket.connected) return send();
        if (error) return reject(new Error('Confirmation was lost. Reconnect and check the current state before retrying.'));
        if (!result?.success) return reject(new Error(result?.error || 'Change failed. Please retry.'));
        resolve(result);
      });
    };
    send();
  });
}
