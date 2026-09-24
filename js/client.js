(function () {
  "use strict";

  const MR = window.MR;
  const parameters = new URLSearchParams(location.search);
  const hostId = parameters.get("host") || "";
  const token = parameters.get("token") || "";
  const status = document.getElementById("client-status");
  const slotLabel = document.getElementById("client-slot");
  const errorPanel = document.getElementById("connection-error");
  const errorText = document.getElementById("error-text");
  const retryButton = document.getElementById("retry-button");
  const viewport = document.getElementById("map-viewport");
  const stage = document.getElementById("map-stage");
  const map = document.getElementById("client-map");
  const hint = document.getElementById("tool-hint");
  const commentInput = document.getElementById("comment-text");
  const commentPlacement = document.getElementById("comment-placement");
  let state = MR.blankState();
  let peer = null;
  let connection = null;
  let connected = false;
  let rejected = false;
  let slot = null;
  let retryTimer = null;
  let connectionTimer = null;
  let selectedTool = "point";
  let selectedSticker = "star";

  // A tab keeps its ID across refresh and reconnect, allowing the Host to put
  // it back in the same controller slot while that session still exists.
  const storageKey = `mr-studio-controller:${hostId}`;
  let clientId;
  try {
    clientId = sessionStorage.getItem(storageKey) || MR.randomId();
    sessionStorage.setItem(storageKey, clientId);
  } catch { clientId = MR.randomId(); }

  function setStatus(text, tone) {
    status.textContent = text;
    status.className = `client-status ${tone || ""}`;
  }

  function showError(text, canRetry) {
    errorText.textContent = text;
    errorPanel.hidden = false;
    retryButton.hidden = !canRetry;
    setStatus(slot ? "Disconnected" : "Could not connect", "error");
  }

  function clearError() { errorPanel.hidden = true; }

  function send(message) {
    if (connected && connection && connection.open) connection.send(message);
  }

  function sendButton(button) { send({ type: "button", button, state: "pressed" }); }

  function updateCommentPrompt() {
    commentPlacement.hidden = selectedTool !== "comment";
    if (selectedTool !== "comment") return;
    const hasText = Boolean(commentInput.value.trim());
    commentPlacement.textContent = hasText
      ? "2 · Tap a spot on the map to place your comment"
      : "Type your comment below, then tap its spot on the map";
    commentPlacement.classList.toggle("ready", hasText);
  }

  function render() {
    MR.renderMap(map, state);
    document.querySelectorAll("[data-layer]").forEach(button => {
      button.classList.toggle("active", button.dataset.layer === state.layer);
    });
    if (selectedTool === "polygon") {
      const count = slot && state.drafts && state.drafts[slot] ? state.drafts[slot].polygon.length : 0;
      hint.textContent = count >= 3
        ? `Tap the highlighted first corner to close (${count} corners).`
        : `Tap corners (${count} placed; minimum 3).`;
      document.getElementById("finish-polygon").disabled = count < 3;
    }
  }

  function receive(message) {
    if (!message || typeof message !== "object") return;
    if (message.type === "rejected") {
      rejected = true;
      connected = false;
      showError(message.reason || "The Host rejected this connection.", true);
      if (connection) connection.close();
      return;
    }
    if (message.type === "welcome") {
      connected = true;
      rejected = false;
      clearTimeout(retryTimer);
      retryTimer = null;
      slot = message.slot;
      slotLabel.textContent = `Controller ${slot} · ${message.connectedCount}/2 online`;
      setStatus("Connected", "connected");
      clearError();
      clearTimeout(connectionTimer);
    } else if (message.type !== "state") return;
    if (message.state && typeof message.state === "object") state = message.state;
    if (connected) slotLabel.textContent = `Controller ${slot} · ${message.connectedCount}/2 online`;
    render();
  }

  function scheduleRetry() {
    if (rejected || retryTimer) return;
    retryTimer = setTimeout(() => { retryTimer = null; attemptConnection(); }, 2500);
  }

  function connectToHost() {
    if (!peer || peer.destroyed || peer.disconnected || rejected) return;
    if (connected && connection && connection.open) return;
    if (connection) {
      const previous = connection;
      connection = null;
      previous.close();
    }
    setStatus("Connecting…");
    clearError();
    const current = peer.connect(hostId, { metadata: { token, clientId }, serialization: "json" });
    connection = current;
    connected = false;
    clearTimeout(connectionTimer);
    connectionTimer = setTimeout(() => {
      if (connection !== current || connected || rejected) return;
      showError("The Host did not respond. Check that its session is still open.", true);
      current.close();
      scheduleRetry();
    }, 12000);
    current.on("data", message => { if (connection === current) receive(message); });
    current.on("close", () => {
      if (connection !== current) return;
      connection = null;
      connected = false;
      clearTimeout(connectionTimer);
      slotLabel.textContent = slot ? `Controller ${slot}` : "";
      if (!rejected) {
        showError("Connection lost. Trying to reconnect…", true);
        scheduleRetry();
      }
    });
    current.on("error", error => {
      if (connection !== current || rejected) return;
      showError(`Connection error: ${error.type || error.message || "unknown"}. Retrying…`, true);
      current.close();
      scheduleRetry();
    });
  }

  function startPeer() {
    if (typeof Peer !== "function") { showError("PeerJS did not load. Check your connection and reload.", true); return; }
    peer = new Peer();
    peer.on("open", connectToHost);
    peer.on("disconnected", () => {
      if (!peer.destroyed) {
        try { peer.reconnect(); } catch { scheduleRetry(); }
      }
    });
    peer.on("error", error => {
      if (rejected) return;
      showError(`PeerJS: ${error.type || "network error"}. Retrying…`, true);
      scheduleRetry();
    });
  }

  function attemptConnection() {
    if (rejected) return;
    if (connected && connection && connection.open) return;
    clearTimeout(retryTimer);
    retryTimer = null;
    if (!peer || peer.destroyed) { startPeer(); return; }
    if (peer.disconnected) {
      try { peer.reconnect(); } catch { peer.destroy(); startPeer(); }
      return;
    }
    if (connection) {
      const previous = connection;
      connection = null;
      previous.close();
    }
    connectToHost();
  }

  retryButton.addEventListener("click", () => {
    rejected = false;
    clearTimeout(retryTimer);
    retryTimer = null;
    clearError();
    attemptConnection();
  });

  document.querySelectorAll("[data-layer]").forEach(button => button.addEventListener("click", () => {
    sendButton(`layer:${button.dataset.layer}`);
  }));
  document.querySelectorAll("[data-tool]").forEach(button => button.addEventListener("click", () => {
    selectedTool = button.dataset.tool;
    document.querySelectorAll("[data-tool]").forEach(item => item.classList.toggle("active", item === button));
    document.getElementById("polygon-actions").hidden = selectedTool !== "polygon";
    document.getElementById("sticker-options").hidden = selectedTool !== "sticker";
    document.getElementById("comment-option").hidden = selectedTool !== "comment";
    const hints = {
      point: "Tap to add a point. Drag an existing point to move it.",
      route: "Tap once for origin, then again for destination.",
      polygon: "",
      sticker: "Choose a sticker, then tap the map.",
      comment: ""
    };
    hint.textContent = hints[selectedTool];
    hint.hidden = selectedTool === "comment";
    updateCommentPrompt();
    if (selectedTool === "comment") commentInput.focus();
    sendButton(`tool:${selectedTool}`);
    render();
  }));
  commentInput.addEventListener("input", updateCommentPrompt);
  commentInput.addEventListener("keydown", event => {
    if (event.key === "Enter") commentInput.blur();
  });
  document.querySelectorAll("[data-sticker]").forEach(button => button.addEventListener("click", () => {
    selectedSticker = button.dataset.sticker;
    document.querySelectorAll("[data-sticker]").forEach(item => item.classList.toggle("selected", item === button));
  }));
  document.getElementById("finish-polygon").addEventListener("click", () => {
    const vertices = slot && state.drafts[slot] ? state.drafts[slot].polygon : [];
    if (vertices.length < 3) { hint.textContent = "Add at least three corners first."; return; }
    sendButton("finish-polygon");
  });
  document.getElementById("cancel-polygon").addEventListener("click", () => sendButton("cancel-polygon"));

  let zoom = 1;
  let panX = 0;
  let panY = 0;
  let baseWidth = 1000;
  let baseHeight = 600;
  const pointers = new Map();
  let activeEditId = null;
  let pinchStart = null;
  let lastMoveSent = 0;

  function clampPan() {
    const maxX = Math.max(0, (baseWidth * zoom - viewport.clientWidth) / 2);
    const maxY = Math.max(0, (baseHeight * zoom - viewport.clientHeight) / 2);
    panX = Math.max(-maxX, Math.min(maxX, panX));
    panY = Math.max(-maxY, Math.min(maxY, panY));
  }

  function transformStage() {
    clampPan();
    stage.style.transform = `translate(-50%, -50%) translate(${panX}px, ${panY}px) scale(${zoom})`;
    document.getElementById("zoom-reset").textContent = `${zoom.toFixed(1)}×`;
  }

  function layoutStage() {
    const scale = Math.min(viewport.clientWidth / 1000, viewport.clientHeight / 600);
    baseWidth = Math.max(1, 1000 * scale);
    baseHeight = Math.max(1, 600 * scale);
    stage.style.width = `${baseWidth}px`;
    stage.style.height = `${baseHeight}px`;
    transformStage();
  }

  function setZoom(value) { zoom = Math.max(1, Math.min(4, value)); transformStage(); }
  document.getElementById("zoom-in").addEventListener("click", () => setZoom(zoom * 1.4));
  document.getElementById("zoom-out").addEventListener("click", () => setZoom(zoom / 1.4));
  document.getElementById("zoom-reset").addEventListener("click", () => { zoom = 1; panX = 0; panY = 0; transformStage(); });
  viewport.addEventListener("wheel", event => { event.preventDefault(); setZoom(zoom * (event.deltaY < 0 ? 1.15 : 1 / 1.15)); }, { passive: false });
  new ResizeObserver(layoutStage).observe(viewport);
  layoutStage();

  function mapPosition(clientX, clientY) {
    const box = stage.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (clientX - box.left) / box.width)),
      y: Math.max(0, Math.min(1, (clientY - box.top) / box.height))
    };
  }

  function sendPointer(phase, event, targetId) {
    const coordinates = mapPosition(event.clientX, event.clientY);
    const message = { type: "pointer", phase, tool: selectedTool, ...coordinates };
    if (targetId) message.targetId = targetId;
    if (phase === "up" && selectedTool === "sticker") message.sticker = selectedSticker;
    if (phase === "up" && selectedTool === "comment") {
      message.text = commentInput.value.trim();
      if (!message.text) commentInput.focus();
      else {
        commentInput.value = "";
        commentInput.blur();
      }
      updateCommentPrompt();
    }
    send(message);
  }

  function startPinch() {
    const points = [...pointers.values()];
    const centerX = (points[0].x + points[1].x) / 2;
    const centerY = (points[0].y + points[1].y) / 2;
    pinchStart = { distance: Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) || 1, centerX, centerY, zoom, panX, panY };
  }

  stage.addEventListener("pointerdown", event => {
    if (!connected) return;
    event.preventDefault();
    stage.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 1) {
      activeEditId = event.pointerId;
      const targetId = event.target.closest("[data-object-id]")?.getAttribute("data-object-id");
      sendPointer("down", event, targetId);
    } else if (pointers.size === 2) {
      if (activeEditId !== null) {
        const first = pointers.get(activeEditId);
        sendPointer("cancel", { clientX: first.x, clientY: first.y });
        activeEditId = null;
      }
      startPinch();
    }
  });

  stage.addEventListener("pointermove", event => {
    if (!pointers.has(event.pointerId)) return;
    event.preventDefault();
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size >= 2 && pinchStart) {
      const points = [...pointers.values()];
      const centerX = (points[0].x + points[1].x) / 2;
      const centerY = (points[0].y + points[1].y) / 2;
      const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) || 1;
      zoom = Math.max(1, Math.min(4, pinchStart.zoom * distance / pinchStart.distance));
      panX = pinchStart.panX + centerX - pinchStart.centerX;
      panY = pinchStart.panY + centerY - pinchStart.centerY;
      transformStage();
    } else if (activeEditId === event.pointerId && performance.now() - lastMoveSent > 32) {
      lastMoveSent = performance.now();
      sendPointer("move", event);
    }
  });

  function endPointer(event, cancelled) {
    if (!pointers.has(event.pointerId)) return;
    event.preventDefault();
    if (activeEditId === event.pointerId) sendPointer(cancelled ? "cancel" : "up", event);
    pointers.delete(event.pointerId);
    activeEditId = null;
    pinchStart = null;
    if (pointers.size >= 2) startPinch();
  }
  stage.addEventListener("pointerup", event => endPointer(event, false));
  stage.addEventListener("pointercancel", event => endPointer(event, true));

  render();
  if (!hostId || hostId.length > 128 || !/^[0-9a-f]{32}$/.test(token)) {
    showError("This invitation is incomplete. Scan the Host QR code again.", false);
  } else startPeer();
})();
