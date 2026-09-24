(function () {
  "use strict";

  const NS = "http://www.w3.org/2000/svg";
  const LAYERS = ["streets", "buildings", "terrain"];
  const TOOLS = ["point", "route", "polygon", "sticker", "comment"];
  const STICKERS = { star: "★", flag: "⚑", alert: "!" };
  const COLORS = { 1: "#0788b9", 2: "#d97717" };

  function blankState() {
    return {
      layer: "streets",
      objects: [],
      drafts: {
        1: { routeStart: null, polygon: [] },
        2: { routeStart: null, polygon: [] }
      }
    };
  }

  function randomId() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
  }

  function validInput(message) {
    if (!message || typeof message !== "object" || Array.isArray(message)) return false;
    if (message.type === "button") {
      if (message.state !== "pressed") return false;
      const validNames = [
        ...LAYERS.map(layer => `layer:${layer}`),
        ...TOOLS.map(tool => `tool:${tool}`),
        "finish-polygon", "cancel-polygon"
      ];
      return validNames.includes(message.button);
    }
    if (message.type !== "pointer") return false;
    if (!["down", "move", "up", "cancel"].includes(message.phase)) return false;
    if (!TOOLS.includes(message.tool)) return false;
    if (!Number.isFinite(message.x) || message.x < 0 || message.x > 1) return false;
    if (!Number.isFinite(message.y) || message.y < 0 || message.y > 1) return false;
    if (message.targetId !== undefined && (typeof message.targetId !== "string" || message.targetId.length > 40)) return false;
    if (message.sticker !== undefined && !Object.prototype.hasOwnProperty.call(STICKERS, message.sticker)) return false;
    if (message.text !== undefined && (typeof message.text !== "string" || message.text.length > 140)) return false;
    return true;
  }

  function add(parent, tag, attributes, text) {
    const node = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attributes || {})) node.setAttribute(key, String(value));
    if (text !== undefined) node.textContent = text;
    parent.appendChild(node);
    return node;
  }

  // The three static backgrounds demonstrate layer selection without bringing a
  // map engine or remote tile service into this transport prototype.
  const BACKGROUNDS = {
    streets: `<rect width="1000" height="600" fill="#dce8d6"/><path d="M0 225 C210 230 210 110 420 180 S770 255 1000 110 M0 470 C170 410 250 480 405 375 S800 345 1000 390 M120 0 C160 150 80 290 210 600 M600 0 C570 200 700 390 660 600 M840 0 C790 250 900 370 955 600" fill="none" stroke="#f9f8e9" stroke-width="42"/><path d="M0 225 C210 230 210 110 420 180 S770 255 1000 110 M0 470 C170 410 250 480 405 375 S800 345 1000 390 M120 0 C160 150 80 290 210 600 M600 0 C570 200 700 390 660 600 M840 0 C790 250 900 370 955 600" fill="none" stroke="#9bb5a3" stroke-width="3" stroke-dasharray="10 12"/><path d="M315 0 Q400 100 390 200 M420 180 Q390 300 485 600 M0 80 Q230 50 400 180 M700 350 Q680 180 800 0" fill="none" stroke="#f6f6e8" stroke-width="18"/><path d="M80 520 Q140 505 230 540 L260 600 H40Z M735 65 Q820 20 925 45 L900 145 Q795 125 735 65Z" fill="#b7d8ac"/><text x="50" y="185" fill="#658071" font-size="25" font-weight="700" opacity=".7">STREETS</text>`,
    buildings: `<rect width="1000" height="600" fill="#d4decf"/><path d="M0 212 L1000 212 M0 420 L1000 420 M180 0 L180 600 M500 0 L500 600 M780 0 L780 600" stroke="#edf2e4" stroke-width="33"/><g fill="#829b89" stroke="#5c7c68" stroke-width="3"><rect x="36" y="35" width="88" height="122" rx="5"/><rect x="230" y="38" width="170" height="120" rx="5"/><rect x="560" y="25" width="140" height="145" rx="5"/><rect x="831" y="38" width="115" height="135" rx="5"/><rect x="40" y="265" width="92" height="102" rx="5"/><rect x="230" y="260" width="205" height="104" rx="5"/><rect x="545" y="265" width="155" height="115" rx="5"/><rect x="825" y="263" width="125" height="113" rx="5"/><rect x="38" y="460" width="100" height="102" rx="5"/><rect x="230" y="468" width="155" height="90" rx="5"/><rect x="555" y="466" width="155" height="90" rx="5"/><rect x="825" y="467" width="120" height="95" rx="5"/></g><text x="62" y="338" fill="#eaf4e6" font-size="23" font-weight="700">BUILDINGS</text>`,
    terrain: `<rect width="1000" height="600" fill="#d8e0ca"/><path d="M0 100 Q180 -10 310 90 T650 75 T1000 100 M0 165 Q170 55 310 155 T650 140 T1000 170 M0 240 Q170 130 320 225 T655 225 T1000 245 M0 320 Q170 210 330 305 T650 300 T1000 310 M0 395 Q180 290 340 380 T650 380 T1000 395 M0 475 Q170 365 330 460 T660 455 T1000 470 M0 550 Q170 440 335 530 T660 530 T1000 545" fill="none" stroke="#9ebb92" stroke-width="5" opacity=".72"/><path d="M740 0 Q690 120 760 205 T770 425 Q845 475 890 600 L1000 600 L1000 0Z" fill="#94c5bd" opacity=".75"/><path d="M805 0 Q775 120 825 210 T845 420 Q900 485 930 600" fill="none" stroke="#e2f2da" stroke-width="3"/><text x="55" y="110" fill="#64805c" font-size="25" font-weight="700">TERRAIN</text>`
  };

  function renderMap(svg, state) {
    if (!svg || !state) return;
    const layer = LAYERS.includes(state.layer) ? state.layer : "streets";
    svg.innerHTML = BACKGROUNDS[layer];
    // The faint 5 × 3 grid corresponds to the physical 100 × 60 cm table.
    for (let x = 200; x < 1000; x += 200) add(svg, "line", { x1: x, y1: 0, x2: x, y2: 600, stroke: "#223c30", "stroke-width": 2, "stroke-dasharray": "7 9", opacity: .37 });
    for (let y = 200; y < 600; y += 200) add(svg, "line", { x1: 0, y1: y, x2: 1000, y2: y, stroke: "#223c30", "stroke-width": 2, "stroke-dasharray": "7 9", opacity: .37 });
    add(svg, "rect", { x: 2, y: 2, width: 996, height: 596, rx: 8, fill: "none", stroke: "#1a4936", "stroke-width": 4 });
    for (const object of state.objects || []) drawObject(svg, object);
    for (const controllerId of [1, 2]) drawDraft(svg, state.drafts && state.drafts[controllerId], controllerId);
  }

  function xy(point) { return `${point.x * 1000},${point.y * 600}`; }
  function marker(parent, point, color, label, objectId) {
    const attributes = { cx: point.x * 1000, cy: point.y * 600, r: 12, fill: color, stroke: "white", "stroke-width": 4 };
    if (objectId) attributes["data-object-id"] = objectId;
    add(parent, "circle", attributes);
    if (label) add(parent, "text", { x: point.x * 1000 + 16, y: point.y * 600 - 14, fill: "#17352c", "font-size": 20, "font-weight": 800, "paint-order": "stroke", stroke: "#eaf1e5", "stroke-width": 5 }, label);
  }

  function drawObject(svg, object) {
    const color = COLORS[object.controllerId] || COLORS[1];
    if (object.type === "point") {
      // The larger transparent hit area makes dragging practical on phones.
      marker(svg, object, color, `C${object.controllerId}`, object.id);
      add(svg, "circle", { cx: object.x * 1000, cy: object.y * 600, r: 28, fill: "transparent", "data-object-id": object.id });
    } else if (object.type === "route") {
      add(svg, "line", { x1: object.points[0].x * 1000, y1: object.points[0].y * 600, x2: object.points[1].x * 1000, y2: object.points[1].y * 600, stroke: color, "stroke-width": 7, "stroke-linecap": "round", "stroke-dasharray": "17 9" });
      marker(svg, object.points[0], color, "Origin · C" + object.controllerId);
      marker(svg, object.points[1], color, "Destination");
    } else if (object.type === "polygon") {
      add(svg, "polygon", { points: object.points.map(xy).join(" "), fill: color, "fill-opacity": .24, stroke: color, "stroke-width": 5, "stroke-linejoin": "round" });
      object.points.forEach(point => add(svg, "circle", { cx: point.x * 1000, cy: point.y * 600, r: 5, fill: color }));
      add(svg, "text", { x: object.points[0].x * 1000 + 10, y: object.points[0].y * 600 - 12, fill: color, "font-size": 18, "font-weight": 800 }, `C${object.controllerId}`);
    } else if (object.type === "sticker") {
      add(svg, "circle", { cx: object.x * 1000, cy: object.y * 600, r: 23, fill: "#fff8e9", stroke: color, "stroke-width": 4 });
      add(svg, "text", { x: object.x * 1000, y: object.y * 600 + 10, "text-anchor": "middle", fill: color, "font-size": 29, "font-weight": 800 }, STICKERS[object.sticker] || "★");
      add(svg, "text", { x: object.x * 1000 + 21, y: object.y * 600 - 23, fill: color, "font-size": 16, "font-weight": 800 }, `C${object.controllerId}`);
    } else if (object.type === "comment") {
      const group = add(svg, "g");
      const text = object.text.length > 28 ? object.text.slice(0, 27) + "…" : object.text;
      const width = Math.min(355, Math.max(104, text.length * 10 + 30));
      const left = Math.min(object.x * 1000 + 12, 995 - width);
      const top = Math.max(8, Math.min(object.y * 600 - 55, 554));
      add(group, "path", { d: `M${object.x * 1000} ${object.y * 600} L${left + 10} ${top + 43}`, stroke: color, "stroke-width": 3 });
      add(group, "rect", { x: left, y: top, width, height: 44, rx: 9, fill: "#fffdf2", stroke: color, "stroke-width": 3 });
      add(group, "text", { x: left + 10, y: top + 28, fill: "#17352c", "font-size": 16, "font-weight": 700 }, `C${object.controllerId}: ${text}`);
      add(group, "title", {}, object.text);
    }
  }

  function drawDraft(svg, draft, controllerId) {
    if (!draft) return;
    const color = COLORS[controllerId];
    if (draft.routeStart) marker(svg, draft.routeStart, color, `Origin · C${controllerId}`);
    if (draft.polygon && draft.polygon.length) {
      if (draft.polygon.length > 1) add(svg, "polyline", { points: draft.polygon.map(xy).join(" "), fill: "none", stroke: color, "stroke-width": 5, "stroke-dasharray": "12 8" });
      draft.polygon.forEach(point => marker(svg, point, color));
    }
  }

  window.MR = { LAYERS, TOOLS, STICKERS, blankState, randomId, validInput, renderMap };
})();
