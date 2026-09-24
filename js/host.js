(function () {
  "use strict";

  const MR = window.MR;
  const map = document.getElementById("host-map");
  const status = document.getElementById("host-status");
  const statusDot = document.getElementById("host-status-dot");
  const qrElement = document.getElementById("qr-code");
  const inviteLink = document.getElementById("invite-link");
  const inviteHint = document.getElementById("invite-hint");
  const copyButton = document.getElementById("copy-link");
  const state = MR.blankState();
  const token = MR.randomId();
  const slots = [1, 2].map(id => ({ id, clientId: null, connection: null, gesture: null, status: "Waiting" }));
  let nextObjectId = 1;
  let peer;
  let inviteUrl = "";
  let reconnectTimer = null;

  function connectedCount() { return slots.filter(slot => slot.status === "Connected").length; }

  function setHostStatus(text, tone) {
    status.textContent = text;
    statusDot.className = `status-dot ${tone || ""}`;
  }

  function renderHost() {
    MR.renderMap(map, state);
    document.getElementById("host-layer-label").textContent = state.layer[0].toUpperCase() + state.layer.slice(1);
    document.getElementById("client-count").textContent = `${connectedCount()} / 2`;
    slots.forEach(slot => {
      const element = document.getElementById(`slot-${slot.id}`);
      element.textContent = slot.status;
      element.className = slot.status.toLowerCase();
    });
  }

  function broadcastState() {
    renderHost();
    const payload = { type: "state", state, connectedCount: connectedCount() };
    slots.forEach(slot => {
      if (slot.connection && slot.connection.open) slot.connection.send(payload);
    });
  }

  function log(controllerId, description) {
    const text = `Controller ${controllerId} → ${description}`;
    document.getElementById("latest-action").textContent = text;
    const list = document.getElementById("event-log");
    const item = document.createElement("li");
    const time = document.createElement("time");
    time.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    item.append(time, document.createTextNode(text));
    list.prepend(item);
    while (list.children.length > 24) list.lastElementChild.remove();
  }

  function createObject(type, controllerId, values) {
    state.objects.push({ id: `o${nextObjectId++}`, type, controllerId, ...values });
  }

  function findPoint(id) { return state.objects.find(object => object.id === id && object.type === "point"); }
  function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  // This is the intended integration point for future MR Studio actions. The
  // transport only supplies validated input; map behavior stays on the Host.
  function handleControllerEvent(controllerId, message) {
    const slot = slots[controllerId - 1];
    if (message.type === "button") {
      log(controllerId, `${message.button} pressed`);
      if (message.button.startsWith("layer:")) {
        state.layer = message.button.slice(6);
        broadcastState();
      } else if (message.button === "finish-polygon") {
        const vertices = state.drafts[controllerId].polygon;
        if (vertices.length >= 3) {
          createObject("polygon", controllerId, { points: vertices.slice() });
          state.drafts[controllerId].polygon = [];
          broadcastState();
        }
      } else if (message.button === "cancel-polygon") {
        state.drafts[controllerId].polygon = [];
        broadcastState();
      }
      return;
    }

    const point = { x: message.x, y: message.y };
    log(controllerId, `${message.tool} ${message.phase} (${point.x.toFixed(3)}, ${point.y.toFixed(3)})`);
    if (message.phase === "down") {
      const target = message.tool === "point" ? findPoint(message.targetId) : null;
      slot.gesture = { tool: message.tool, start: point, targetId: target ? target.id : null };
      return;
    }
    const gesture = slot.gesture;
    if (!gesture || gesture.tool !== message.tool) return;
    if (message.phase === "cancel") { slot.gesture = null; return; }
    if (message.phase === "move") {
      if (gesture.targetId) {
        const target = findPoint(gesture.targetId);
        if (target) { target.x = point.x; target.y = point.y; broadcastState(); }
      }
      return;
    }
    slot.gesture = null;
    if (gesture.targetId) {
      const target = findPoint(gesture.targetId);
      if (target) { target.x = point.x; target.y = point.y; broadcastState(); }
      return;
    }
    if (gesture.tool === "polygon") {
      const vertices = state.drafts[controllerId].polygon;
      // Returning to the highlighted first corner closes the outline. Check
      // before the tap-distance rule so a short drag to that corner also works.
      const start = vertices[0];
      const nearStart = start && Math.hypot((point.x - start.x) * 1000, (point.y - start.y) * 600) <= 55;
      if (nearStart && vertices.length < 3) return;
      if (nearStart) {
        createObject("polygon", controllerId, { points: vertices.slice() });
        state.drafts[controllerId].polygon = [];
        log(controllerId, "closed polygon");
        broadcastState();
        return;
      }
    }
    // Touch movement is not a tap. Coordinates are already normalized to the
    // full table map, even when the Client has zoomed its local view.
    if (distance(gesture.start, point) > .025) return;
    if (gesture.tool === "point") {
      createObject("point", controllerId, point);
    } else if (gesture.tool === "route") {
      const draft = state.drafts[controllerId];
      if (draft.routeStart) {
        createObject("route", controllerId, { points: [draft.routeStart, point] });
        draft.routeStart = null;
      } else draft.routeStart = point;
    } else if (gesture.tool === "polygon") {
      state.drafts[controllerId].polygon.push(point);
    } else if (gesture.tool === "sticker" && Object.prototype.hasOwnProperty.call(MR.STICKERS, message.sticker)) {
      createObject("sticker", controllerId, { ...point, sticker: message.sticker });
    } else if (gesture.tool === "comment" && message.text && message.text.trim()) {
      createObject("comment", controllerId, { ...point, text: message.text.trim() });
    } else return;
    broadcastState();
  }

  function reject(connection, reason) {
    connection.on("open", () => {
      connection.send({ type: "rejected", reason });
      setTimeout(() => connection.close(), 250);
    });
    if (connection.open) {
      connection.send({ type: "rejected", reason });
      setTimeout(() => connection.close(), 250);
    }
  }

  function acceptConnection(connection) {
    const metadata = connection.metadata;
    if (!metadata || metadata.token !== token || !/^[0-9a-f]{32}$/.test(metadata.clientId || "")) {
      reject(connection, "This invitation is invalid. Scan the current Host QR code.");
      return;
    }
    // A returning tab takes its former slot when free. Otherwise the first
    // vacant slot is assigned. Only two connections can be reserved at once.
    const former = slots.find(slot => slot.clientId === metadata.clientId);
    if (former && former.connection) {
      reject(connection, "This controller is already connected.");
      return;
    }
    const slot = former || slots.find(candidate => !candidate.connection);
    if (!slot) { reject(connection, "This session already has two controllers."); return; }
    if (slot.clientId && slot.clientId !== metadata.clientId) {
      state.drafts[slot.id] = { routeStart: null, polygon: [] };
    }
    slot.clientId = metadata.clientId;
    slot.connection = connection;
    slot.status = "Connecting";
    renderHost();

    connection.on("open", () => {
      if (slot.connection !== connection) return;
      slot.status = "Connected";
      connection.send({ type: "welcome", slot: slot.id, state, connectedCount: connectedCount() });
      broadcastState();
      log(slot.id, "connected");
    });
    connection.on("data", message => {
      if (slot.connection !== connection || slot.status !== "Connected") return;
      if (!MR.validInput(message)) { log(slot.id, "ignored invalid input"); return; }
      handleControllerEvent(slot.id, message);
    });
    const close = () => {
      if (slot.connection !== connection) return;
      slot.connection = null;
      slot.gesture = null;
      slot.status = "Disconnected";
      log(slot.id, "disconnected");
      broadcastState();
    };
    connection.on("close", close);
    connection.on("error", close);
  }

  function showInvitation(peerId) {
    const configured = window.MR_CLIENT_URL;
    try {
      const url = new URL(configured);
      const localHttp = url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname);
      if (url.protocol !== "https:" && !localHttp) throw new Error("Client URL must use HTTPS");
      url.searchParams.set("host", peerId);
      url.searchParams.set("token", token);
      inviteUrl = url.toString();
      qrElement.replaceChildren();
      if (typeof QRCode !== "function") throw new Error("QR library unavailable");
      new QRCode(qrElement, { text: inviteUrl, width: 192, height: 192, correctLevel: QRCode.CorrectLevel.M });
      inviteLink.href = inviteUrl;
      inviteLink.textContent = "Open client invitation ↗";
      inviteHint.textContent = `Client page: ${url.origin}${url.pathname}`;
      copyButton.disabled = false;
    } catch (error) {
      qrElement.textContent = "Could not create QR";
      inviteHint.textContent = `${error.message}. Check js/config.js.`;
      setHostStatus("Invitation configuration error", "error");
    }
  }

  copyButton.addEventListener("click", async () => {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      copyButton.textContent = "Copied";
      setTimeout(() => { copyButton.textContent = "Copy link"; }, 1800);
    } catch { copyButton.textContent = "Copy failed"; }
  });

  renderHost();
  if (typeof Peer !== "function") {
    setHostStatus("PeerJS did not load", "error");
    qrElement.textContent = "Check your internet connection and reload.";
    return;
  }
  peer = new Peer();
  peer.on("open", id => { setHostStatus("Session ready", "ready"); showInvitation(id); });
  peer.on("connection", acceptConnection);
  peer.on("disconnected", () => {
    setHostStatus("Signaling disconnected · reconnecting", "error");
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => { if (!peer.destroyed && peer.disconnected) peer.reconnect(); }, 2000);
  });
  peer.on("error", error => {
    setHostStatus(`PeerJS: ${error.type || "connection error"}`, "error");
  });
  window.addEventListener("beforeunload", () => { if (peer && !peer.destroyed) peer.destroy(); });
})();
