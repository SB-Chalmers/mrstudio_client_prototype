# Collaborative MR Studio controller MVP

A standalone proof of concept for four phone controllers editing one shared 100 × 60 cm table map. The fixed Host map runs in a browser on this computer. Phones open the GitHub Pages Client from one shared QR code. PeerJS establishes WebRTC DataChannels; the Host owns the map state and applies edits in arrival order.

The illustrated map has a 5 × 3 table grid and three demo layers: Streets, Buildings, and Terrain. This repository is separate from `MR-Studio-Demo`.

## Run the Host

```bash
./launch_host_server.sh
```

The script opens `http://127.0.0.1:8123/`. A different port can be passed as an argument. Keep this terminal open during the round. Restart the server after updating `host_server.py`. The Host page creates a new PeerJS ID, session token, and QR on each load. **End session** closes the round and records its end time. Closing or refreshing the Host tab also ends the round; a reload starts a fresh one.

The Python server binds only to this computer's loopback address. It serves the Host page and writes each round to `sessions/<sessionId>.json`. Logs are excluded from Git. The Host's **Download JSON log** link exports the current file. Saves happen after every meaningful action, so a browser crash still leaves the latest successfully saved snapshot; `endedAt` will be `null` if the browser could not send its final close event.

Both the Host computer and phones need internet access for PeerJS signaling. Phones do not connect to the local Python server; they use the GitHub Pages invitation URL in the QR.

## Publish the Client on GitHub Pages

Push this repository to GitHub and enable **Settings → Pages → Deploy from a branch → main → /(root)**. The Client page is `client.html`. The configured address is in `js/config.js`:

```text
https://sb-chalmers.github.io/mrstudio_client_prototype/client.html
```

Change that address if the Pages site moves, then reload the Host to create a new QR. The Host appends its current PeerJS ID and random token automatically. The URL is a bearer invitation; share it only with intended participants.

For a browser-only local check before Pages is ready, temporarily configure `http://127.0.0.1:8123/client.html`, reload the Host, and open its invitation link in separate browsers or private profiles. Restore the Pages address before scanning from phones.

## Join and edit

1. Everyone scans the same QR. Each browser receives a funny name, emoji avatar, and distinct color. The name and avatar can be edited in **Profile & slots**.
2. Choose one of four controller slots. Only a slot occupant can change the map. Additional people can see the shared map in the lobby, but cannot edit. A disconnected slot remains reserved for its person; the Host can use **Release** to free an offline slot.
3. Select a shared layer. Choose a local tool: **Point / move** places or drags a point; **Route** uses two taps; **Polygon** takes corner taps and closes by tapping its highlighted first corner or pressing Close polygon; **Sticker** places a preset symbol; **Comment** takes text, then a tap on the map.
4. Use two fingers, the zoom buttons, or a mouse wheel to change only that phone's view. Edits are always sent as normalized coordinates within the full table extent.

The phone stores its identity for this invitation in local browser storage. Refreshing or reopening the same link while the Host is still open reconnects as the same person, reclaims the reserved slot, and receives the current layer and objects. If the phone opens `client.html` without query parameters, it tries the last invitation saved in that browser. Sleeping phones use heartbeats and reconnect on wake. Clearing browser storage or switching browsers creates a new identity. A Host reload creates a new round and invalidates the old QR.

## Protocol and ownership

`js/shared.js` contains the map renderer and input validation. `js/client.js` handles its own zoom and pan, profile UI, identity, and PeerJS reconnection. `js/host.js` validates the invitation, owns participants and slots, applies map actions in `handleControllerEvent()`, broadcasts resulting state, and records semantic events. `host_server.py` atomically writes revisioned JSON documents to disk.

| Direction | Message | Meaning |
| --- | --- | --- |
| Connection metadata | `{ token, clientId }` | Validate this round's invitation and recognize the browser. |
| Client → Host | `{ type: "profile", name, avatar }` | Update this person's display profile. |
| Client → Host | `{ type: "claim-slot", slot }`, `{ type: "release-slot" }` | Request or release one of the four editing slots. |
| Client → Host | `{ type: "button", button, state: "pressed" }` | Choose a layer/tool or finish/cancel a polygon. |
| Client → Host | `{ type: "pointer", phase, tool, x, y, ... }` | `down`, `move`, `up`, or `cancel`; positions are 0–1. Optional fields contain a point target ID, sticker, or comment. |
| Both directions | `ping`, `pong` | Detect a stale sleeping connection. |
| Host → Client | `welcome`, `state`, `notice`, `rejected` | Return the complete shared state, participant and slot list, or an error. |

The Host accepts edits only from the current occupant of a slot. Reconnecting with the same browser identity replaces its stale DataChannel. When two controllers move the same point at once, the latest received position wins. Pointer moves are broadcast for live feedback but only the final drag position is written to the round log.

## Round JSON for a future Session Explorer

Each `sessions/<sessionId>.json` is a self-contained, versioned record. It includes `schemaVersion`, `sessionId`, `startedAt`, `endedAt`, `updatedAt`, monotonic `revision`, physical table metadata, the participant roster, `finalState`, and an ordered `events` array. Each event has `seq`, ISO `timestamp`, `elapsedMs`, an `actor` snapshot with ID, name, avatar, color and slot, a `kind`, `details`, and complete `stateAfter`, `participantsAfter`, and `slotsAfter` snapshots. The starting event has `seq: 1`. A future timeline can show the snapshots from the latest event at or before the scrubber time, without reconstructing raw pointer events. Profile, join, reconnect, disconnect, slot, layer, draft, object, and end events are recorded. A small close message separately writes `endedAt` if the browser closes before its final event upload completes.

The durable log uses person IDs and names; annotations also store creator ID, name, color, and controller slot. The IDs are scoped to the invitation, so a new Host round assigns a new identity. The local server accepts only same-origin JSON posts and does not serve the `sessions/` directory as ordinary static files.

To integrate with MR Studio later, retain the validated PeerJS input path and replace the demo actions inside `handleControllerEvent()` with the app's MapLibre layer and annotation calls. Preserve the normalized table coordinates when translating to map positions. The public PeerJS signaling service is appropriate for this prototype; production reliability may require a dedicated signaling and TURN setup.
