/**
 * E2E 专用“假 Trystero”（仅在 test/e2e 生成的测试页面里加载，不进生产）。
 *
 * 目的：让多个**真实浏览器标签页/上下文**在**离线**情况下互相连通，从而可以在真
 * DOM/真事件环境下跑联机流程，而不依赖公共中继与真实网络。
 *
 * 消息不走页面之间直连，而是交给 CDP 驱动（test/e2e/run.js）中转：
 *   页面 → __cdpSend(binding) → 驱动 → 其它页面 window.__t.*
 * 每个页面用 URL 上的 ?_peer=xxx 作为自己的身份（等价于 Trystero 的 selfId）。
 */
(function () {
  const selfId = (new URLSearchParams(location.search).get('_peer')) || 'peer?';
  const rooms = {};

  function send(m) { try { window.__cdpSend(JSON.stringify(m)); } catch (e) { /* 驱动未接上 */ } }

  function makeRoom(roomId) {
    const r = { actions: new Map(), peers: new Set(), room: null };
    rooms[roomId] = r;
    const room = {
      selfId,
      getPeers() { const o = {}; r.peers.forEach(id => { o[id] = true; }); return o; },
      makeAction(name) {
        const act = {
          onMessage: null,
          send(data, opts) { send({ t: 'msg', roomId, action: name, data, target: (opts && opts.target) || null }); }
        };
        r.actions.set(name, act);
        return act;
      },
      onPeerJoin: null,
      onPeerLeave: null,
      leave() { send({ t: 'leave', roomId }); r.peers.clear(); return Promise.resolve(); }
    };
    r.room = room;
    send({ t: 'join', roomId });
    return room;
  }

  // 供驱动调用
  window.__t = {
    peerJoin(roomId, id) { const r = rooms[roomId]; if (r) { r.peers.add(id); if (r.room && r.room.onPeerJoin) r.room.onPeerJoin(id); } },
    peerLeave(roomId, id) { const r = rooms[roomId]; if (r) { r.peers.delete(id); if (r.room && r.room.onPeerLeave) r.room.onPeerLeave(id); } },
    msg(roomId, action, data, from, target) {
      const r = rooms[roomId]; if (!r) return;
      const a = r.actions.get(action);
      if (a && typeof a.onMessage === 'function') a.onMessage(data, { peerId: from });
    }
  };

  window.Trystero = { selfId, joinRoom: (config, roomId) => makeRoom(roomId) };
})();
