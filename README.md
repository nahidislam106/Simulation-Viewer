<div align="center">

# Simulation Viewer

3D simulation file viewer for VS Code.
Open, inspect, and interact with VTK datasets directly in the editor.

[![Version](https://img.shields.io/badge/version-0.0.1-blue?style=flat-square)](https://marketplace.visualstudio.com/)
[![VS Code](https://img.shields.io/badge/VS%20Code-%5E1.85.0-007ACC?style=flat-square&logo=visualstudiocode)](https://code.visualstudio.com/)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-lightgrey?style=flat-square)]()

Publisher: Nahiid Islam

</div>

---

## What is Simulation Viewer?

Simulation Viewer is a custom editor extension for VS Code that provides an end-to-end simulation visualization workflow for `.vtk`, `.vtu`, `.vtp`, and `.mph` files.

It starts a local Python backend (FastAPI + PyVista), processes your dataset into render-ready polydata, and displays it in an interactive webview powered by vtk.js.

No external server is required, and the vtk.js runtime is bundled locally for offline use.

---

## Features

### One-click Visualization in VS Code
- Opens supported simulation files directly as a custom editor
- Integrated rendering viewport with orbit/pan/zoom interaction
- No context switch to external tools

### Local Backend, No Cloud Dependency
- Automatically starts a local FastAPI backend from the extension
- Uses PyVista to process and triangulate surface geometry
- Works offline once dependencies are installed

### Scientific Display Controls
- Scalar field selector (point or cell data)
- Colormaps: Rainbow, Viridis, Cool-Warm, Plasma, Grayscale
- Custom scalar range min/max with reset
- Clip plane with axis selection (X, Y, Z)
- Opacity slider, bounding box toggle, axes toggle

### Productivity Utilities
- Screenshot export (PNG saved next to source file)
- Dataset stats panel (points, cells, bounds)
- Progress overlays for upload/process/load states

### MPH Handling
- `.mph` files are detected and marked as pending conversion
- User-friendly guidance is shown to export from COMSOL to `.vtk`/`.vtu`

---

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Build extension

```bash
npm run compile
```

### 3. Run in Extension Development Host

Press F5 in VS Code, then open any supported simulation file.

Supported extensions:
- `.vtk`
- `.vtu`
- `.vtp`
- `.mph`

---

## First Run Behavior

When activated, the extension:

1. Checks `simulationViewer.pythonPath` (if configured)
2. Falls back to its managed virtual environment if needed
3. Creates a private venv on first run and installs backend requirements
4. Starts backend on a free local port
5. Opens files in the Simulation Viewer custom editor

If a configured Python path is invalid, the extension auto-falls back and logs diagnostics in the Simulation Viewer output channel.

---

## Extension Settings

| Setting | Default | Description |
|---|---|---|
| `simulationViewer.pythonPath` | `""` | Python interpreter path. Leave empty for auto-detect/fallback. |
| `simulationViewer.autoStartBackend` | `true` | Starts backend automatically during activation. |
| `simulationViewer.keepTempFiles` | `false` | Keeps processed files for faster reopen/debug workflows. |

---

## Commands

| Command | Description |
|---|---|
| `Simulation Viewer: Open in Simulation Viewer` | Opens selected or active supported file in the custom viewer. |
| `Simulation Viewer: Show Log` | Opens the extension output channel for diagnostics. |

---

## Project Structure

```text
simulation-viewer/
├── src/
│   ├── extension.ts
│   └── SimulationViewerPanel.ts
├── media/
│   └── viewer.html
├── backend/
│   ├── server.py
│   ├── converter.py
│   └── requirements.txt
├── logo.png
├── package.json
├── tsconfig.json
└── webpack.config.js
```

---

## Packaging

```bash
npm install -g @vscode/vsce
npm run build
vsce package
```

---

## Troubleshooting

### Backend failed to start
- Open command: Simulation Viewer: Show Log
- Verify Python path setting or leave it empty for auto fallback

### vtk.js runtime failed to load
- Rebuild extension (`npm run compile`)
- Ensure `dist/media/vtk.js` exists after build

### MPH file not rendering
- Export from COMSOL to `.vtk` or `.vtu`
- Reopen exported file in Simulation Viewer

---

## License

MIT
