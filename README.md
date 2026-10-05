# RC Dolphin AI 🐬

Mobile-first PWA for local GGUF inference with wllama/llama.cpp.

## Included

- ChatGPT-style mobile UI.
- Dolphin 2.6 Phi 2 Q4_K_M GGUF downloader.
- Resumable HTTP Range download into Origin Private File System.
- IndexedDB chat history and settings.
- WebGPU-first llama.cpp inference.
- Automatic CPU/WASM retry when WebGPU loading fails.
- PWA manifest and service worker.
- No cloud chat API.

## Default model

The app uses the Dolphin 2.6 Phi 2 Q4_K_M GGUF file from TheBloke's GGUF repository. The file is about 1.79 GB, so a phone needs substantially more free storage and RAM than the file size alone.

The upstream Dolphin 2.6 Phi 2 model is based on Phi-2 and its published model card uses Microsoft's research license. Check the upstream license before redistribution or commercial use.

## Android setup

1. Host this repository on an HTTPS static host.
2. Open it in a compatible Chromium-based browser.
3. Install with Add to Home screen.
4. Download the model once while online.
5. After the model is stored locally, chat inference is performed in-browser.

file:// is not suitable for service-worker/PWA testing. Use HTTPS or a local HTTP development server.

## Runtime notes

wllama 3.x provides llama.cpp WebGPU support and a WASM fallback. The app attempts GPU offload first and retries with n_gpu_layers: 0 when GPU model loading fails.

The browser still controls memory limits. A 1.79 GB model can require several GB of working memory, so some phones will not be able to load it even if storage is sufficient.

## Files

- index.html — application shell
- styles.css — mobile UI
- app.js — storage, downloader, model runtime and chat
- sw.js — service worker
- manifest.json — PWA metadata
- assets/logo.svg — supplied Dolphin logo
