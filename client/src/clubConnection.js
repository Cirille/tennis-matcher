// Both dashboards re-authenticate their club room after every socket reconnect.
export function connectToClub(socket, getAuth, { onJoined = () => {}, onError = () => {}, onDisconnected = () => {} } = {}) {
  let active = true;
  let revision = 0;
  const auth = () => typeof getAuth === 'function' ? getAuth() : getAuth;
  const onConnect = () => {
    const attempt = ++revision;
    socket.emit('join_club_room', auth(), (result) => {
      if (!active || attempt !== revision) return;
      if (result?.success) onJoined();
      else onError(result?.error || 'Unable to join the club room.');
    });
  };
  const onDisconnect = () => { revision += 1; onDisconnected(); };
  const onConnectError = () => onError('Unable to connect to the server. Retrying...');
  socket.on('connect', onConnect);
  socket.on('disconnect', onDisconnect);
  socket.on('connect_error', onConnectError);
  if (socket.connected) onConnect();
  else socket.connect();

  return () => {
    active = false;
    revision += 1;
    socket.off('connect', onConnect);
    socket.off('disconnect', onDisconnect);
    socket.off('connect_error', onConnectError);
    if (socket.connected) socket.emit('leave_club_room', { clubId: auth().clubId });
  };
}
