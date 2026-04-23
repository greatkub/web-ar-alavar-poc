# AlvaAR

AlvaAR is a realtime visual SLAM algorithm running as WebAssembly, in the browser. It is a heavily modified version of the [OV²SLAM](https://github.com/ov2slam/ov2slam) and [ORB-SLAM2](https://github.com/raulmur/ORB_SLAM2) projects. SLAM is the core building block of Augmented Reality applications focusing on world tracking.

![image](examples/public/assets/image.gif)


## Examples
The examples use [ThreeJS](https://threejs.org/) to apply and render the estimated camera pose to a 3d environment.  

[Video Demo](https://alanross.github.io/AlvaAR/examples/public/video.html): A desktop browser version using a video file as input.  
[Camera Demo](https://alanross.github.io/AlvaAR/examples/public/camera.html): The mobile version will access the device camera as input.

<img width="75" src="examples/public/assets/qr.png">

### Quick start smoke test
The fastest way to test AlvaAR locally is to run the React/Vite example app. This does not rebuild the WebAssembly bundle.

```
    $: cd ./examples/
    $: npm install
    $: npm run start:http
```

Then open the local URL printed by Vite, usually [http://localhost:5174/](http://localhost:5174/) or [https://localhost:5174/](https://localhost:5174/) when `examples/ssl/` certificates exist. The page should show the GreenCredit clickable prototype with the Home, Jasmine, AR capture, chat, tree image analysis, SAM3-LiteText test, and Store screens. The video smoke test remains available at `/video.html` on the same origin.

The live React camera demo is still available at `/?mode=ar` on the same origin. It requests camera permission and renders state-driven Jasmine sprite-sheet atlases once tracking has a camera pose: `examples/public/assets/ar-character-idle.png` loops by default, `ar-character-sunlight.png` plays when the sun action is requested, `ar-character-water.png` plays when the water action is requested, and `ar-character-talking.png` loops while Jasmine TTS is speaking. React dispatches those changes with the `archaractersprite` browser event so the AR layer can stay decoupled from the chat and care UI, and the standalone AR route exposes icon-only water and sunlight controls for direct testing. The demo automatically looks for the plant base by finding a narrow stem-like column with dark soil below it, then locks the character into SLAM world space so it does not simply slide with the camera. It also includes a lightweight leaf-colored occlusion layer that redraws green foreground pixels above the AR overlay so nearby leaves can visually cover the character. Tap directly on the camera view to create a one-shot locked anchor at that screen position; the demo then tracks the tapped visual patch and continuously corrects the anchor to reduce visible drift. The bottom-center circular placement button still anchors at the button position and is lifted above mobile in-app browser chrome with `visualViewport` offsets. The camera demo can load MediaPipe Hands after tapping the `Hand` button to prototype hand interactions: rubbing the character head, pinching any visible part of the character with thumb and index finger to drag/reposition it, and scooping/lifting with an open palm. When hand tracking is active, the thumb landmarks are also redrawn from the camera feed above the AR layer so the thumb can visually cover the character while the index finger remains behind it, and a translucent glowing energy ball appears only while an active pinch is dragging the character. Those interactions emit a `characterinteraction` browser event so another image or animation layer can reuse the same action state later. Hand inference stays opt-in and runs at a lower sample resolution, with faster sampling only while actively dragging.

For phone camera testing on the local network, use the HTTPS Vite URL, such as [https://192.168.1.199:5174/](https://192.168.1.199:5174/). Mobile Safari does not expose `navigator.mediaDevices.getUserMedia` on plain HTTP LAN addresses. If you use the generated self-signed certificate, Safari will show a certificate warning that must be accepted before camera permission can appear.

The GreenCredit prototype uses existing static assets from `examples/public/assets/` for the Jasmine character and CSS-drawn foliage/camera scenes for the mocked plant views. The live camera mode imports the existing AlvaAR browser modules, and the video demo and AR view import ThreeJS modules from `threejsfundamentals.org`, so keep an internet connection available for those checks.

The Jasmine chat microphone streams browser audio to the Railway ASR WebSocket at `wss://web-ar-alavar-poc-fastapi-production.up.railway.app/ws/asr`, requests `qwen3-asr-flash-realtime-2026-02-10`, and renders partial ASR text as live captions in the listening panel. When ASR returns a final transcript, the frontend stops microphone streaming, sends that transcript to the Railway TTS WebSocket at `wss://web-ar-alavar-poc-fastapi-production.up.railway.app/ws/tts`, requests `qwen3-tts-vd-realtime-2026-01-15` with `voice: "myvoice"` by default, and plays the returned 24 kHz PCM audio as Jasmine's temporary response. The current Railway deployment requires an API auth token, so set `VITE_ASR_CLIENT_TOKEN` before running Vite; TTS reuses that value unless `VITE_TTS_CLIENT_TOKEN` is set. To point the frontend at another backend, set `VITE_ASR_WS_URL` and `VITE_TTS_WS_URL`. To use a different designed voice, set `VITE_TTS_VOICE`.

The Tree image analysis screen calls the Railway API at `https://web-ar-alavar-poc-fastapi-production.up.railway.app/tree/analyze`, resizes the selected photo to a JPEG data URL before upload, and renders the returned tree identification plus carbon valuation fields only when the browser plant check and backend result both look plant-like. Its `Open camera` action starts a live `getUserMedia` stream in the preview, captures a frame with the shutter button, and then runs the same analysis path as selected gallery photos. The dynamic AR companion capture path first validates the camera frame with the browser plant mask, then starts a FastAPI `/plant/avatar/companion/jobs` job and polls it through `Checking plant`, `Identifying plant`, `Designing avatar`, `Animating companion`, and `Preparing AR` states before opening the AlvaAR route. It defaults to a 896px maximum width and 0.72 JPEG quality for faster mobile captures; override these with `VITE_TREE_IMAGE_MAX_WIDTH` and `VITE_TREE_IMAGE_JPEG_QUALITY` if needed. The backend request defaults to `VITE_TREE_ANALYSIS_MODEL=qwen3.6-flash` with `VITE_TREE_ANALYSIS_ENABLE_THINKING=true` because the Railway tree pipeline uses Qwen web tools that require thinking mode; these values can be overridden for backend experiments. If the backend deployment requires bearer auth, set `VITE_TREE_ANALYSIS_CLIENT_TOKEN` before running Vite; `VITE_API_AUTH_TOKEN` is also recognized for local compatibility. These Vite values are browser-visible, so use only a backend-issued client token here, never an Alibaba/DashScope provider key. To point at a different backend, set `VITE_TREE_ANALYSIS_URL`, `VITE_PLANT_AVATAR_PROMPT_URL`, or `VITE_PLANT_COMPANION_JOBS_URL`.

The AR companion demo now has two paths. `Quick AR demo` opens `?mode=ar` and uses the bundled `ar-character-idle.png`, `ar-character-talking.png`, `ar-character-water.png`, and `ar-character-sunlight.png` resources with their existing `4 x 8` / 30-frame metadata, so it does not generate a new avatar or call the sprite pipeline. The full `Discover` capture path opens the same AlvaAR background after the backend returns generated sprite-sheet metadata. Runtime sprite overrides are stored in session storage, passed to `examples/public/assets/view.js` with the `archaracterspriteset` browser event, and then animated by the same `archaractersprite` action event used by the quick demo. Generated sheets are expected to describe their own `columns`, `rows`, `frameCount`, `fps`, and `loop` values; the current full-flow default is 60 frames at 30 FPS, normally packed as `4 x 15`.

The standalone AR route also exposes a microphone control. It streams microphone audio through the existing ASR flow, sends the final transcript to the backend voice-reply endpoint for the LLM response and TTS audio, switches the AR sprite to `talking` while the reply connects/streams/plays, and returns to `idle` afterward. Water and sunlight controls continue to play one-shot `water` and `sunlight` animations before the AR renderer returns to idle.

The browser segmentation test route is available from the Home screen and directly at `/?route=sam3-litetext` or `/sam3-litetext`. It now runs on the client with `@huggingface/transformers` and a local copy of `Xenova/segformer-b0-finetuned-ade-512-512` under `examples/public/models/`, using WebGPU when the browser can provide a usable WebGPU runtime on a secure origin and falling back to the browser WASM runtime otherwise. iOS browsers are kept on WASM by default because Safari can expose `navigator.gpu` before the ONNX Runtime WebGPU backend is usable there. The `Open camera` action starts a live webcam/device-camera preview with `getUserMedia`; the shutter captures the current frame, while `Select photo` still opens the file picker. The selected or captured photo is resized in-browser before inference, the prompt filters fixed semantic labels such as `tree`, `plant`, `grass`, `flower`, and `palm`, and masks are shown as an overlay plus compact uncompressed RLE in the JSON output. Override the browser model with `VITE_BROWSER_SEGMENTATION_MODEL`, force a runtime with `VITE_BROWSER_SEGMENTATION_DEVICE` (`auto`, `webgpu`, or `wasm`; `cpu` is treated as `wasm` in the browser), tune local model hosting with `VITE_BROWSER_SEGMENTATION_LOCAL_MODEL_PATH`, `VITE_BROWSER_SEGMENTATION_CACHE_KEY`, `VITE_BROWSER_SEGMENTATION_DTYPE`, and `VITE_BROWSER_SEGMENTATION_ALLOW_REMOTE_MODELS`, tune image upload size with `VITE_BROWSER_SEGMENTATION_IMAGE_MAX_WIDTH` and `VITE_BROWSER_SEGMENTATION_IMAGE_JPEG_QUALITY`, and adjust pipeline defaults with `VITE_BROWSER_SEGMENTATION_THRESHOLD`, `VITE_BROWSER_SEGMENTATION_MASK_THRESHOLD`, and `VITE_BROWSER_SEGMENTATION_MIN_AREA_RATIO`. The route defaults `VITE_BROWSER_SEGMENTATION_DTYPE` to `fp32` so mobile WASM loads the bundled `onnx/model.onnx` instead of looking for a separate quantized ONNX file. This route no longer calls the Railway SAM3-LiteText API or Hugging Face model URLs by default.

Supabase auth is enabled when `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` or `VITE_SUPABASE_ANON_KEY` are set. If those values are missing, the prototype starts in a local demo session so camera, chat, store, and Tree image analysis screens can still be tested on LAN without crashing; Supabase-backed sign-in and collection persistence are disabled in that mode.

### Run with http server
To run the React examples on your local machine, start the Vite dev server in the examples folder:

```
    $: cd ./examples/
    $: npm run dev
```

Then open the printed Vite origin for the GreenCredit prototype, add `?mode=ar` for the live React camera demo, or open `/video.html` for the legacy video demo served from Vite's public asset folder.

### Run with https server
To run the examples on another device in your local network, they must be served via https. For convenience, a simple https server was added to this project – do not use for production.

#### 1) Install server dependencies
```
    $: cd ./examples/
    $: npm install
```

#### 2) Generate self-signed certificate
```
    $: cd ./examples
    $: mkdir ssl/
    $: cd ssl/
    $: openssl req -nodes -new -x509 -keyout key.pem -out cert.pem
```

#### 3) Run
```
    $: cd ./examples/
    $: npm run build
    $: npm start
``` 
Then open [https://YOUR_IP:443/](https://YOUR_IP:443/) in your browser. The Express server serves `examples/dist/` after a build and falls back to `examples/public/` only when no React build exists.
If met with a <b>ERR_CERT_INVALID</b> error in Chrome,
try typing <i>badidea</i> or <i>thisisunsafe</i> directly in Chrome on the same page.
Don’t do this unless the site is one you trust or develop.

### Changelog notes
2026-04-20: Added a reproducible quick-start smoke test for the prebuilt web demo and an `examples` npm script for the Python HTTP server. Configuration impact: no production settings changed; the new script requires Python 3 and serves the existing `examples/` files on port 8080. Verification: from the repo root, run `cd ./examples && npm run start:http`, open `http://localhost:8080/public/video.html`, and confirm the demo video plus FPS/timing stats are visible.

2026-04-20: Replaced the camera demo's default low-poly ThreeJS marker with a transparent image marker loaded from `examples/public/assets/demo-marker.png`. Configuration impact: no runtime configuration changes; the image is served as a static asset and used by `ARCamView`. Verification: run the quick-start server, open `http://localhost:8080/public/camera.html`, allow camera access, and confirm the image appears instead of the faceted ball when tracking is active.

2026-04-20: Added a screen-space leaf occlusion layer to the camera demo. Configuration impact: no server changes; `camera.html` now adds a transparent canvas over the AR layer and masks green, leaf-like camera pixels over the virtual image. Verification: run the camera demo, let tracking show the image marker, then move a green leaf or similar object between the camera and the marker; the green foreground pixels should cover the image instead of the image always drawing on top.

2026-04-20: Added automatic plant-base anchoring to the camera demo. Configuration impact: no server changes; `camera.html` now estimates the stem/soil intersection from the camera frame and passes fresh stable detections to `ARCamView`, which locks the marker in SLAM world space. Verification: point the camera at a potted plant with visible stem and soil, wait for the image to appear near the base, then move the camera side to side; the marker should stay closer to the plant base instead of floating with the camera. Tap the screen to reset SLAM and re-detect the anchor.

2026-04-21: Added a bottom-center circular placement button to the camera demo, matching the provided reference style, and changed image placement to lock to a single anchor instead of continuously nudging left/right from fresh detections. Configuration impact: no server changes; `camera.html` now queues a manual anchor from the button position and `ARCamView` ignores later detector updates until placement is reset. Verification: run the quick-start server, open `http://localhost:8080/public/camera.html`, allow camera access, tap the white circular button near the bottom center, and move the phone side to side; the image should stay anchored instead of floating laterally.

2026-04-21: Added a MediaPipe hand-tracking prototype for hand-driven character interactions in the camera demo. Configuration impact: no server changes; `camera.html` loads `@mediapipe/hands@0.4.1675469240` from jsDelivr only after the `Hand` button is tapped, so the camera page needs internet access to enable hand tracking. Verification: run the quick-start server, open `http://localhost:8080/public/camera.html`, allow camera access, place the character, tap `Hand`, then try rubbing the top of the image with an index finger, holding an open palm under it, or pinching near either cheek; the on-screen status should report `Rub head`, `Scoop lift`, or `Pull left/right cheek`, and the image should wobble, lift, or stretch.

2026-04-21: Made MediaPipe hand tracking opt-in and throttled so it does not block the camera demo on mobile. Configuration impact: no server changes; `camera.html` now keeps hand tracking off until the `Hand` button is tapped, loads the model lazily, and runs gesture inference on a slower timer instead of inside the AR render loop. Verification: open `http://localhost:8080/public/camera.html`, confirm the camera moves normally with status `Hand off`, then tap `Hand`; after the model loads, the status should change to hand tracking states without freezing the camera.

2026-04-21: Retuned hand tracking for slower mobile browsers after the Tasks Vision worker path failed in Chrome. Configuration impact: no server changes; `camera.html` now uses the older MediaPipe Hands package at low resolution and low frequency, and the camera capture request was reduced to 640px ideal width to improve mobile performance. Verification: open `http://localhost:8080/public/camera.html`, confirm camera motion works before tapping `Hand`, then tap `Hand`; the status should move from `Loading hand model...` to `Show hand near character` without freezing AlvaAR.

2026-04-21: Added tap-to-place anchoring to the camera demo. Configuration impact: no server changes; `camera.html` now treats a tap on the live camera view as the requested anchor point and reserves double tap on the camera view for resetting tracking. Verification: open `http://localhost:8080/public/camera.html`, allow camera access, tap a visible point in the camera view, and confirm the image locks to that tapped screen position instead of only using the bottom circular button.

2026-04-21: Added visual patch correction for manual tap anchors. Configuration impact: no server changes; `camera.html` now captures a small grayscale patch around the tapped camera point and tracks that patch frame-to-frame, passing follow-up anchor corrections into `ARCamView`. Verification: open `http://localhost:8080/public/camera.html`, tap a textured point such as rock, bark, soil, or a patterned surface, then move the phone slowly; the image should follow that visible patch more tightly than the fixed-distance ray anchor.

2026-04-21: Strengthened manual tap anchoring with a more conservative visual patch tracker. Configuration impact: no server changes; `camera.html` now matches tapped patches using brightness, chroma, and edge features, searches coarse-to-fine, rejects ambiguous jumps, and updates the template less often to reduce sliding. Verification: open `http://localhost:8080/public/camera.html`, tap a high-texture point, then move the phone slowly side to side; the image should resist drifting or jumping to nearby similar areas better than the previous grayscale tracker.

2026-04-21: Replaced the still image AR marker with a looping character sprite sheet. Configuration impact: no server changes; `ARCamView` now loads `examples/public/assets/demo-character-sprite.png`, keys out the grey/white source-sheet background in the browser, crops each 4x5 atlas cell to the active character area, and plays the first 17 frames at 7 FPS. Verification: run the quick-start server, open `http://localhost:8080/public/camera.html`, allow camera access, place the character, and confirm the AR overlay animates instead of staying on a static image.

2026-04-21: Converted the camera demo shell to React with Vite while keeping the existing AlvaAR, ThreeJS, gesture, anchoring, and sprite logic as browser ESM modules, and removed the vulnerable `ip` package from the HTTPS server. Configuration impact: the examples package now requires Node 20.19 or newer, uses `npm run dev`/`npm run start:http` on configured port 5174, builds to `examples/dist/`, and the HTTPS Express server serves the built React app when `dist/index.html` exists. Verification: run `cd ./examples && npm install && npm run build`, then run `npm run start:http` and open `http://localhost:5174/` to confirm the React camera shell loads; for phone testing, generate the existing SSL certificate, run `npm start`, and open `https://YOUR_IP:443/`.

2026-04-21: Added HTTPS LAN guidance and a clearer camera API error when the page is opened from an insecure origin. Configuration impact: local Vite automatically switches to HTTPS when `examples/ssl/key.pem` and `examples/ssl/cert.pem` exist; no checked-in certificate files are required. Verification: run `cd ./examples && npm run start:http`, open `https://192.168.1.199:5174/` on a phone, accept the local certificate warning, tap Start, and confirm the browser asks for camera permission instead of showing `navigator.mediaDevices.getUserMedia` as undefined.

2026-04-21: Added a clickable GreenCredit/Jasmine React prototype as the default app screen while preserving the live AR camera behind `?mode=ar`. Configuration impact: no backend changes; the root Vite URL now opens mocked prototype screens using existing static assets, and camera permission is only requested from `/?mode=ar`. Verification: run `cd ./examples && npm run build`, then open the printed Vite URL to navigate Home, Discover, AR capture, chat, Store, About, and Makers, and open the same origin with `?mode=ar` to confirm the original camera Start screen still appears.

2026-04-21: Fixed the live AR character sprite cutout so pale face and hand pixels are not removed as background. Configuration impact: no server changes; `ARCamView` now flood-fills only sprite-sheet background connected to each atlas cell edge instead of globally keying every grey or white pixel. Verification: run `cd ./examples && npm run build`, open the live camera at `?mode=ar`, place the character, and confirm the face renders cleanly without camera pixels showing through the eyes or cheeks.

2026-04-22: Connected the Jasmine chat microphone to the Railway ASR WebSocket for realtime captioning. Configuration impact: no backend changes; the frontend defaults to `wss://web-ar-alavar-poc-fastapi-production.up.railway.app/ws/asr`, reads `VITE_ASR_CLIENT_TOKEN` for the current token-protected deployment, and can be redirected with `VITE_ASR_WS_URL`. Verification: run `curl https://web-ar-alavar-poc-fastapi-production.up.railway.app/health`, run `cd ./examples && npm run build`, open the HTTPS Vite URL, enter Jasmine chat, tap the microphone, speak, and confirm partial ASR text appears in the listening panel.

2026-04-22: Added Jasmine TTS playback after ASR completion. Configuration impact: no backend changes; the frontend defaults to `wss://web-ar-alavar-poc-fastapi-production.up.railway.app/ws/tts`, reuses `VITE_ASR_CLIENT_TOKEN` unless `VITE_TTS_CLIENT_TOKEN` is provided, uses `VITE_TTS_VOICE` when set, and can be redirected with `VITE_TTS_WS_URL`. Verification: run `cd ./examples && npm run build`, open the HTTPS Vite URL, enter Jasmine chat, tap the microphone, speak a sentence, pause until ASR completes, and confirm Jasmine plays that final transcript back through TTS.

2026-04-22: Replaced the live AR character sprite sheet with the supplied cartoon cactus character atlas. Configuration impact: no server changes; `ARCamView` still loads `examples/public/assets/demo-character-sprite.png`, but the atlas metadata now uses a 4x2 grid with 8 frames and a tighter cartoon crop. Verification: run `cd ./examples && npm run build`, open the Vite URL with `?mode=ar`, allow camera access, place the character, and confirm the cactus cartoon animates in the AR overlay.

2026-04-22: Swapped the live AR character sprite sheet to the second supplied waving cactus atlas. Configuration impact: no server changes; `ARCamView` still loads `examples/public/assets/demo-character-sprite.png`, but the atlas metadata now uses a 4x3 grid with 12 frames and a crop sized for the raised-hand animation. Verification: run `cd ./examples && npm run build`, open the LAN HTTPS Vite URL with `?mode=ar`, allow camera access, place the character, and confirm the waving cactus cartoon animates in the AR overlay.

2026-04-22: Added the authenticated Tree image analysis frontend flow. Configuration impact: no backend changes; the React app now has a Tree image analysis screen that uses mobile camera/file input, compresses the photo in-browser, posts it to `/tree/analyze`, and reads optional `VITE_TREE_ANALYSIS_CLIENT_TOKEN`, `VITE_API_AUTH_TOKEN`, `VITE_TREE_ANALYSIS_URL`, `VITE_TREE_IMAGE_MAX_WIDTH`, and `VITE_TREE_IMAGE_JPEG_QUALITY`. Verification: run `cd ./examples && npm run build`, start Vite, sign in, open Tree image analysis, capture or select a tree photo, and confirm the result fields or retryable error state render.

2026-04-22: Added a local demo fallback when Supabase browser env variables are missing. Configuration impact: real Supabase auth still requires `VITE_SUPABASE_URL` plus `VITE_SUPABASE_PUBLISHABLE_KEY` or `VITE_SUPABASE_ANON_KEY`; without them, the React prototype skips sign-in and disables Supabase persistence instead of throwing `supabaseUrl is required`. Verification: run `cd ./examples && npm run build` with no Supabase env, open the Vite URL, and confirm the Home screen loads as `Local demo`.

2026-04-22: Added a dedicated SAM3-LiteText segmentation test route. Configuration impact: the React app now reads optional `VITE_SAM3_LITETEXT_URL`, `VITE_SAM3_LITETEXT_MODEL`, `VITE_SAM3_LITETEXT_CLIENT_TOKEN`, `VITE_SAM3_LITETEXT_THRESHOLD`, `VITE_SAM3_LITETEXT_MASK_THRESHOLD`, and `VITE_API_AUTH_TOKEN`, then posts a compressed image plus prompt to the FastAPI `/sam3-litetext/segment` endpoint. Verification: run `cd ./examples && npm run build`, start Vite, open `/?route=sam3-litetext`, capture or select a plant photo, use prompt `tree or plant`, run segmentation, and confirm the page shows a mask/overlay when the backend returns one plus the original JSON output.

2026-04-22: Switched the segmentation test route from the Railway SAM3-LiteText endpoint to browser-side semantic segmentation. Configuration impact: `examples` now depends on `@huggingface/transformers`; the route reads `VITE_BROWSER_SEGMENTATION_MODEL`, `VITE_BROWSER_SEGMENTATION_DEVICE`, `VITE_BROWSER_SEGMENTATION_IMAGE_MAX_WIDTH`, `VITE_BROWSER_SEGMENTATION_IMAGE_JPEG_QUALITY`, `VITE_BROWSER_SEGMENTATION_THRESHOLD`, and `VITE_BROWSER_SEGMENTATION_MASK_THRESHOLD`; browser execution supports `webgpu` and `wasm`; and no SAM3 backend token is needed for this screen. Verification: run `cd ./examples && npm run build`, start Vite on HTTPS for phone testing, open `/?route=sam3-litetext`, capture or select a plant photo, use prompt `tree or plant`, tap `Run on device`, and confirm a browser-generated mask plus JSON output appears.

2026-04-22: Fixed the mobile browser segmentation fallback after WebGPU load or inference errors. Configuration impact: no env changes; `VITE_BROWSER_SEGMENTATION_DEVICE=auto` still tries WebGPU first on secure origins, then falls back to Transformers.js browser `wasm`, and `cpu` is treated as `wasm` for browser compatibility. Verification: run `cd ./examples && npm run build`, open the HTTPS LAN URL on iPhone Safari, select a plant photo, tap `Run on device`, and confirm the runtime no longer fails with `Unsupported device: "cpu"`.

2026-04-22: Moved the browser segmentation model files into the app so Transformers.js loads SegFormer from `/models/Xenova/segformer-b0-finetuned-ade-512-512` instead of probing `huggingface.co`. Configuration impact: the default route sets local model loading on, disables remote model loading, and adds optional `VITE_BROWSER_SEGMENTATION_LOCAL_MODEL_PATH` plus `VITE_BROWSER_SEGMENTATION_ALLOW_REMOTE_MODELS` for overrides. Verification: run `cd ./examples && npm run build`, serve the app over HTTPS, open `/?route=sam3-litetext`, tap `Run on device`, and confirm the browser Network tab shows model files loading from the app origin rather than Hugging Face.

2026-04-22: Fixed local model asset fallback for the browser segmentation route. Configuration impact: Vite dev/preview and the Express HTTPS server now return `404 Not found` for missing `/models/*` files instead of serving the React `index.html`, which lets Transformers.js ignore optional metadata such as tokenizer files cleanly. Verification: run `cd ./examples && npm run build`, start the HTTPS app, request `/models/Xenova/segformer-b0-finetuned-ade-512-512/tokenizer_config.json`, and confirm it returns 404 rather than HTML; then rerun `/?route=sam3-litetext`.

2026-04-22: Versioned the browser segmentation model cache to bypass stale Transformers.js entries created while missing model files returned React HTML. Configuration impact: the segmentation route now sets `env.cacheKey` to `web-ar-browser-segmentation-v2` by default, with `VITE_BROWSER_SEGMENTATION_CACHE_KEY` available for future cache busts. Verification: reload `/?route=sam3-litetext` after rebuilding, tap `Run on device`, and confirm it no longer fails with `Unexpected token '<', "<!doctype"... is not valid JSON`.

2026-04-22: Forced the browser segmentation pipeline dtype to `fp32` by default. Configuration impact: iPhone/Safari WASM fallback now requests the bundled `examples/public/models/Xenova/segformer-b0-finetuned-ade-512-512/onnx/model.onnx`; set `VITE_BROWSER_SEGMENTATION_DTYPE` only if you also provide the matching ONNX file such as `model_quantized.onnx`. Verification: run `cd ./examples && npm run build`, open the HTTPS LAN URL on iPhone, tap `Run on device`, and confirm it no longer reports that the ONNX file was not found locally.

2026-04-22: Disabled automatic WebGPU selection on iOS browsers for the browser segmentation route. Configuration impact: `VITE_BROWSER_SEGMENTATION_DEVICE=auto` now selects WASM on iPhone/iPad even when Safari reports `navigator.gpu`; desktop browsers can still auto-select WebGPU, and `VITE_BROWSER_SEGMENTATION_DEVICE=webgpu` still forces WebGPU for explicit testing. Verification: run `cd ./examples && npm run build`, open the HTTPS LAN URL on iPhone, tap `Run on device`, and confirm it no longer fails with `webgpuInit is not a function`.

2026-04-22: Added MediaPipe pinch-to-drag repositioning for the live AR character. Configuration impact: no server or env changes; the `Hand` mode now tracks one hand, keeps MediaPipe lazy-loaded, samples slowly when idle, and temporarily increases hand inference frequency while the thumb/index pinch is dragging the character head. Verification: run `cd ./examples && npm run build`, open the Vite URL with `?mode=ar`, place the character, tap `Hand`, pinch the character head with thumb and index finger, move the pinch, and release to leave the character at the new AR anchor.

2026-04-22: Added thumb-only hand occlusion for the live AR character. Configuration impact: no server or env changes; when MediaPipe `Hand` mode is enabled, the camera frame is composited back over the AR layer along the thumb landmarks only, making the thumb appear in front of the character while the index finger stays behind and still drives pinch dragging. Verification: run `cd ./examples && npm run build`, open `?mode=ar`, place the character, tap `Hand`, put the thumb over the character and the index finger behind it, then pinch and move to confirm the thumb covers the character while the pinch still repositions it.

2026-04-22: Added an animated white contact cue for hand pinches in the live AR camera. Configuration impact: no server or env changes; the `Hand` mode now draws a lightweight translucent canvas glow around active thumb/index pinches to smooth the visual edge where the thumb occlusion overlaps the character. Verification: run `cd ./examples && npm run build`, open `?mode=ar`, place the character, tap `Hand`, pinch over the character, and confirm a soft pulsing white contact cushion appears around the pinch while the character can still be dragged.

2026-04-22: Strengthened the live AR pinch contact cue for better visibility on mobile camera feeds. Configuration impact: no server or env changes; the canvas cue now uses a larger glow, stronger alpha, a thicker bridge between thumb and index, and a second outer ring while remaining tied to active pinch landmarks only. Verification: run `cd ./examples && npm run build`, open `?mode=ar`, tap `Hand`, pinch near the character, and confirm the contact cue is clearly visible without fully hiding the character.

2026-04-22: Polished the live AR pinch contact cue with a brighter soft-touch bubble. Configuration impact: no server or env changes; active pinches now render a stronger white center, subtle cyan edge glow, two-layer thumb/index bridge, and layered rings so the touch point remains visible on both bright and dark camera backgrounds. Verification: run `cd ./examples && npm run build`, open `?mode=ar`, tap `Hand`, pinch over the character, and confirm the cue is clearer and smoother while dragging.

2026-04-22: Replaced the live AR pinch trail with a glowing energy ball effect. Configuration impact: no server or env changes; thumb/index pinches now draw a canvas-only blurred additive orb with rotating yellow, cyan, pink, and green lobes plus a soft white center only while that pinch is actively dragging the character, and the previous movement trail renderer is no longer used. Verification: run `cd ./examples && npm run build`, open `?mode=ar`, tap `Hand`, pinch over the character, and confirm a faint multicolor energy ball appears at the pinch point without leaving a tail.

2026-04-22: Expanded live AR pinch dragging from the character head to the whole character image. Configuration impact: no server or env changes; thumb/index pinches now start a drag anywhere inside the visible character bounds with a small padding margin, and the energy ball was tightened into a rounder, fainter in-place orb so it does not read as a movement tail. Verification: run `cd ./examples && npm run build`, open `?mode=ar`, tap `Hand`, pinch the body, head, or lower part of the character, and confirm the character moves with a subtle orb but no tail.

2026-04-23: Added separate AR Jasmine sprite sheets for idle, sunlight, water, and AI-speaking states. Configuration impact: no server or env changes; the AR renderer now loads `ar-character-idle.png`, `ar-character-sunlight.png`, `ar-character-water.png`, and `ar-character-talking.png`, listens for the `archaractersprite` browser event, loops idle/talking, returns to idle after one-shot water or sunlight actions, and shows water/sun controls on the standalone AR route. Verification: run `cd ./examples && npm run build`, open the Vite URL with `?mode=ar`, place the character, tap the water and sun controls, then dispatch `window.dispatchEvent(new CustomEvent('archaractersprite', { detail: { state: 'talking' } }))` from the browser console and confirm each atlas plays.

2026-04-23: Swapped the AR Jasmine states to the newer sprite-sheet export and optimized the runtime copies for mobile WebGL. Configuration impact: no server or env changes; `01-companion_idle-sprite_sheet.png`, `02-speak-sprite_sheet.png`, `03-watered_react-sprite_sheet.png`, and `04-sunlight_react-sprite_sheet.png` now back the runtime `ar-character-idle.png`, `ar-character-talking.png`, `ar-character-water.png`, and `ar-character-sunlight.png` assets, with public copies resized to 2048x4096, and all four states use the 4x8 atlas layout with 30 frames. Verification: run `cd ./examples && npm run build`, open `?mode=ar`, place Jasmine, confirm idle loops without black face cutouts, then tap water and sunlight and trigger AI speaking to confirm each new sheet plays.

2026-04-23: Fixed the standalone AR route showing a black screen with no Start button. Configuration impact: no server or env changes; `/?mode=ar` now renders before auth bootstrap, and the CSS rule that hides auto-start background-camera overlays is scoped to `.camera-demo-bg`, so the standalone AR route can show its Start overlay and hand status while embedded prototype camera backgrounds stay chrome-free. Verification: run `cd ./examples && npm run build`, open `https://localhost:5174/?mode=ar`, and confirm the Start button is visible before camera permission.

2026-04-23: Fixed standalone AR controls being hidden behind iPhone, LINE, and Safari bottom browser chrome. Configuration impact: no server or env changes; `/?mode=ar` now measures the visual viewport, writes `--ar-browser-ui-bottom`, and offsets the placement circle, hand toggle, hand status, water button, and sunlight button above the browser bar. Verification: run `cd ./examples && npm run build`, open the ngrok AR URL on iPhone or LINE, tap Start, allow camera access, and confirm the circular placement button and AR controls sit above the bottom browser bar.

2026-04-23: Tightened prototype capture so non-plant photos do not open a plant result card. Configuration impact: capture now requires a meaningful browser segmentation mask using `VITE_BROWSER_SEGMENTATION_MIN_AREA_RATIO`, starts Railway tree analysis in parallel with that browser check, rejects backend responses such as `None Identified` or summaries describing a person/bed instead of a plant, and defaults tree upload compression to 896px at 0.72 JPEG quality. Verification: run `cd ./examples && npm run build`, open the app root, capture a non-plant subject and confirm it stays on the camera with `No plant or tree detected. Try again.`, then capture a real plant and confirm it advances to chat.

2026-04-23: Replaced hidden file-input camera shortcuts on the Tree analysis and browser segmentation screens with an in-preview live camera capture flow. Configuration impact: no new env vars; `Open camera` now requires the existing secure-origin camera requirements for `getUserMedia`, while `Select photo` remains the gallery/file-picker path. Verification: run `cd ./examples && npm run build`, open `https://localhost:5174/?route=sam3-litetext` or a LAN HTTPS URL, tap `Open camera`, allow permission, confirm the live preview appears, tap the shutter, then tap `Run on device` and confirm the captured frame is segmented.

2026-04-23: Enabled thinking mode by default for Tree analysis requests. Configuration impact: the frontend now sends `enable_thinking: true` unless `VITE_TREE_ANALYSIS_ENABLE_THINKING` explicitly overrides it, matching the Railway backend's Qwen web-tool pipeline and avoiding provider rejections from `web_extractor`. Verification: run `cd ./examples && npm run build`, restart Vite, capture or select a plant photo, and confirm the red `Model output did not contain a JSON object` overlay no longer appears from the thinking/tool mismatch.

2026-04-23: Swapped the identified-plant chat hero from the illustrated foliage scene to a live camera-backed AR-style background while keeping the bottom talk sheet. Configuration impact: no new env vars; successful prototype captures now start a lightweight camera background and render the bundled character sprite sheet directly in the chat hero, while care and TTS events still switch sprite animations. Verification: run `cd ./examples && npm run build`, open the app root, capture a valid plant, and confirm the plant result sheet appears over the live camera background with the existing sprite visible.

2026-04-23: Added two AR companion demo paths. Configuration impact: `Quick AR demo` uses existing bundled sprite sheets with no backend generation, while the full capture path calls the new FastAPI `/plant/avatar/companion/jobs` flow and reads optional `VITE_PLANT_COMPANION_JOBS_URL` plus the existing backend auth token. Dynamic generated sheets override the AlvaAR runtime through `archaracterspriteset`, support 60-frame `4 x 15` metadata, and the standalone AR route now includes ASR -> LLM reply -> TTS voice controls that drive the talking sprite. Verification: run `cd ./examples && npm run build`, open `?mode=ar` or `Quick AR demo` to confirm bundled idle/water/sunlight/talking still work, then run the full capture flow with the FastAPI and sprite-generator backends running and confirm generated `idle`, `talking`, `water`, and `sunlight` sheets play in AR.


## Usage

This code shows how to send image data to AlvaAR to compute the camera pose.

```javascript
import { AlvaAR } from 'alva_ar.js';

const videoOrWebcam = /*...*/;

const width = videoOrWebcam.width;
const height = videoOrWebcam.height;

const canvas = document.getElementById( 'canvas' );
const ctx = canvas.getContext( '2d' );

canvas.width = width;
canvas.height = height;

const alva = await AlvaAR.Initialize( width, height );

function loop()
{
    ctx.clearRect( 0, 0, width, height );
    ctx.drawImage( videoOrWebcam, 0, 0, width, height );
    
    const frame = ctx.getImageData( 0, 0, width, height );
    
    // cameraPose holds the rotation/translation information where the camera is estimated to be
    const cameraPose = alva.findCameraPose( frame );
    
    // planePose holds the rotation/translation information of a detected plane
    const planePose = alva.findPlane();
    
    // The tracked points in the frame
    const points = alva.getFramePoints();

    for( const p of points )
    {
        ctx.fillRect( p.x, p.y, 2, 2 );
    }
};
```


## Build

### Prerequisites

#### Emscripten
Ensure [Emscripten](https://emscripten.org/docs/getting_started/Tutorial.html) is installed and activated in your session.

```
    $: source [PATH]/emsdk/emsdk_env.sh 
    $: emcc -v
```

#### C++11 or Higher
Alva makes use of C++11 features and should thus be compiled with a C++11 or higher flag.

### Dependencies

| Dependency             | Description                                                                                                                                                                                                                                                                                                                                                                                                                         |
|------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Eigen3                 | Download Eigen 3.4. Find all releases [here](https://eigen.tuxfamily.org/index.php?title=Main_Page).This project has been tested with 3.4.0                                                                                                                                                                                                                                                                                         |
| OpenCV                 | Download OpenCV 4.5. Find all releases [here](https://opencv.org/releases/).This project has been tested with [4.5.5](https://github.com/opencv/opencv/archive/4.5.5.zip).                                                                                                                                                                                                                                                          |
| iBoW-LCD               | A modified version of [iBoW-LCD](https://github.com/emiliofidalgo/ibow-lcd) is included in the libs folder. It has been turned into a static shared lib. Same goes for [OBIndex2](https://github.com/emiliofidalgo/obindex2), the required dependency for iBoW-LCD. Check the lcdetector.h and lcdetector.cc files to see the modifications w.r.t. to the original code. Both CMakeList have been adjusted to work with Emscripten. |
| Sophus                 | [Sophus](https://github.com/strasdat/Sophus) is used for _*SE(3), SO(3)*_ elements representation.                                                                                                                                                                                                                                                                                                                                  |
| Ceres Solver           | [Ceres](https://github.com/ceres-solver/ceres-solver) is used for optimization related operations such as PnP, Bundle Adjustment or PoseGraph Optimization. Note that [Ceres dependencies](http://ceres-solver.org/installation.html) are still required.                                                                                                                                                                           |
| OpenGV                 | [OpenGV](https://github.com/laurentkneip/opengv) is used for Multi-View-Geometry (MVG) operations.                                                                                                                                                                                                                                                                                                                                  |

#### Build Dependencies
For convenience, a copy of all required libraries has been included in the libs/ folder. Run the following script to compile all libraries to wasm modules which can be linked into the main project.

```
    $: cd ./AlvaAR/src/libs/
    $: ./build.sh
```

#### Build Project

Run the following in your shell before invoking emcmake or emmake:

```
    $: [PATH]/emsdk/emsdk_env.sh
```

Then, run the following:

```
    $: cd ./AlvaAR/src/slam
    $: mkdir build/
    $: cd build/
    $: emcmake cmake .. 
    $: emmake make install
```


## Roadmap
- [ ] Improve the initialisation phase to be more stable and predictable.
- [ ] Move feature extraction and tracking to GPU.
- [ ] Blend visual SLAM with IMU data to increase robustness. 


## License

AlvaAR is released under the [GPLv3 license](https://www.gnu.org/licenses/gpl-3.0.txt).  

OV²SLAM and ORB-SLAM2 are both released under the [GPLv3 license](https://www.gnu.org/licenses/gpl-3.0.txt). Please see 3rd party dependency licenses in libs/.


## Contact

Alan Ross: [@alan_ross](https://twitter.com/alan_ross) or [me@aross.io]()  
Project: [https://github.com/alanross/AlvaAR](https://github.com/alanross/AlvaAR)
