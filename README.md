# Signal Lattice

`Signal Lattice` is a browser-based digital musical instrument disguised as a control interface.

This project is not a DAW, not a plugin, and not a commercial product.
It is a system for signal-state research: controlled tension, rhythm, instability, and observation.

## Concept

The interface behaves like a hybrid of:
- semi-modular synthesis logic
- monitoring/telemetry console
- autonomous machine with its own internal rules

Design goals:
- cold signal aesthetics
- low emotion, high information density
- strict constraints over convenience

## Current Feature Set

### Core Signal System
- `ROUTING FIELD 12x8` matrix with manual cell activation
- internal tick cycle with evolving state
- routing modes: `A / B / C`
- constraints:
  - `THRESHOLD LINE`
  - `LIMITER WINDOW`
  - `ROUTE WEIGHT`

### Fault Engine
- fault profiles:
  - `00 NOMINAL`
  - `11 CHOKE`
  - `21 DRIFT`
  - `31 BURST`
- fault intensity control: `FAULT INTENSITY`
- adaptive switching: `AUTO FAULT`
- effective state readout: `FAULT ACTUAL`

### Audio Engine (Web Audio API)
- dual oscillator signal source
- filter core with mode-dependent behavior
- drive stage (`DRIVE`) using waveshaping
- space stage (`SPACE MIX`, `SPACE FEEDBACK`) using delay-feedback bus
- live parameter mapping from telemetry and fault state

### External Input
- source selector:
  - `SYNTHETIC`
  - `MIC INPUT`
- mic arming via `ARM MIC` (`getUserMedia`)
- microphone diagnostics:
  - `MIC` status (`OFF/LIVE/DENY/N/A`)
  - `MIC LEVEL` value
  - level bar + peak hold indicator

### Monitoring + Scope
- readouts:
  - `IN / OUT / LOSS`
- telemetry:
  - `AMP`, `DENS`, `JITTER`, `CLIP`
- scope modes:
  - `WAVE` (time-domain waveform)
  - `SPECTRUM` (frequency bins)

### Snapshot System
- 3 state slots (`01/02/03`)
- actions:
  - `WRITE`
  - `RECALL`
  - `PURGE`
- local persistence in `localStorage`
- JSON export/import:
  - `EXPORT`
  - `IMPORT`
  - schema validation (`signal-lattice-snapshot-pack-v1`)
  - import modes:
    - merge (`MERGE IMPORT` enabled)
    - replace (`MERGE IMPORT` disabled)

## Tech Stack

- Plain HTML/CSS/JavaScript (no framework/build step)
- Web Audio API
- Canvas 2D API for scope rendering

## Project Structure

- `index.html` - interface layout and controls
- `styles.css` - visual system and responsive rules
- `app.js` - routing logic, telemetry, audio graph, scope, snapshots
- `PROJECT_INSTRUCTION.md` - working internal project instruction log

## Run Locally

No build is required.

### Option 1: direct open
Open `index.html` in a modern browser.

### Option 2: recommended local server
Serve the folder from `http://localhost` (recommended for stable device/media permissions):

```powershell
cd c:\Users\alevo\Desktop\0702
python -m http.server 8080
```

Then open:
- `http://localhost:8080`

## Browser Requirements

Recommended:
- Chrome (latest)
- Edge (latest)

Notes:
- Audio starts after first user interaction (browser autoplay policy).
- Microphone input requires user permission.
- For reliable media behavior, use `localhost` or secure context.

## Quick Start Workflow

1. Open the page.
2. Click once to arm audio (`AUDIO: LIVE`).
3. Toggle matrix cells in `ROUTING FIELD`.
4. Select routing mode `A/B/C`.
5. Adjust constraints and fault controls.
6. Use `DRIVE` and `SPACE` for color and depth.
7. (Optional) Enable `MIC INPUT`:
   - click `ARM MIC`
   - allow mic access
   - set `EXT SOURCE = MIC INPUT`
8. Monitor response via telemetry + scope.
9. Save states into snapshot slots.

## Snapshot JSON Format

Exported files include:
- `schema`
- `exportedAt`
- `slots` object (`1`, `2`, `3`)

Each slot contains:
- `controls` object (current parameters)
- `matrix` array (`12x8` flattened to 96 values)

## Design Constraints

- no skeuomorphism
- no music icons
- no imitation of hardware UI
- max 2 accent colors + black
- single technical mono font

Current palette:
- `#000000`
- `#B8C2CC`
- `#00E5FF`

## Limitations

- No MIDI support yet.
- No external clock sync yet.
- No formal scene-morph engine yet.
- Microphone path currently focuses on level-driven behavior, not advanced dynamics control.

## Roadmap (Next)

- scene morphing between snapshots
- advanced clock engine (internal/external sync)
- microphone input limiter/compressor stage
- scripted fault transitions
- richer snapshot migration/versioning

## License

No license file is currently provided.
If you plan public distribution, add a `LICENSE` file (for example MIT).
