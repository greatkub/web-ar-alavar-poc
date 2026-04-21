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

Then open the local URL printed by Vite, usually [http://localhost:5174/](http://localhost:5174/) or [https://localhost:5174/](https://localhost:5174/) when `examples/ssl/` certificates exist. The page should show the GreenCredit clickable prototype with the Home, Jasmine, AR capture, chat, and Store screens. The video smoke test remains available at `/video.html` on the same origin.

The live React camera demo is still available at `/?mode=ar` on the same origin. It requests camera permission and renders `examples/public/assets/demo-character-sprite.png` as a looping sprite-sheet AR overlay once tracking has a camera pose. The demo automatically looks for the plant base by finding a narrow stem-like column with dark soil below it, then locks the character into SLAM world space so it does not simply slide with the camera. It also includes a lightweight leaf-colored occlusion layer that redraws green foreground pixels above the AR overlay so nearby leaves can visually cover the character. Tap directly on the camera view to create a one-shot locked anchor at that screen position; the demo then tracks the tapped visual patch and continuously corrects the anchor to reduce visible drift. The bottom-center circular placement button still anchors at the button position. The camera demo can load MediaPipe Hands after tapping the `Hand` button to prototype hand interactions: rubbing the character head, scooping/lifting with an open palm, and pinching/pulling a cheek. Those interactions emit a `characterinteraction` browser event so another image or animation layer can reuse the same action state later.

For phone camera testing on the local network, use the HTTPS Vite URL, such as [https://192.168.1.199:5174/](https://192.168.1.199:5174/). Mobile Safari does not expose `navigator.mediaDevices.getUserMedia` on plain HTTP LAN addresses. If you use the generated self-signed certificate, Safari will show a certificate warning that must be accepted before camera permission can appear.

The GreenCredit prototype uses existing static assets from `examples/public/assets/` for the Jasmine character and CSS-drawn foliage/camera scenes for the mocked plant views. The live camera mode imports the existing AlvaAR browser modules, and the video demo and AR view import ThreeJS modules from `threejsfundamentals.org`, so keep an internet connection available for those checks.

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
