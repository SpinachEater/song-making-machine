---
title: Sheet Music Reader
emoji: 🎼
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
short_description: Reads photos of sheet music into MusicXML (homr)
---

The sheet music reader for Song Making Machine's Photo to Sheet Music module.
It runs the free [homr](https://github.com/liebharc/homr) reader (AGPL-3.0), unmodified.

- `GET /health` reports that it is running.
- `POST /recognize` with `{"pages": ["data:image/jpeg;base64,..."]}` returns `{"musicxml": "..."}`.

This Space is deployed automatically from the `server/` folder of the Song Making Machine repository.
