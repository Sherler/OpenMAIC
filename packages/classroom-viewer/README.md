# @openmaic/classroom-viewer

Standalone classroom viewer package (**consumer side**) for OpenMAIC.

## Architecture

OpenMAIC separates into two sides:

- **Producer** (main app): Generates classroom content (outlines, scenes, media, TTS) and persists them to local file paths under `data/classrooms/{id}/`.
- **Consumer** (this package): Given a classroom ID, fetches and displays the generated resources via a read-only viewer.

## Local File Structure

Each classroom is packaged at:

```
data/classrooms/{id}.json              # Raw classroom data (stage + scenes)
data/classrooms/{id}/
├── manifest.json                      # Complete manifest with metadata, agents, media index
├── media/                             # Generated images and videos
│   ├── {elementId}.png
│   ├── {elementId}.mp4
│   └── ...
└── audio/                             # TTS audio files
    ├── tts_{actionId}.mp3
    └── ...
```

## Usage

### API Client

```typescript
import { ClassroomAPIClient } from '@openmaic/classroom-viewer/api-client';

const client = new ClassroomAPIClient({ baseUrl: 'http://localhost:3000' });

// List all available classrooms
const classrooms = await client.listClassrooms();

// Load a specific classroom
const data = await client.getClassroom('classroom-id');

// Load the full manifest (includes media index)
const manifest = await client.getManifest('classroom-id');

// Get media URL
const imageUrl = client.getMediaUrl('classroom-id', 'media/gen_img_1.png');
const audioUrl = client.getMediaUrl('classroom-id', 'audio/tts_action1.mp3');
```

### Viewer Page

The main app includes a built-in viewer route at `/viewer/[id]` that provides:

- Read-only classroom playback
- Scene navigation
- Audio playback from server-stored TTS files
- No dependency on IndexedDB or client-side state

### API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/classroom/list` | GET | List all available classrooms |
| `/api/classroom?id={id}` | GET | Get classroom data (stage + scenes) |
| `/api/classroom/manifest?id={id}` | GET | Get full manifest with media index |
| `/api/classroom-media/{id}/{path}` | GET | Stream media/audio files |

## Development

```bash
# Build the package
cd packages/classroom-viewer
npm run build

# Watch mode
npm run dev
```
