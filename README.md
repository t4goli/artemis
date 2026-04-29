# Artemis

A local prototype for guided phone capture and 360-style viewing of a place or moment.

The app starts with a full-screen camera guide, captures overlapping Level, Ceiling, and Floor rows, saves photos locally so a phone refresh does not lose the scan, uploads frames to a Flask backend, and lets the user review the captured scene in a draggable 360 viewer.

## Current Prototype

- Mobile-first guided capture screen.
- Level, Ceiling, and Floor row tracking.
- Auto-capture based on phone orientation.
- Browser-side photo persistence using IndexedDB.
- Backend frame persistence under `uploads/`.
- Preview sphere viewer with black areas for missing coverage.
- Finalize endpoint that tries Hugin first for a full equirectangular 360.
- Fallback photo-map composition if Hugin cannot stitch the scene.

## Serious Version Direction

Artemis is moving toward a private capture app plus a public web viewer:

```text
private iPhone capture app
-> backend stitch/processing pipeline
-> public 360 memory viewer
```

The first serious-version app shell lives in:

```text
apps/mobile
```

It is an Expo React Native app that can be developed from Windows and later built for iPhone through Expo/EAS cloud builds.

Run it with:

```powershell
cd apps\mobile
npm.cmd start
```

The next mobile milestones are camera access, orientation/pose capture, guided target locking, local capture storage, and private upload to the backend.

## Setup

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python app.py
```

Then open:

```text
http://127.0.0.1:5000
```

For phone testing, run:

```bash
ngrok http 5000
```

Open the HTTPS ngrok URL on the phone.

## Optional High-Quality Finalize

Install Hugin for the best finalize path:

```text
C:\Program Files\Hugin\bin
```

The app looks for Hugin tools such as `pto_gen.exe`, `cpfind.exe`, `autooptimiser.exe`, `pano_modify.exe`, and `hugin_executor.exe`.

## Notes

This is a prototype. The browser version can prove the capture and viewer workflow, but truly reliable YouTube-style 360 output needs a more serious capture stack: native phone app, ARKit/ARCore pose tracking, better frame selection, and a full stitching/blending backend.
