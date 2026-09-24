# Collaborative MR Studio controller MVP

A small proof of concept for two phones editing one shared table map. A Host page runs on a computer; a Client page runs on GitHub Pages. Both phones scan the same QR code. PeerJS uses its public signaling service to establish WebRTC DataChannels, then the Host receives inputs and broadcasts the shared map state. No application backend or build step is needed.

This repository is separate from `MR-Studio-Demo`. The illustrated map represents its fixed **100 × 60 cm, 5 × 3 tile** table extent; it does not pan or zoom on the Host. The three demo layers are Streets, Buildings, and Terrain.

```text
Phone 1 ─┐             PeerJS signaling
         ├─ WebRTC ─→ Local Host ─→ shared map state
Phone 2 ─┘                  │              │
   ↑                      input        state sent
   └────────────────────── updates ───────┘
```

## Run the Host

From this repository directory, run:

```bash
./launch_host_server.sh
```

The script opens `http://127.0.0.1:8123/` on the Host computer. Press Ctrl+C to stop it. Pass a different port if needed, for example `./launch_host_server.sh 8124`. The session, PeerJS ID, invitation URL, and QR code are created automatically. The Host shows a 0–2 connected count, slot status, shared map, and recent input log.

The Host computer and phones need internet access for PeerJS signaling. The local Python server only serves files to the Host browser; phones open the GitHub Pages Client URL contained in the QR.

## Publish the Client on GitHub Pages

Push this repository to GitHub and enable **Pages → Deploy from a branch → main → /(root)** in the repository settings. The Client page is `client.html`; the root `index.html` is used locally as the Host page. The configured default is:

```text
https://sb-chalmers.github.io/mrstudio_client_prototype/client.html
```

If the Pages address changes, edit only `window.MR_CLIENT_URL` in `js/config.js`. Reload the local Host page to generate a QR with the new address. The Host automatically appends its current `host` PeerJS ID and random `token`; no room code or manual ID entry is needed. The URL is an invitation, so avoid sharing it beyond the intended participants.

For a same-computer browser check before Pages is available, temporarily set the Client URL to `http://127.0.0.1:8123/client.html` in `js/config.js`, reload the Host, then open its invitation link in two separate browser tabs. Restore the Pages URL before using phones.

## Use the controller

1. Scan the Host QR on the first phone, then scan the **same QR** on the second phone. They become Controller 1 and Controller 2 in arrival order.
2. Select a shared layer tab. The Host and both phones show that layer.
3. Choose a local tool: **Point / move** places a point on tap or drags an existing point; **Route** places origin and destination in two taps; **Polygon** adds any number of vertices, then tap its highlighted first corner to close it (or use Close polygon); **Sticker** places a selected symbol; **Comment** takes text first, then places it where you tap the map.
4. Use two fingers to zoom or pan the phone's view, or use the `+`, `−`, and reset buttons. This only changes that phone's view. Inputs always use the normalized position within the full table extent.

Controller colors distinguish edits on every display. A returning tab receives the latest Host state. The Host holds state only in memory, so refreshing it starts a new session and clears annotations and invitations.

## Message protocol and architecture

`js/shared.js` contains the small shared renderer and input validation. `js/client.js` reads the invitation, manages PeerJS reconnection, normalizes pointer coordinates, and sends input. `js/host.js` validates connection metadata, assigns at most two slots, handles all input through `handleControllerEvent(controllerId, message)`, updates map state, and sends that state to both Clients.

| Direction | Message | Purpose |
| --- | --- | --- |
| Client connection metadata | `{ token, clientId }` | Check the current session invitation and recognize a returning tab. |
| Client → Host | `{ type: "button", button, state: "pressed" }` | Layer and tool button presses; Finish or Cancel polygon. |
| Client → Host | `{ type: "pointer", phase, tool, x, y, ... }` | Pointer `down`, `move`, `up`, or `cancel`; `x` and `y` are within 0–1. Optional fields carry a point target ID, sticker choice, or comment text. |
| Host → Client | `welcome`, `state`, `rejected` | Slot assignment, current shared state, or a useful connection error. |

The Host processes received messages in arrival order. If both controllers drag the same point simultaneously, the most recently received position appears. Pointer moves are sent at most about 30 times per second to keep the stream light. The latest 24 received events appear in the Host log; annotations remain in shared state until the Host page is refreshed.

To integrate the concept into MR Studio later, keep the PeerJS connection and validation code and replace the demo map updates in `handleControllerEvent()` with calls to the existing MapLibre layer and annotation functions. The current MR Studio demo uses `BroadcastChannel` between windows; the Host handler is the intended bridge between remote input and those application actions. Keep the same fixed table coordinate normalization when mapping points to map coordinates.

## Limits and security

The random token is a lightweight bearer invitation. It is validated for every connection, but this prototype has no accounts, persistence, or production authentication. Each Host page refresh creates a new PeerJS ID and token, so old QR codes stop working. The Host supports at most two concurrent Client connections. A reconnecting tab gets its former slot if it is still free; another device may take a disconnected slot first.

PeerJS signaling helps browsers discover each other; it is separate from the WebRTC DataChannel that carries inputs and state. The default public PeerJS service and STUN settings are adequate for a prototype. Restrictive NAT or firewalls may require TURN, and a production deployment may need its own PeerServer. No client message is executed as code; the Host validates allowed input types and decides what each input does.
