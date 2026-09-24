(function () {
  "use strict";

  const MR = window.MR;
  const state = MR.blankState();
  const token = MR.randomId();
  const sessionId = MR.randomId();
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const slots = [1, 2, 3, 4].map(id => ({ id, clientId: null, gesture: null }));
  const participants = new Map();
  const events = [];
  const palette = ["#0788b9", "#d97717", "#9a59ae", "#19866c", "#bc5374", "#596fc5", "#a06d30", "#537d45"];
  const map = document.getElementById("host-map");
  const status = document.getElementById("host-status");
  const statusDot = document.getElementById("host-status-dot");
  const qrElement = document.getElementById("qr-code");
  const inviteLink = document.getElementById("invite-link");
  const inviteHint = document.getElementById("invite-hint");
  const copyButton = document.getElementById("copy-link");
  const saveStatus = document.getElementById("save-status");
  let nextObjectId = 1;
  let peer;
  let inviteUrl = "";
  let reconnectTimer = null;
  let saveChain = Promise.resolve();
  let revision = 0;
  let endedAt = null;

  function online(person) { return Boolean(person && person.connection && person.connection.open); }
  function slotFor(id) { return slots.find(slot => slot.clientId === id); }
  function connectedCount() { return endedAt ? 0 : slots.filter(slot => slot.clientId && online(participants.get(slot.clientId))).length; }
  function participantData() {
    return [...participants.values()].map(({ id, name, avatar, color, joinedAt, lastSeenAt }) => ({
      id, name, avatar, color, joinedAt, lastSeenAt, slot: slotFor(id)?.id || null,
      online: !endedAt && online(participants.get(id))
    }));
  }
  function slotData() { return slots.map(slot => ({ id: slot.id, clientId: slot.clientId })); }
  function setHostStatus(text, tone) { status.textContent = text; statusDot.className = `status-dot ${tone || ""}`; }
  function roundDocument() {
    return {
      schemaVersion: 1, sessionId, startedAt, endedAt, updatedAt: new Date().toISOString(), revision,
      table: { widthCm: 100, heightCm: 60, columns: 5, rows: 3, coordinates: "normalized-0-to-1" },
      participants: participantData().map(({ online: _online, ...person }) => person),
      finalState: structuredClone(state), events
    };
  }
  function persist() {
    revision++;
    const thisRevision = revision;
    const payload = JSON.stringify(roundDocument());
    saveStatus.textContent = "Saving on this computer…";
    saveChain = saveChain.catch(() => {}).then(async () => {
      const response = await fetch("/api/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: payload });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (thisRevision === revision) saveStatus.textContent = `Saved locally · ${events.length} events · sessions/${sessionId}.json`;
    }).catch(error => { if (thisRevision === revision) saveStatus.textContent = `Could not save log: ${error.message}`; });
  }
  function record(kind, person, details, description) {
    const timestamp = new Date().toISOString();
    events.push({
      seq: events.length + 1, timestamp, elapsedMs: Date.now() - startedMs,
      actor: person ? { id: person.id, name: person.name, avatar: person.avatar, color: person.color, slot: slotFor(person.id)?.id || null } : null,
      kind, details, stateAfter: structuredClone(state), participantsAfter: participantData(), slotsAfter: slotData()
    });
    const line = person ? `${person.avatar} ${person.name}${slotFor(person.id) ? ` · C${slotFor(person.id).id}` : ""} → ${description}` : description;
    document.getElementById("latest-action").textContent = line;
    const item = document.createElement("li");
    const time = document.createElement("time");
    time.dateTime = timestamp;
    time.textContent = new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    item.append(time, document.createTextNode(line));
    const list = document.getElementById("event-log");
    list.prepend(item);
    while (list.children.length > 24) list.lastElementChild.remove();
    persist();
  }
  function renderHost() {
    MR.renderMap(map, state);
    document.getElementById("host-layer-label").textContent = state.layer[0].toUpperCase() + state.layer.slice(1);
    document.getElementById("client-count").textContent = `${connectedCount()} / 4`;
    const bubbles = document.getElementById("host-participants");
    bubbles.replaceChildren();
    if (!participants.size) {
      const empty = document.createElement("span"); empty.className = "muted"; empty.textContent = "Waiting for phones…"; bubbles.append(empty);
    }
    for (const person of participants.values()) {
      const bubble = document.createElement("div");
      bubble.className = `person-bubble${online(person) ? "" : " offline"}`;
      bubble.style.setProperty("--person-color", person.color);
      const avatar = document.createElement("span"); avatar.className = "person-avatar"; avatar.textContent = person.avatar;
      const label = document.createElement("span"); label.textContent = `${person.name}${slotFor(person.id) ? ` · C${slotFor(person.id).id}` : " · waiting"}`;
      bubble.title = online(person) ? "Online" : "Disconnected";
      bubble.append(avatar, label);
      bubbles.append(bubble);
    }
    const slotList = document.getElementById("host-slots");
    slotList.replaceChildren();
    for (const slot of slots) {
      const row = document.createElement("div"); row.className = "slot";
      const label = document.createElement("span"); label.textContent = `Controller ${slot.id}`;
      const person = slot.clientId && participants.get(slot.clientId);
      if (person) {
        const dot = document.createElement("i"); dot.className = "legend-dot"; dot.style.background = person.color; label.prepend(dot);
      }
      const detail = document.createElement("strong");
      detail.textContent = person ? `${person.name} · ${online(person) ? "online" : "offline"}` : "Available";
      detail.className = person ? (online(person) ? "connected" : "disconnected") : "";
      row.append(label, detail);
      if (person && !online(person) && !endedAt) {
        const release = document.createElement("button"); release.className = "quiet-button tiny"; release.type = "button"; release.textContent = "Release";
        release.addEventListener("click", () => releaseSlot(person, `Host released ${person.name} from Controller ${slot.id}`, true)); row.append(release);
      }
      slotList.append(row);
    }
  }
  function broadcastState() {
    renderHost();
    const payload = { type: "state", state, participants: participantData(), slots: slotData(), connectedCount: connectedCount() };
    for (const person of participants.values()) if (online(person)) person.connection.send(payload);
  }
  function sendNotice(person, text) { if (online(person)) person.connection.send({ type: "notice", text }); }
  function createObject(type, slot, person, values) {
    const object = { id: `o${nextObjectId++}`, type, controllerId: slot.id, creatorId: person.id, creatorName: person.name, color: person.color, ...values };
    state.objects.push(object);
    return object;
  }
  function findPoint(id) { return state.objects.find(object => object.id === id && object.type === "point"); }
  function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  // Future MR Studio MapLibre calls belong here. PeerJS only authenticates a
  // participant and forwards validated input to this Host-owned action handler.
  function handleControllerEvent(slot, person, message) {
    const controllerId = slot.id;
    if (message.type === "button") {
      if (message.button.startsWith("layer:")) {
        const layer = message.button.slice(6);
        if (state.layer !== layer) { state.layer = layer; record("layer.changed", person, { layer }, `selected ${layer}`); broadcastState(); }
      } else if (message.button === "finish-polygon") {
        const vertices = state.drafts[controllerId].polygon;
        if (vertices.length >= 3) {
          const object = createObject("polygon", slot, person, { points: vertices.slice() });
          state.drafts[controllerId].polygon = [];
          record("object.created", person, { object }, "closed polygon"); broadcastState();
        }
      } else if (message.button === "cancel-polygon") {
        if (state.drafts[controllerId].polygon.length) {
          state.drafts[controllerId].polygon = [];
          record("draft.cancelled", person, { tool: "polygon" }, "cancelled polygon"); broadcastState();
        }
      }
      return;
    }
    const point = { x: message.x, y: message.y };
    if (message.phase === "down") {
      const target = message.tool === "point" ? findPoint(message.targetId) : null;
      slot.gesture = { tool: message.tool, start: point, targetId: target ? target.id : null,
        initialPosition: target ? { x: target.x, y: target.y } : null };
      return;
    }
    const gesture = slot.gesture;
    if (!gesture || gesture.tool !== message.tool) return;
    if (message.phase === "cancel") {
      slot.gesture = null;
      if (gesture.targetId) {
        const target = findPoint(gesture.targetId);
        if (target && distance(gesture.initialPosition, target) > 0) {
          record("object.moved", person, { objectId: target.id, position: { x: target.x, y: target.y } }, `moved point ${target.id}`);
          broadcastState();
        }
      }
      return;
    }
    if (message.phase === "move") {
      if (gesture.targetId) { const target = findPoint(gesture.targetId); if (target) { target.x = point.x; target.y = point.y; broadcastState(); } }
      return;
    }
    slot.gesture = null;
    if (gesture.targetId) {
      const target = findPoint(gesture.targetId);
      if (target) {
        target.x = point.x; target.y = point.y;
        if (distance(gesture.initialPosition, point) > 0) record("object.moved", person, { objectId: target.id, position: point }, `moved point ${target.id}`);
        broadcastState();
      }
      return;
    }
    if (gesture.tool === "polygon") {
      const vertices = state.drafts[controllerId].polygon;
      const start = vertices[0];
      const nearStart = start && Math.hypot((point.x - start.x) * 1000, (point.y - start.y) * 600) <= 55;
      if (nearStart && vertices.length < 3) return;
      if (nearStart) {
        const object = createObject("polygon", slot, person, { points: vertices.slice() });
        state.drafts[controllerId].polygon = [];
        record("object.created", person, { object }, "closed polygon"); broadcastState(); return;
      }
    }
    if (distance(gesture.start, point) > .025) return;
    if (gesture.tool === "point") {
      const object = createObject("point", slot, person, point);
      record("object.created", person, { object }, "placed point");
    } else if (gesture.tool === "route") {
      const draft = state.drafts[controllerId];
      if (draft.routeStart) {
        const object = createObject("route", slot, person, { points: [draft.routeStart, point] });
        draft.routeStart = null;
        record("object.created", person, { object }, "completed route");
      } else { draft.routeStart = point; record("draft.changed", person, { tool: "route", point }, "placed route origin"); }
    } else if (gesture.tool === "polygon") {
      state.drafts[controllerId].polygon.push(point);
      record("draft.changed", person, { tool: "polygon", point }, `placed polygon corner ${state.drafts[controllerId].polygon.length}`);
    } else if (gesture.tool === "sticker" && Object.hasOwn(MR.STICKERS, message.sticker)) {
      const object = createObject("sticker", slot, person, { ...point, sticker: message.sticker });
      record("object.created", person, { object }, `placed ${message.sticker} sticker`);
    } else if (gesture.tool === "comment" && message.text && message.text.trim()) {
      const object = createObject("comment", slot, person, { ...point, text: message.text.trim() });
      record("object.created", person, { object }, "placed comment");
    } else return;
    broadcastState();
  }
  function releaseSlot(person, description = "left controller slot", initiatedByHost = false) {
    const slot = slotFor(person.id);
    if (!slot) return;
    slot.clientId = null; slot.gesture = null;
    state.drafts[slot.id] = { routeStart: null, polygon: [] };
    record("slot.released", initiatedByHost ? null : person, { slot: slot.id, participantId: person.id, participantName: person.name }, description);
    broadcastState();
  }
  function claimSlot(person, id) {
    const target = slots.find(slot => slot.id === id);
    if (!target || target.clientId && target.clientId !== person.id) { sendNotice(person, "That controller slot is occupied. Choose an available one."); return; }
    const current = slotFor(person.id);
    if (current === target) return;
    if (current) { current.clientId = null; current.gesture = null; state.drafts[current.id] = { routeStart: null, polygon: [] }; }
    target.clientId = person.id;
    state.drafts[target.id].color = person.color;
    record("slot.claimed", person, { slot: id, previousSlot: current?.id || null }, `joined Controller ${id}`);
    broadcastState();
  }
  function validProfile(message) {
    return message && message.type === "profile" && typeof message.name === "string" && message.name.trim().length >= 1 && message.name.trim().length <= 32 && MR.AVATARS.includes(message.avatar);
  }
  function reject(connection, reason) {
    const send = () => { connection.send({ type: "rejected", reason }); setTimeout(() => connection.close(), 250); };
    connection.on("open", send);
    if (connection.open) send();
  }
  function acceptConnection(connection) {
    if (endedAt) { reject(connection, "This Host session has ended. Scan a new QR code."); return; }
    const metadata = connection.metadata;
    if (!metadata || metadata.token !== token || !/^[0-9a-f]{32}$/.test(metadata.clientId || "")) {
      reject(connection, "This invitation is invalid. Scan the current Host QR code."); return;
    }
    let person = participants.get(metadata.clientId);
    const isNew = !person;
    if (!person) {
      const index = participants.size;
      person = { id: metadata.clientId, name: `${MR.ADJECTIVES[index % MR.ADJECTIVES.length]} ${MR.ANIMALS[Math.floor(Math.random() * MR.ANIMALS.length)]}`,
        avatar: MR.AVATARS[Math.floor(Math.random() * MR.AVATARS.length)], color: palette[index] || `hsl(${(index * 137.5) % 360} 55% 42%)`,
        joinedAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(), connection: null, lastPing: Date.now() };
      participants.set(person.id, person);
    }
    const previous = person.connection;
    person.connection = connection;
    if (previous && previous !== connection) previous.close();
    connection.on("open", () => {
      if (person.connection !== connection) return;
      person.lastSeenAt = new Date().toISOString(); person.lastPing = Date.now();
      connection.send({ type: "welcome", clientId: person.id, state, participants: participantData(), slots: slotData(), connectedCount: connectedCount() });
      record(isNew ? "participant.joined" : "participant.reconnected", person, {}, isNew ? "joined session" : "reconnected");
      broadcastState();
    });
    connection.on("data", message => {
      if (person.connection !== connection || !connection.open || endedAt) return;
      person.lastPing = Date.now(); person.lastSeenAt = new Date().toISOString();
      if (message?.type === "ping") { connection.send({ type: "pong" }); return; }
      if (validProfile(message)) {
        const name = message.name.trim();
        if (person.name !== name || person.avatar !== message.avatar) {
          person.name = name; person.avatar = message.avatar;
          record("participant.updated", person, { name, avatar: message.avatar }, "updated profile"); broadcastState();
        }
        return;
      }
      if (message?.type === "claim-slot" && Number.isInteger(message.slot)) { claimSlot(person, message.slot); return; }
      if (message?.type === "release-slot") { releaseSlot(person); return; }
      const slot = slotFor(person.id);
      if (!slot) { sendNotice(person, "Choose a controller slot before editing."); return; }
      if (!MR.validInput(message)) { sendNotice(person, "That action was not accepted."); return; }
      handleControllerEvent(slot, person, message);
    });
    const close = () => {
      if (person.connection !== connection) return;
      person.connection = null;
      const slot = slotFor(person.id); if (slot) slot.gesture = null;
      person.lastSeenAt = new Date().toISOString();
      if (!endedAt) { record("participant.disconnected", person, {}, "disconnected"); broadcastState(); }
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
      url.searchParams.set("host", peerId); url.searchParams.set("token", token);
      url.searchParams.set("v", MR.RELEASE); inviteUrl = url.toString();
      qrElement.replaceChildren();
      if (typeof QRCode !== "function") throw new Error("QR library unavailable");
      new QRCode(qrElement, { text: inviteUrl, width: 192, height: 192, correctLevel: QRCode.CorrectLevel.M });
      inviteLink.href = inviteUrl; inviteLink.textContent = "Open client invitation ↗";
      inviteHint.textContent = `Client page: ${url.origin}${url.pathname}`; copyButton.disabled = false;
    } catch (error) {
      qrElement.textContent = "Could not create QR"; inviteHint.textContent = `${error.message}. Check js/config.js.`;
      setHostStatus("Invitation configuration error", "error");
    }
  }
  function endSession() {
    if (endedAt) return;
    endedAt = new Date().toISOString();
    record("session.ended", null, {}, "Host ended session");
    const closeMarker = JSON.stringify({ sessionId, endedAt });
    if (navigator.sendBeacon) navigator.sendBeacon("/api/session/end", new Blob([closeMarker], { type: "application/json" }));
    if (peer && !peer.destroyed) peer.destroy();
    setHostStatus("Session ended", "");
    document.getElementById("end-session").disabled = true;
    copyButton.disabled = true;
    broadcastState();
  }
  copyButton.addEventListener("click", async () => {
    if (!inviteUrl) return;
    try { await navigator.clipboard.writeText(inviteUrl); copyButton.textContent = "Copied"; setTimeout(() => { copyButton.textContent = "Copy link"; }, 1800); }
    catch { copyButton.textContent = "Copy failed"; }
  });
  document.getElementById("end-session").addEventListener("click", endSession);
  document.getElementById("session-download").href = `/api/session/${sessionId}`;
  record("session.started", null, {}, "Session started");
  renderHost();
  if (typeof Peer !== "function") {
    setHostStatus("PeerJS did not load", "error"); qrElement.textContent = "Check your internet connection and reload.";
    return;
  }
  peer = new Peer();
  peer.on("open", id => { setHostStatus("Session ready", "ready"); showInvitation(id); });
  peer.on("connection", acceptConnection);
  peer.on("disconnected", () => {
    if (endedAt) return;
    setHostStatus("Signaling disconnected · reconnecting", "error");
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => { if (!peer.destroyed && peer.disconnected) peer.reconnect(); }, 2000);
  });
  peer.on("error", error => { if (!endedAt) setHostStatus(`PeerJS: ${error.type || "connection error"}`, "error"); });
  setInterval(() => {
    if (endedAt) return;
    for (const person of participants.values()) if (online(person) && Date.now() - person.lastPing > 30000) person.connection.close();
  }, 8000);
  window.addEventListener("pagehide", endSession);
})();
