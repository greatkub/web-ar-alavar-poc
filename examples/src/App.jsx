import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRealtimeAsrSession } from './asr/realtimeAsr.js';
import { useMicrophone } from './microphone/index.js';
import { createVoiceReplySession, prepareVoiceReplyAudio } from './voiceReply.js';
import { isSupabaseConfigured, supabase } from './supabase.js';
import { SignInScreen } from './SignInScreen.jsx';
import { analyzeTreePhoto, fetchPlantAvatarPrompt } from './treeAnalysis.js';
import { initializeCameraDemo } from './cameraDemo.js';
import { Stats } from '../public/assets/stats.js';
import {
    analyzeSam3LiteTextPhoto,
    drawSam3LiteTextMasks,
    getSam3LiteTextOverlayUrl,
    getOnDeviceSegmentationStatus,
    summarizeSam3LiteTextOutput
} from './sam3LiteText.js';

const SAM3_ROUTE = 'sam3-litetext';
const AR_CHARACTER_SPRITE_EVENT = 'archaractersprite';
const CAPTURE_IMAGE_MAX_WIDTH = 1280;
const CAPTURE_BUSY_STATUSES = new Set(['validating', 'analyzing', 'fetching']);
const CAPTURE_STEPS = ['validating', 'analyzing', 'fetching'];
const CAPTURE_STATUS_LABELS = {
    validating: 'Checking plant',
    analyzing: 'Identifying plant',
    fetching: 'Preparing'
};
const NON_PLANT_CAPTURE_ERROR = 'No plant or tree detected. Try again.';

function setArCharacterSprite(state) {
    window.dispatchEvent(new CustomEvent(AR_CHARACTER_SPRITE_EVENT, {
        detail: { state }
    }));
}

function stopMediaStream(stream) {
    stream?.getTracks().forEach((track) => track.stop());
}

function cameraAccessErrorMessage(error) {
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
        return 'Camera requires HTTPS or localhost. Open the app from a secure origin and try again.';
    }

    if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') {
        return 'Camera access denied. Please allow camera permission and try again.';
    }

    if (error?.name === 'NotFoundError' || error?.name === 'OverconstrainedError') {
        return 'No camera found on this device.';
    }

    if (error?.name === 'NotReadableError') {
        return 'Camera is busy in another app or tab.';
    }

    return 'Could not open camera. Check browser camera permissions and try again.';
}

function captureFrameFile(video) {
    if (!video.videoWidth || !video.videoHeight || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        return Promise.reject(new Error('Camera is still starting. Try again in a moment.'));
    }

    const sourceWidth = video.videoWidth;
    const sourceHeight = video.videoHeight;
    const scale = Math.min(1, CAPTURE_IMAGE_MAX_WIDTH / sourceWidth);
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');

    if (!context) {
        return Promise.reject(new Error('Could not prepare camera frame. Try again.'));
    }

    canvas.width = width;
    canvas.height = height;
    context.drawImage(video, 0, 0, width, height);

    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (!blob) {
                reject(new Error('Could not capture photo. Try again.'));
                return;
            }

            resolve(new File([blob], 'capture.jpg', { type: 'image/jpeg' }));
        }, 'image/jpeg', 0.82);
    });
}

function useLivePhotoCapture(onCapture) {
    const videoRef = useRef(null);
    const streamRef = useRef(null);
    const mountedRef = useRef(true);
    const [cameraActive, setCameraActive] = useState(false);
    const [cameraStarting, setCameraStarting] = useState(false);
    const [cameraCapturing, setCameraCapturing] = useState(false);
    const [cameraError, setCameraError] = useState('');

    const teardownCamera = useCallback(() => {
        stopMediaStream(streamRef.current);
        streamRef.current = null;

        if (videoRef.current) {
            videoRef.current.srcObject = null;
        }
    }, []);

    const stopCamera = useCallback(() => {
        teardownCamera();
        setCameraActive(false);
        setCameraStarting(false);
        setCameraCapturing(false);
    }, [teardownCamera]);

    useEffect(() => () => {
        mountedRef.current = false;
        teardownCamera();
    }, [teardownCamera]);

    useEffect(() => {
        const video = videoRef.current;

        if (!cameraActive || !video || !streamRef.current) {
            return;
        }

        video.srcObject = streamRef.current;
        video.play().catch(() => {
            if (!mountedRef.current) {
                return;
            }

            setCameraError('Camera opened, but playback did not start. Tap Open camera again.');
            stopCamera();
        });
    }, [cameraActive, stopCamera]);

    const openCamera = useCallback(async () => {
        setCameraError('');

        if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
            setCameraError(cameraAccessErrorMessage());
            return;
        }

        setCameraStarting(true);
        stopMediaStream(streamRef.current);
        streamRef.current = null;

        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: { ideal: 'environment' },
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                },
                audio: false
            });

            if (!mountedRef.current) {
                stopMediaStream(stream);
                return;
            }

            streamRef.current = stream;
            setCameraActive(true);
        } catch (error) {
            stopMediaStream(streamRef.current);
            streamRef.current = null;

            if (mountedRef.current) {
                setCameraActive(false);
                setCameraError(cameraAccessErrorMessage(error));
            }
        } finally {
            if (mountedRef.current) {
                setCameraStarting(false);
            }
        }
    }, []);

    const captureCamera = useCallback(async () => {
        const video = videoRef.current;

        if (!video || cameraCapturing) {
            return;
        }

        setCameraCapturing(true);
        setCameraError('');

        try {
            const file = await captureFrameFile(video);
            onCapture(file);
            stopCamera();
        } catch (error) {
            if (mountedRef.current) {
                setCameraError(error instanceof Error ? error.message : 'Could not capture photo. Try again.');
                setCameraCapturing(false);
            }
        }
    }, [cameraCapturing, onCapture, stopCamera]);

    const clearCameraError = useCallback(() => setCameraError(''), []);

    return {
        cameraActive,
        cameraStarting,
        cameraCapturing,
        cameraError,
        clearCameraError,
        openCamera,
        captureCamera,
        stopCamera,
        videoRef
    };
}

function withOutcome(promise) {
    return promise.then(
        (value) => ({ value }),
        (error) => ({ error })
    );
}

function analysisText(treeResult) {
    return [
        treeResult?.tree_name,
        treeResult?.tree_species,
        treeResult?.plant_name,
        treeResult?.common_name,
        treeResult?.image_summary,
        treeResult?.summary,
        treeResult?.description,
        treeResult?.notes
    ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
}

function isPlantAnalysisResult(treeResult) {
    const name = String(
        treeResult?.tree_name ||
        treeResult?.tree_species ||
        treeResult?.plant_name ||
        treeResult?.common_name ||
        ''
    ).trim().toLowerCase();
    const text = analysisText(treeResult);

    if (!name) {
        return false;
    }

    if (/\b(none|unknown|unidentified|not identified|not applicable|n\/a)\b/.test(name)) {
        return false;
    }

    if (
        /\b(no|not|without)\s+(visible\s+)?(plant|tree|vegetation|foliage)\b/.test(text) ||
        /\brather than (a\s+)?(plant|tree)\b/.test(text)
    ) {
        return false;
    }

    const hasPlantCue = /\b(plant|tree|vegetation|foliage|leaf|leaves|flower|shrub|grass|palm|jasmine|lily|monstera)\b/.test(text);
    const hasNonPlantSubject = /\b(person|human|face|selfie|bed|pillow|bedding)\b/.test(text);

    return !hasNonPlantSubject || hasPlantCue;
}

async function fetchAvatarPromptBriefly(treeResult) {
    try {
        return await fetchPlantAvatarPrompt(treeResult);
    } catch {
        return null;
    }
}

function currentBrowserRoute() {
    const cleanPath = window.location.pathname.replace(/\/+$/, '');

    if (cleanPath.endsWith(`/${SAM3_ROUTE}`)) {
        return SAM3_ROUTE;
    }

    const params = new URLSearchParams(window.location.search);
    const mode = params.get('mode');

    if (mode === 'ar') {
        return 'ar';
    }

    if (mode === SAM3_ROUTE) {
        return SAM3_ROUTE;
    }

    return params.get('route') || '';
}

function ScreenTransition({ direction, screenKey, suppressAnimation, children }) {
    const suppress = suppressAnimation ? ' screen-transition--suppress' : '';
    return (
        <div
            key={screenKey}
            className={`screen-transition screen-transition--${direction}${suppress}`}
        >
            {children}
        </div>
    );
}

const ASSETS = {
    character: '/assets/demo-marker.png'
};

const PLANTS = [
    {
        name: 'Jasmine',
        latin: 'Jasminum',
        intro: 'Native plants help increase green spaces and absorb carbon.',
        care: 'Moderate',
        carbon: 45,
        image: ASSETS.character
    },
    {
        name: 'Peace Lily',
        latin: 'Spathiphyllum',
        intro: 'Shade-loving foliage that thrives indoors with steady moisture.',
        care: 'Easy',
        carbon: 32,
        image: ASSETS.character
    },
    {
        name: 'Snake Plant',
        latin: 'Dracaena trifasciata',
        intro: 'Drought-tolerant succulents ideal for busy plant parents.',
        care: 'Low',
        carbon: 28,
        image: ASSETS.character
    },
    {
        name: 'Monstera',
        latin: 'Monstera deliciosa',
        intro: 'Split leaves bring tropical drama while filtering indoor air.',
        care: 'Moderate',
        carbon: 52,
        image: ASSETS.character
    }
];

const CREDITS = '1,240';
const LOCAL_DEMO_SESSION = {
    user: {
        email: 'Local demo'
    }
};

function useAuth() {
    const [session, setSession] = useState(undefined);

    useEffect(() => {
        if (!isSupabaseConfigured) {
            setSession(LOCAL_DEMO_SESSION);
            return undefined;
        }

        supabase.auth.getSession().then(({ data }) => {
            setSession(data.session ?? null);
        });

        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
            setSession(newSession ?? null);
        });

        return () => subscription.unsubscribe();
    }, []);

    return session;
}

function App() {
    const session = useAuth();
    const [browserRoute, setBrowserRoute] = useState(currentBrowserRoute);

    useEffect(() => {
        const handlePopState = () => setBrowserRoute(currentBrowserRoute());
        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, []);

    const openBrowserRoute = useCallback((route) => {
        const url = new URL(window.location.href);
        url.searchParams.delete('mode');

        if (route) {
            url.searchParams.set('route', route);
        } else {
            url.searchParams.delete('route');
            url.pathname = url.pathname.replace(new RegExp(`/${SAM3_ROUTE}/?$`), '') || '/';
        }

        window.history.pushState({}, '', url);
        setBrowserRoute(currentBrowserRoute());
    }, []);

    if (browserRoute === 'ar') {
        return <LiveCameraDemo />;
    }

    if (session === undefined) {
        return (
            <div className="signin-loading">
                <span className="signin-loading-dot" />
            </div>
        );
    }

    if (!session) {
        return <SignInScreen />;
    }

    if (browserRoute === SAM3_ROUTE) {
        return <Sam3LiteTextScreen onBack={() => openBrowserRoute('')} />;
    }

    return <GreenCreditPrototype session={session} onOpenSam3LiteText={() => openBrowserRoute(SAM3_ROUTE)} />;
}

function LiveCameraDemo() {
    useEffect(() => {
        let mounted = true;
        const updateViewportInsets = () => {
            const viewport = window.visualViewport;
            const bottomInset = viewport
                ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
                : 0;

            document.documentElement.style.setProperty('--ar-browser-ui-bottom', `${Math.ceil(bottomInset)}px`);
        };

        updateViewportInsets();
        window.addEventListener('resize', updateViewportInsets);
        window.visualViewport?.addEventListener('resize', updateViewportInsets);
        window.visualViewport?.addEventListener('scroll', updateViewportInsets);
        import('./cameraDemo.js').then(({ initializeCameraDemo }) => {
            if (mounted) {
                initializeCameraDemo();
                Stats.el?.remove();
            }
        });

        return () => {
            mounted = false;
            window.removeEventListener('resize', updateViewportInsets);
            window.visualViewport?.removeEventListener('resize', updateViewportInsets);
            window.visualViewport?.removeEventListener('scroll', updateViewportInsets);
            document.documentElement.style.removeProperty('--ar-browser-ui-bottom');
            Stats.el?.remove();
        };
    }, []);

    return (
        <main className="camera-app">
            <div id="container"></div>
            <button id="place_image_button" type="button" aria-label="Place image marker" title="Place image marker" hidden></button>
            <button id="hand_toggle_button" type="button" aria-label="Enable hand interactions" aria-pressed="false" hidden>Hand</button>
            <div className="care-actions ar-care-actions" aria-label="AR care actions">
                <button type="button" className="care-action water" aria-label="Water Jasmine" onClick={() => setArCharacterSprite('water')}></button>
                <button type="button" className="care-action sun" aria-label="Give sunlight" onClick={() => setArCharacterSprite('sunlight')}></button>
            </div>
            <div id="gesture_status" data-action="hand_off">
                <strong>Hand</strong>
                <span>Hand off</span>
            </div>
            <div id="overlay">
                <button id="start_button" type="button">Start</button>
                <div id="splash"></div>
            </div>
        </main>
    );
}

function GreenCreditPrototype({ session, onOpenSam3LiteText }) {
    const handleSignOut = useCallback(async () => {
        if (!isSupabaseConfigured) {
            return;
        }

        await supabase.auth.signOut();
    }, []);
    const [activeScreen, setActiveScreen] = useState('home');
    const [navDirection, setNavDirection] = useState('forward');
    const [hasNavigated, setHasNavigated] = useState(false);
    const [chatState, setChatState] = useState('intro');
    const [captureReturnScreen, setCaptureReturnScreen] = useState('detail');
    const [chatBackScreen, setChatBackScreen] = useState('detail');
    const [chatEnterSlideUp, setChatEnterSlideUp] = useState(false);
    const [captureAnalysisResult, setCaptureAnalysisResult] = useState(null);

    const navigate = useCallback((screen, direction) => {
        setHasNavigated(true);
        setNavDirection(direction);
        setActiveScreen(screen);
    }, []);

    const goChat = (state = 'intro', backScreen = 'detail', { slideUpPanel = false } = {}) => {
        setChatBackScreen(backScreen);
        setChatState(state);
        setChatEnterSlideUp(slideUpPanel);
        navigate('chat', 'forward');
    };

    const suppressEnterAnimation = !hasNavigated && activeScreen === 'home';

    let body;
    if (activeScreen === 'detail') {
        body = (
            <PlantDetailScreen
                onBack={() => navigate('home', 'back')}
                onCapture={() => {
                    setCaptureReturnScreen('detail');
                    navigate('capture', 'forward');
                }}
                onTalk={() => goChat('intro', 'detail')}
            />
        );
    } else if (activeScreen === 'capture') {
        body = (
            <CaptureScreen
                onBack={() => navigate(captureReturnScreen, 'back')}
                onCapture={(result) => {
                    setCaptureAnalysisResult(result);
                    goChat('intro', 'capture', { slideUpPanel: true });
                }}
            />
        );
    } else if (activeScreen === 'chat') {
        body = (
            <ChatScreen
                chatState={chatState}
                setChatState={setChatState}
                onBack={() => navigate(chatBackScreen, 'back')}
                slideUpPanel={chatEnterSlideUp}
                analysisResult={captureAnalysisResult}
            />
        );
    } else if (activeScreen === 'store') {
        body = <StoreScreen onBack={() => navigate('home', 'back')} />;
    } else if (activeScreen === 'treeAnalysis') {
        body = <TreeAnalysisScreen onBack={() => navigate('home', 'back')} />;
    } else if (activeScreen === 'about' || activeScreen === 'makers') {
        body = <InfoScreen type={activeScreen} onBack={() => navigate('home', 'back')} />;
    } else {
        body = (
            <HomeScreen
                onOpenDetail={() => navigate('detail', 'forward')}
                onOpenStore={() => navigate('store', 'forward')}
                onOpenInfo={(screen) => navigate(screen, 'forward')}
                onOpenTreeAnalysis={() => navigate('treeAnalysis', 'forward')}
                onOpenSam3LiteText={onOpenSam3LiteText}
                onOpenCapture={() => {
                    setCaptureReturnScreen('home');
                    navigate('capture', 'forward');
                }}
                onTestAvatar={async () => {
                    const fixedTreeResult = { tree_name: 'Jasmine', carbon_credit_estimate: 45 };
                    const avatarPrompt = await fetchPlantAvatarPrompt(fixedTreeResult).catch(() => null);
                    setCaptureAnalysisResult({ ...fixedTreeResult, avatarPrompt });
                    goChat('intro', 'home', { slideUpPanel: true });
                }}
                userEmail={session?.user?.email}
                onSignOut={handleSignOut}
                canSignOut={isSupabaseConfigured}
            />
        );
    }

    return (
        <ScreenTransition
            direction={navDirection}
            screenKey={activeScreen}
            suppressAnimation={suppressEnterAnimation}
        >
            {body}
        </ScreenTransition>
    );
}

function HomeScreen({ onOpenDetail, onOpenStore, onOpenInfo, onOpenTreeAnalysis, onOpenSam3LiteText, onOpenCapture, onTestAvatar, userEmail, onSignOut, canSignOut }) {
    const [testingAvatar, setTestingAvatar] = useState(false);

    const handleTestAvatar = async () => {
        if (testingAvatar) return;
        setTestingAvatar(true);
        try {
            await onTestAvatar();
        } finally {
            setTestingAvatar(false);
        }
    };

    return (
        <main className="prototype-shell home-screen">
            <section className="home-content">
                <h1>GreenCredit</h1>
                <div className="home-menu" aria-label="GreenCredit menu">
                    <MenuCard title="Discover" caption="Befriend and interact with plants" onClick={onOpenCapture} />
                    <MenuCard title="Greenhouse" caption="See the collections of your plants" onClick={onOpenDetail} />
                    <MenuCard title="Store" caption="Earn credits and shop sustainably" onClick={onOpenStore} />
                </div>
                <nav className="home-links" aria-label="More information">
                    <button type="button" onClick={onOpenTreeAnalysis}>Tree image analysis</button>
                    <button type="button" onClick={onOpenSam3LiteText}>SAM3-LiteText test</button>
                    <button type="button" onClick={() => onOpenInfo('about')}>About the app</button>
                    <button type="button" onClick={() => onOpenInfo('makers')}>Meet the makers</button>
                    <button type="button" onClick={onOpenCapture}>
                        Live AR camera
                    </button>
                    <button type="button" onClick={handleTestAvatar} disabled={testingAvatar}>
                        {testingAvatar ? 'Loading avatar…' : 'Test avatar prompt'}
                    </button>
                </nav>
                <div className="home-signout">
                    {userEmail && <span className="home-signout-email">{userEmail}</span>}
                    {canSignOut && (
                        <button type="button" className="home-signout-btn" onClick={onSignOut}>
                            Sign out
                        </button>
                    )}
                </div>
            </section>
        </main>
    );
}

function MenuCard({ title, caption, onClick }) {
    return (
        <button type="button" className="menu-card" onClick={onClick}>
            <span>
                <strong>{title}</strong>
                <small>{caption}</small>
            </span>
            <span className="menu-plant" aria-hidden="true"></span>
        </button>
    );
}

function PlantDetailScreen({ onBack, onCapture, onTalk }) {
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [contentPhase, setContentPhase] = useState('enter');
    const plant = PLANTS[selectedIndex];

    const handleSelectPlant = (index) => {
        if (index === selectedIndex) {
            return;
        }
        setContentPhase('swap');
        setSelectedIndex(index);
    };

    return (
        <main className="prototype-shell detail-screen" data-content-phase={contentPhase}>
            <BackButton onClick={onBack} />
            <section
                id="plant-detail-panel"
                key={`plant-copy-${selectedIndex}`}
                className="plant-copy"
                aria-live="polite"
                aria-atomic="true"
            >
                <h1>{plant.name}</h1>
                <p className="latin-name">{plant.latin}</p>
                <p className="plant-intro">{plant.intro}</p>
                <Pill label={plant.care} />
                <div className="carbon-card">
                    <span>Carbon Absorbed</span>
                    <strong>{plant.carbon}</strong>
                    <small>kg CO2e</small>
                </div>
            </section>
            <button
                key={`plant-portrait-${selectedIndex}`}
                type="button"
                className="plant-portrait"
                onClick={onCapture}
                aria-label={`Open AR capture for ${plant.name}`}
            >
                <img src={plant.image} alt={`${plant.name} character`} />
            </button>
            <div className="plant-carousel" aria-label="Plant collection">
                {PLANTS.map((item, index) => (
                    <button
                        key={item.name}
                        type="button"
                        aria-current={index === selectedIndex ? 'true' : undefined}
                        className={index === selectedIndex ? 'active' : ''}
                        onClick={() => handleSelectPlant(index)}
                        aria-label={`${item.name} — ${index === selectedIndex ? 'selected' : 'show details'}`}
                    >
                        <img src={item.image} alt="" />
                    </button>
                ))}
            </div>
        </main>
    );
}

function CaptureScreen({ onBack, onCapture }) {
    const videoRef = useRef(null);
    const streamRef = useRef(null);
    const [status, setStatus] = useState('idle');
    const [error, setError] = useState('');

    useEffect(() => {
        let cancelled = false;

        navigator.mediaDevices
            .getUserMedia({ video: { facingMode: 'environment' } })
            .then((stream) => {
                if (cancelled) {
                    stream.getTracks().forEach((t) => t.stop());
                    return;
                }
                streamRef.current = stream;
                if (videoRef.current) {
                    videoRef.current.srcObject = stream;
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setError('Camera access denied. Please allow camera permission and try again.');
                    setStatus('error');
                }
            });

        return () => {
            cancelled = true;
            streamRef.current?.getTracks().forEach((t) => t.stop());
            streamRef.current = null;
        };
    }, []);

    const handleCapture = async () => {
        const video = videoRef.current;
        if (!video || CAPTURE_BUSY_STATUSES.has(status)) {
            return;
        }

        setError('');
        let analysisController = null;

        try {
            const file = await captureFrameFile(video);
            analysisController = new AbortController();

            setStatus('validating');
            const analysisPromise = withOutcome(analyzeTreePhoto(file, { signal: analysisController.signal }));
            const segmentation = await analyzeSam3LiteTextPhoto(file, { text: 'tree or plant' });

            if (!segmentation.result.has_objects) {
                analysisController.abort();
                setError(NON_PLANT_CAPTURE_ERROR);
                setStatus('error');
                return;
            }

            setStatus('analyzing');
            const analysisOutcome = await analysisPromise;

            if (analysisOutcome.error) {
                throw analysisOutcome.error;
            }

            if (!isPlantAnalysisResult(analysisOutcome.value.result)) {
                setError(NON_PLANT_CAPTURE_ERROR);
                setStatus('error');
                return;
            }

            setStatus('fetching');
            const avatarPrompt = await fetchAvatarPromptBriefly(analysisOutcome.value.result);

            onCapture({ ...analysisOutcome.value.result, avatarPrompt });
        } catch (captureError) {
            analysisController?.abort();
            setError(captureError instanceof Error ? captureError.message : 'Analysis failed. Please try again.');
            setStatus('error');
        }
    };

    const busy = CAPTURE_BUSY_STATUSES.has(status);
    const statusLabel = CAPTURE_STATUS_LABELS[status] || '';
    const activeStepIndex = CAPTURE_STEPS.indexOf(status);

    return (
        <main className="capture-screen">
            <video
                ref={videoRef}
                className="capture-video"
                autoPlay
                playsInline
                muted
            />
            <BackButton onClick={onBack} light />
            {busy && (
                <div className="capture-status" role="status" aria-live="polite">
                    <div className="capture-status-panel">
                        <span className="tree-loading-spinner"></span>
                        <span>{statusLabel}</span>
                        <div className="capture-progress-dots" aria-hidden="true">
                            {CAPTURE_STEPS.map((step, index) => (
                                <span
                                    key={step}
                                    className={index <= activeStepIndex ? 'active' : ''}
                                ></span>
                            ))}
                        </div>
                    </div>
                </div>
            )}
            {error && (
                <div className="capture-error" role="alert">
                    {error}
                </div>
            )}
            <button
                type="button"
                className="capture-control"
                aria-label="Capture plant"
                onClick={handleCapture}
                disabled={busy}
            ></button>
        </main>
    );
}

function TreeAnalysisScreen({ onBack }) {
    const galleryInputRef = useRef(null);
    const controllerRef = useRef(null);
    const [previewUrl, setPreviewUrl] = useState('');
    const [result, setResult] = useState(null);
    const [imageMeta, setImageMeta] = useState(null);
    const [lastFile, setLastFile] = useState(null);
    const [status, setStatus] = useState('idle');
    const [error, setError] = useState('');

    useEffect(() => () => {
        controllerRef.current?.abort();
    }, []);

    useEffect(() => () => {
        if (previewUrl) {
            URL.revokeObjectURL(previewUrl);
        }
    }, [previewUrl]);

    const startAnalysis = useCallback(async (file) => {
        if (!file) {
            return;
        }

        if (!file.type.startsWith('image/')) {
            setError('Choose an image file to analyze.');
            setStatus('error');
            return;
        }

        controllerRef.current?.abort();
        const controller = new AbortController();
        controllerRef.current = controller;

        const nextPreviewUrl = URL.createObjectURL(file);
        setPreviewUrl(nextPreviewUrl);
        setLastFile(file);
        setResult(null);
        setImageMeta(null);
        setError('');
        setStatus('loading');

        try {
            const analysis = await analyzeTreePhoto(file, { signal: controller.signal });
            setResult(analysis.result);
            setImageMeta(analysis.image);
            setStatus('done');
        } catch (analysisError) {
            if (analysisError?.name === 'AbortError') {
                return;
            }

            setError(analysisError instanceof Error ? analysisError.message : 'Tree analysis failed.');
            setStatus('error');
        } finally {
            if (controllerRef.current === controller) {
                controllerRef.current = null;
            }
        }
    }, []);

    const livePhoto = useLivePhotoCapture(startAnalysis);

    const handleFileChange = (event) => {
        const [file] = event.target.files || [];
        event.target.value = '';
        livePhoto.clearCameraError();
        startAnalysis(file);
    };

    const openGallery = () => galleryInputRef.current?.click();
    const retry = () => startAnalysis(lastFile);
    const loading = status === 'loading';
    const cameraVisible = livePhoto.cameraActive || livePhoto.cameraStarting;
    const displayError = error || livePhoto.cameraError;

    return (
        <main className="prototype-shell tree-analysis-screen">
            <BackButton onClick={onBack} />
            <section className="tree-analysis-header">
                <span className="plant-pill">
                    <span className="leaf-icon"></span>
                    Carbon valuation
                </span>
                <h1>Tree Scan</h1>
            </section>
            <section className="tree-capture-panel">
                <div className={`tree-photo-preview${previewUrl ? ' has-image' : ''}${cameraVisible ? ' is-camera-active' : ''}`}>
                    {cameraVisible ? (
                        <>
                            <video
                                ref={livePhoto.videoRef}
                                className="tree-live-camera"
                                autoPlay
                                playsInline
                                muted
                            />
                            <CameraCaptureControls
                                onCapture={livePhoto.captureCamera}
                                onClose={livePhoto.stopCamera}
                                disabled={livePhoto.cameraStarting || livePhoto.cameraCapturing}
                            />
                        </>
                    ) : previewUrl ? (
                        <img src={previewUrl} alt="Selected tree preview" />
                    ) : (
                        <span className="tree-photo-placeholder" aria-hidden="true"></span>
                    )}
                    {loading && (
                        <div className="tree-loading" role="status" aria-live="polite">
                            <span className="tree-loading-spinner"></span>
                            <strong>Analyzing tree...</strong>
                        </div>
                    )}
                    {livePhoto.cameraStarting && (
                        <div className="tree-loading" role="status" aria-live="polite">
                            <span className="tree-loading-spinner"></span>
                            <strong>Opening camera...</strong>
                        </div>
                    )}
                </div>
                <input
                    ref={galleryInputRef}
                    type="file"
                    accept="image/*"
                    className="tree-file-input"
                    onChange={handleFileChange}
                />
                <div className="tree-capture-actions">
                    <button
                        type="button"
                        className="tree-action-button tree-action-button--primary"
                        onClick={() => {
                            setError('');
                            livePhoto.openCamera();
                        }}
                        disabled={loading || cameraVisible}
                    >
                        <span className="tree-action-icon tree-action-icon--camera" aria-hidden="true"></span>
                        Open camera
                    </button>
                    <button type="button" className="tree-action-button" onClick={openGallery} disabled={loading || cameraVisible}>
                        <span className="tree-action-icon tree-action-icon--gallery" aria-hidden="true"></span>
                        Select photo
                    </button>
                </div>
                {imageMeta && (
                    <p className="tree-image-meta">
                        Uploaded {imageMeta.width}x{imageMeta.height} JPEG, {formatBytes(imageMeta.compressedBytes)}
                    </p>
                )}
            </section>
            {displayError && (
                <section className="tree-error" role="alert">
                    <strong>{livePhoto.cameraError && !error ? 'Camera unavailable' : 'Analysis failed'}</strong>
                    <p>{displayError}</p>
                    {lastFile && (
                        <button type="button" className="tree-retry-button" onClick={retry}>
                            Retry analysis
                        </button>
                    )}
                </section>
            )}
            {result && (
                <TreeAnalysisResult result={result} />
            )}
        </main>
    );
}

function TreeAnalysisResult({ result }) {
    const valuation = result.carbon_valuation || {};
    const fields = [
        ['Tree name', result.tree_name],
        ['Species', result.tree_species],
        ['Confidence', formatConfidence(result.confidence)],
        ['Initial carbon estimate', formatCurrency(result.carbon_credit_estimate)],
        ['Refined carbon estimate', formatCurrency(valuation.refined_estimate)],
        ['Uncertainty range', valuation.uncertainty_range],
        ['Image summary', result.image_summary, 'wide'],
        ['Methodology', valuation.methodology_notes, 'wide'],
        ['Notes/caveats', result.notes, 'wide']
    ];

    return (
        <section className="tree-results" aria-live="polite">
            <h2>Analysis result</h2>
            <div className="tree-result-grid">
                {fields.map(([label, value, variant]) => (
                    <div key={label} className={`tree-result-field${variant === 'wide' ? ' tree-result-field--wide' : ''}`}>
                        <span>{label}</span>
                        <strong>{displayValue(value)}</strong>
                    </div>
                ))}
            </div>
        </section>
    );
}

function CameraCaptureControls({ onCapture, onClose, disabled }) {
    return (
        <div className="tree-camera-controls">
            <button
                type="button"
                className="tree-camera-cancel"
                aria-label="Close camera"
                onClick={onClose}
                disabled={disabled}
            ></button>
            <button
                type="button"
                className="tree-camera-capture"
                aria-label="Capture photo"
                onClick={onCapture}
                disabled={disabled}
            ></button>
        </div>
    );
}

function Sam3LiteTextScreen({ onBack }) {
    const galleryInputRef = useRef(null);
    const controllerRef = useRef(null);
    const runtimeInfo = useMemo(() => getOnDeviceSegmentationStatus(), []);
    const [prompt, setPrompt] = useState('tree or plant');
    const [threshold, setThreshold] = useState(0.5);
    const [maskThreshold, setMaskThreshold] = useState(0.5);
    const [previewUrl, setPreviewUrl] = useState('');
    const [result, setResult] = useState(null);
    const [imageMeta, setImageMeta] = useState(null);
    const [lastFile, setLastFile] = useState(null);
    const [status, setStatus] = useState('idle');
    const [error, setError] = useState('');

    useEffect(() => () => {
        controllerRef.current?.abort();
    }, []);

    useEffect(() => () => {
        if (previewUrl) {
            URL.revokeObjectURL(previewUrl);
        }
    }, [previewUrl]);

    const setSelectedFile = useCallback((file) => {
        if (!file) {
            return;
        }

        if (!file.type.startsWith('image/')) {
            setError('Choose an image file to segment.');
            setStatus('error');
            return;
        }

        setPreviewUrl(previousUrl => {
            if (previousUrl) {
                URL.revokeObjectURL(previousUrl);
            }

            return URL.createObjectURL(file);
        });
        setLastFile(file);
        setResult(null);
        setImageMeta(null);
        setError('');
        setStatus('ready');
    }, []);

    const livePhoto = useLivePhotoCapture(setSelectedFile);

    const runSegmentation = useCallback(async () => {
        if (!lastFile) {
            setError('Choose an image first.');
            setStatus('error');
            return;
        }

        controllerRef.current?.abort();
        const controller = new AbortController();
        controllerRef.current = controller;

        setResult(null);
        setImageMeta(null);
        setError('');
        setStatus('loading');

        try {
            const analysis = await analyzeSam3LiteTextPhoto(lastFile, {
                text: prompt,
                threshold,
                maskThreshold,
                signal: controller.signal
            });
            setResult(analysis.result);
            setImageMeta({
                ...analysis.image,
                endpoint: analysis.endpoint,
                model: analysis.model,
                device: analysis.device
            });
            setStatus('done');
        } catch (segmentationError) {
            if (segmentationError?.name === 'AbortError') {
                return;
            }

            setError(segmentationError instanceof Error ? segmentationError.message : 'Browser segmentation failed.');
            setStatus('error');
        } finally {
            if (controllerRef.current === controller) {
                controllerRef.current = null;
            }
        }
    }, [lastFile, maskThreshold, prompt, threshold]);

    const handleFileChange = (event) => {
        const [file] = event.target.files || [];
        event.target.value = '';
        livePhoto.clearCameraError();
        setSelectedFile(file);
    };

    const loading = status === 'loading';
    const cameraVisible = livePhoto.cameraActive || livePhoto.cameraStarting;
    const summary = result ? summarizeSam3LiteTextOutput(result) : null;
    const canRun = Boolean(lastFile && prompt.trim() && !loading);
    const displayError = error || livePhoto.cameraError;
    const runtimeDetails = runtimeInfo.device === 'webgpu'
        ? 'WebGPU selected'
        : runtimeInfo.webgpuAutoEnabled
            ? 'WASM selected'
            : runtimeInfo.webgpu
                ? 'WebGPU detected, using WASM'
                : 'WASM fallback';

    return (
        <main className="prototype-shell sam3-screen">
            <BackButton onClick={onBack} />
            <section className="sam3-header">
                <span className="plant-pill">
                    <span className="leaf-icon"></span>
                    Browser segmentation
                </span>
                <h1>Plant mask on device</h1>
            </section>
            <section className="sam3-workbench">
                <Sam3LiteTextPreview
                    previewUrl={previewUrl}
                    result={result}
                    loading={loading}
                    cameraVisible={cameraVisible}
                    cameraStarting={livePhoto.cameraStarting}
                    cameraCapturing={livePhoto.cameraCapturing}
                    cameraVideoRef={livePhoto.videoRef}
                    onCameraCapture={livePhoto.captureCamera}
                    onCameraClose={livePhoto.stopCamera}
                />
                <input
                    ref={galleryInputRef}
                    type="file"
                    accept="image/*"
                    className="tree-file-input"
                    onChange={handleFileChange}
                />
                <div className="tree-capture-actions sam3-source-actions">
                    <button
                        type="button"
                        className="tree-action-button tree-action-button--primary"
                        onClick={() => {
                            setError('');
                            livePhoto.openCamera();
                        }}
                        disabled={loading || cameraVisible}
                    >
                        <span className="tree-action-icon tree-action-icon--camera" aria-hidden="true"></span>
                        Open camera
                    </button>
                    <button type="button" className="tree-action-button" onClick={() => galleryInputRef.current?.click()} disabled={loading || cameraVisible}>
                        <span className="tree-action-icon tree-action-icon--gallery" aria-hidden="true"></span>
                        Select photo
                    </button>
                </div>
                <label className="sam3-field">
                    <span>Prompt</span>
                    <input
                        value={prompt}
                        onChange={(event) => setPrompt(event.target.value)}
                        placeholder="tree or plant"
                        disabled={loading}
                    />
                </label>
                <div className="sam3-slider-grid">
                    <label className="sam3-slider">
                        <span>Score {threshold.toFixed(2)}</span>
                        <input
                            type="range"
                            min="0.05"
                            max="0.95"
                            step="0.05"
                            value={threshold}
                            onChange={(event) => setThreshold(Number(event.target.value))}
                            disabled={loading}
                        />
                    </label>
                    <label className="sam3-slider">
                        <span>Mask {maskThreshold.toFixed(2)}</span>
                        <input
                            type="range"
                            min="0.05"
                            max="0.95"
                            step="0.05"
                            value={maskThreshold}
                            onChange={(event) => setMaskThreshold(Number(event.target.value))}
                            disabled={loading}
                        />
                    </label>
                </div>
                <button type="button" className="sam3-run-button" onClick={runSegmentation} disabled={!canRun}>
                    <span className="sam3-run-icon" aria-hidden="true"></span>
                    Run on device
                </button>
                <p className="tree-image-meta">
                    Runtime {runtimeInfo.deviceLabel}, {runtimeDetails}
                </p>
                {imageMeta && (
                    <p className="tree-image-meta">
                        Processed {imageMeta.width}x{imageMeta.height} JPEG, {formatBytes(imageMeta.compressedBytes)}
                    </p>
                )}
            </section>
            {displayError && (
                <section className="tree-error" role="alert">
                    <strong>{livePhoto.cameraError && !error ? 'Camera unavailable' : 'Segmentation failed'}</strong>
                    <p>{displayError}</p>
                </section>
            )}
            {summary && <Sam3LiteTextSummary summary={summary} />}
            {result && <Sam3LiteTextRawOutput result={result} />}
        </main>
    );
}

function Sam3LiteTextPreview({
    previewUrl,
    result,
    loading,
    cameraVisible,
    cameraStarting,
    cameraCapturing,
    cameraVideoRef,
    onCameraCapture,
    onCameraClose
}) {
    const canvasRef = useRef(null);
    const [maskMessage, setMaskMessage] = useState('');
    const overlayUrl = useMemo(() => getSam3LiteTextOverlayUrl(result), [result]);

    useEffect(() => {
        const canvas = canvasRef.current;

        if (!canvas) {
            return;
        }

        const context = canvas.getContext('2d');
        context.clearRect(0, 0, canvas.width, canvas.height);
        setMaskMessage('');

        if (!result || overlayUrl) {
            return;
        }

        const drawResult = drawSam3LiteTextMasks(canvas, result);

        if (!drawResult.drawn) {
            setMaskMessage('No drawable mask returned.');
        }
    }, [overlayUrl, result]);

    return (
        <div className={`sam3-preview${previewUrl ? ' has-image' : ''}${cameraVisible ? ' is-camera-active' : ''}`}>
            {cameraVisible ? (
                <>
                    <video
                        ref={cameraVideoRef}
                        className="tree-live-camera"
                        autoPlay
                        playsInline
                        muted
                    />
                    <CameraCaptureControls
                        onCapture={onCameraCapture}
                        onClose={onCameraClose}
                        disabled={cameraStarting || cameraCapturing}
                    />
                </>
            ) : previewUrl ? (
                <img src={previewUrl} alt="Selected image preview" />
            ) : (
                <span className="tree-photo-placeholder" aria-hidden="true"></span>
            )}
            {!cameraVisible && overlayUrl && <img className="sam3-overlay-image" src={overlayUrl} alt="" aria-hidden="true" />}
            {!cameraVisible && !overlayUrl && <canvas ref={canvasRef} className="sam3-mask-canvas" aria-hidden="true"></canvas>}
            {!cameraVisible && maskMessage && <span className="sam3-mask-message">{maskMessage}</span>}
            {loading && (
                <div className="tree-loading" role="status" aria-live="polite">
                    <span className="tree-loading-spinner"></span>
                    <strong>Loading local model...</strong>
                </div>
            )}
            {cameraStarting && (
                <div className="tree-loading" role="status" aria-live="polite">
                    <span className="tree-loading-spinner"></span>
                    <strong>Opening camera...</strong>
                </div>
            )}
        </div>
    );
}

function Sam3LiteTextSummary({ summary }) {
    return (
        <section className="sam3-summary" aria-live="polite">
            <div className="tree-result-field">
                <span>Prompt match</span>
                <strong>{summary.objectCount > 0 ? `${summary.objectCount} segment${summary.objectCount === 1 ? '' : 's'}` : 'No segments'}</strong>
            </div>
            <div className="tree-result-field">
                <span>Best score</span>
                <strong>{formatModelScore(summary.bestScore)}</strong>
            </div>
            <div className="tree-result-field">
                <span>Presence</span>
                <strong>{formatModelScore(summary.presenceScore)}</strong>
            </div>
            <div className="tree-result-field">
                <span>Drawable masks</span>
                <strong>{summary.drawableMaskCount}</strong>
            </div>
        </section>
    );
}

function Sam3LiteTextRawOutput({ result }) {
    return (
        <details className="sam3-raw-output" open>
            <summary>Model output JSON</summary>
            <pre>{JSON.stringify(result, null, 2)}</pre>
        </details>
    );
}

function ARCameraHero() {
    const initializedRef = useRef(false);

    useEffect(() => {
        if (initializedRef.current) return;
        initializedRef.current = true;

        initializeCameraDemo();
        document.getElementById('start_button')?.click();

        return () => {
            Stats.el?.remove();
        };
    }, []);

    return (
        <div id="container" className="camera-demo-bg" aria-hidden="true">
            <div id="overlay">
                <div id="splash"></div>
                <button id="start_button" type="button" style={{ display: 'none' }}>Start</button>
            </div>
            <div id="gesture_status" data-action=""><span></span></div>
            <button id="place_image_button" type="button" hidden>Place</button>
            <button id="hand_toggle_button" type="button" hidden>Hand</button>
        </div>
    );
}

function ChatScreen({ chatState, setChatState, onBack, slideUpPanel = false, analysisResult, avatarPrompt }) {
    const [panelSlideIn, setPanelSlideIn] = useState(!slideUpPanel);
    const [careAnimation, setCareAnimation] = useState(null);

    useEffect(() => {
        if (!slideUpPanel) {
            return undefined;
        }
        const id = requestAnimationFrame(() => {
            requestAnimationFrame(() => setPanelSlideIn(true));
        });
        return () => cancelAnimationFrame(id);
    }, [slideUpPanel]);

    useEffect(() => {
        if (!careAnimation) {
            return undefined;
        }
        const id = setTimeout(() => setCareAnimation(null), 1600);
        return () => clearTimeout(id);
    }, [careAnimation]);

    const handleCareAction = (type) => {
        setChatState('speaking');
        setCareAnimation(type);
        setArCharacterSprite(type === 'sun' ? 'sunlight' : type);
    };

    const panelClassName = [
        'chat-panel',
        slideUpPanel && (panelSlideIn ? 'chat-panel--slide-in' : 'chat-panel--slide-pre')
    ]
        .filter(Boolean)
        .join(' ');

    return (
        <main className={`prototype-shell chat-screen chat-${chatState}`}>
            <section className="chat-hero">
                <ARCameraHero />
                {careAnimation === 'water' && (
                    <div className="care-effect care-effect--water" aria-hidden="true"></div>
                )}
                {careAnimation === 'sun' && (
                    <div className="care-effect care-effect--sun" aria-hidden="true"></div>
                )}
                <BackButton onClick={onBack} light />
                <CreditPill />
                {chatState !== 'intro' && (
                    <div className="care-actions" aria-label="Care actions">
                        <button type="button" className="care-action water" aria-label="Water Jasmine" onClick={() => handleCareAction('water')}></button>
                        <button type="button" className="care-action sun" aria-label="Give sunlight" onClick={() => handleCareAction('sun')}></button>
                    </div>
                )}
            </section>
            <section className={panelClassName}>
                {chatState === 'intro' && <ChatIntro onTalk={() => setChatState('speaking')} analysisResult={analysisResult} />}
                {chatState === 'speaking' && (
                    <ChatTranscript
                        analysisResult={analysisResult}
                        avatarPrompt={avatarPrompt}
                    />
                )}
            </section>
        </main>
    );
}

function ChatIntro({ onTalk, analysisResult }) {
    const name = analysisResult?.tree_name || analysisResult?.tree_species;

    return (
        <div className="chat-intro">
            {name ? (
                <>
                    <h2>{name}</h2>
                    {analysisResult?.image_summary && (
                        <p>{analysisResult.image_summary}</p>
                    )}
                </>
            ) : (
                <>
                    <h2>Jasmine</h2>
                    <p>Native plants help increase green spaces and absorb carbon.</p>
                    <Pill label="Moderate" />
                </>
            )}
            <button type="button" className="text-link" onClick={onTalk}>Talk to {name}</button>
        </div>
    );
}

function ChatTranscript({ analysisResult, avatarPrompt }) {
    const [lines, setLines] = useState([]);
    const [liveCaption, setLiveCaption] = useState('');
    const [asrStatus, setAsrStatus] = useState('idle');
    const [asrError, setAsrError] = useState('');
    const [ttsStatus, setTtsStatus] = useState('idle');
    const [ttsError, setTtsError] = useState('');
    const asrSessionRef = useRef(null);
    const ttsSessionRef = useRef(null);
    const stopListeningRef = useRef(null);

    const stopAsrSession = useCallback(() => {
        asrSessionRef.current?.stop();
        asrSessionRef.current = null;
        setAsrStatus('idle');
    }, []);

    const stopTtsSession = useCallback(() => {
        ttsSessionRef.current?.stop();
        ttsSessionRef.current = null;
        setTtsStatus('idle');
    }, []);

    const speakTranscript = useCallback((transcript) => {
        stopTtsSession();
        setTtsError('');
        setTtsStatus('connecting');

        const persona = avatarPrompt ?? analysisResult?.avatarPrompt ?? undefined;

        const session = createVoiceReplySession({
            text: transcript,
            persona,
            onStatus: setTtsStatus,
            onError: (message) => {
                setTtsError(message);
                setTtsStatus('error');
            }
        });

        ttsSessionRef.current = session;
        session.start()
            .then(() => {
                setLines(previousLines => [...previousLines, `Jasmine: ${transcript}`].slice(-8));
                ttsSessionRef.current = null;
            })
            .catch((error) => {
                const message = error instanceof Error ? error.message : 'Could not play Jasmine response.';
                setTtsError(message);
                setTtsStatus('error');
                ttsSessionRef.current = null;
            });
    }, [analysisResult, avatarPrompt, stopTtsSession]);

    const handleStream = useCallback((stream) => {
        stopAsrSession();
        stopTtsSession();
        setLiveCaption('');
        setAsrError('');
        setTtsError('');
        setTtsStatus('idle');

        const session = createRealtimeAsrSession({
            stream,
            onStatus: setAsrStatus,
            onPartial: (caption) => {
                setLiveCaption(caption);
            },
            onCompleted: (transcript) => {
                setLiveCaption(transcript);
                setLines(previousLines => [...previousLines, `You: ${transcript}`].slice(-8));
                stopAsrSession();
                stopListeningRef.current?.();
                speakTranscript(transcript);
            },
            onError: (message) => {
                setAsrError(message);
                setAsrStatus('error');
            }
        });

        asrSessionRef.current = session;
        session.start().catch((error) => {
            const message = error instanceof Error ? error.message : 'Could not start ASR.';
            setAsrError(message);
            setAsrStatus('error');
        });
    }, [speakTranscript, stopAsrSession, stopTtsSession]);

    const { isListening, startListening, stopListening } = useMicrophone({ onStream: handleStream });

    useEffect(() => {
        stopListeningRef.current = stopListening;
    }, [stopListening]);

    useEffect(() => () => {
        stopAsrSession();
        stopTtsSession();
    }, [stopAsrSession, stopTtsSession]);

    const handleMicClick = async () => {
        if (isListening) {
            stopAsrSession();
            stopListening();
        } else {
            stopTtsSession();
            setAsrError('');
            setTtsError('');
            setLiveCaption('');
            try {
                await prepareVoiceReplyAudio();
                await startListening();
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Microphone permission failed.';
                setAsrError(message);
                setAsrStatus('error');
            }
        }
    };

    const isResponding = ttsStatus === 'connecting' || ttsStatus === 'speaking' || ttsStatus === 'playing';
    const errorText = asrError || ttsError;
    const overlayText = errorText || liveCaption || (asrStatus === 'connecting' ? 'Connecting ASR...' : 'Listening...');
    const hasLiveCaption = Boolean(liveCaption && !errorText);
    const overlayLabel = isResponding ? 'Jasmine is speaking...' : 'Listening...';
    const micDisabled = isResponding;

    useEffect(() => {
        setArCharacterSprite(isResponding ? 'talking' : 'idle');

        return () => setArCharacterSprite('idle');
    }, [isResponding]);

    return (
        <div className={`chat-transcript${isListening ? ' is-listening' : ''}${isResponding ? ' is-responding' : ''}${errorText ? ' has-error' : ''}`}>
            <div className="chat-transcript-lines" tabIndex={0} aria-label="Conversation transcript">
                {lines.map((line, index) => (
                    <p key={`${line}-${index}`} className={index % 2 === 1 ? 'faded' : ''}>{line}</p>
                ))}
                {errorText && !isListening && !isResponding && (
                    <p className="chat-transcript-error">{errorText}</p>
                )}
            </div>
            <div className="chat-transcript-listening-overlay" aria-live="polite" aria-hidden={!isListening && !isResponding}>
                {hasLiveCaption && <span className="asr-status-label">{overlayLabel}</span>}
                <strong className={hasLiveCaption ? 'asr-caption' : ''}>{overlayText}</strong>
            </div>
            <MicButton warning={Boolean(errorText)} listening={isListening} disabled={micDisabled} onClick={handleMicClick} />
        </div>
    );
}

function StoreScreen({ onBack }) {
    const items = [
        { icon: 'water', name: 'Watering', cost: '20 Cr.' },
        { icon: 'sun', name: 'Sunlight', cost: '20 Cr.' },
        { icon: 'leaf', name: 'Bio Insight', cost: '100 Cr.' }
    ];

    return (
        <main className="prototype-shell store-screen">
            <BackButton onClick={onBack} />
            <section className="balance-card">
                <span>Your carbon balance</span>
                <strong>{CREDITS}</strong>
                <small>credits</small>
                <p>Here in GreenCredit, every 1 kg your plant absorbs earns you 1 credit.</p>
                <p>In the real world, 1 credit represents the removal of 1 metric ton of CO2 from our atmosphere.</p>
            </section>
            <section className="store-list">
                <h1>Store</h1>
                <p>Exchange your credits for gardening essentials and planet-positive rewards.</p>
                {items.map(item => (
                    <button key={item.name} type="button" className="store-item">
                        <span className={`store-icon ${item.icon}`}></span>
                        <span>{item.name}</span>
                        <strong>{item.cost}</strong>
                    </button>
                ))}
            </section>
        </main>
    );
}

function InfoScreen({ type, onBack }) {
    const isAbout = type === 'about';

    return (
        <main className="prototype-shell info-screen">
            <BackButton onClick={onBack} />
            <section className="info-copy">
                <h1>{isAbout ? 'About GreenCredit' : 'Meet the makers'}</h1>
                <p>{isAbout
                    ? 'GreenCredit imagines a gentler way to meet plants, track carbon care, and turn attention into small climate-positive rituals.'
                    : 'A prototype for playful plant companionship, designed with native plant education, calm interaction, and mobile AR in mind.'}</p>
                <button type="button" className="text-link" onClick={onBack}>Back to home</button>
            </section>
            <div className="pattern-swatch" aria-hidden="true">
                {Array.from({ length: 24 }, (_, index) => <span key={index}></span>)}
            </div>
        </main>
    );
}

function BackButton({ onClick, light = false }) {
    return (
        <button type="button" className={`back-button ${light ? 'light' : ''}`} onClick={onClick} aria-label="Go back">
            <span aria-hidden="true"></span>
        </button>
    );
}

function CreditPill() {
    return (
        <div className="credit-pill">
            <span className="leaf-icon"></span>
            <strong>{CREDITS}</strong>
        </div>
    );
}

function Pill({ label }) {
    return (
        <span className="plant-pill">
            <span className="leaf-icon"></span>
            {label}
        </span>
    );
}

function displayValue(value) {
    if (value === null || value === undefined || value === '') {
        return 'Unavailable';
    }

    return value;
}

function formatBytes(value) {
    if (!Number.isFinite(value)) {
        return 'unknown size';
    }

    if (value < 1024 * 1024) {
        return `${Math.round(value / 1024)} KB`;
    }

    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatConfidence(value) {
    const confidence = Number(value);

    if (!Number.isFinite(confidence)) {
        return '';
    }

    const normalized = confidence <= 1 ? confidence * 100 : confidence;
    return `${Math.round(normalized)}%`;
}

function formatCurrency(value) {
    const amount = Number(value);

    if (!Number.isFinite(amount)) {
        return '';
    }

    return `$${amount.toFixed(2)}`;
}

function formatModelScore(value) {
    const score = Number(value);

    if (!Number.isFinite(score)) {
        return 'Unavailable';
    }

    if (score >= 0 && score <= 1) {
        return `${Math.round(score * 100)}%`;
    }

    return score.toFixed(3);
}

function MicButton({ onClick, warning = false, listening = false, disabled = false }) {
    const classes = [
        'mic-button',
        warning && 'warning',
        listening && 'mic-button--listening'
    ]
        .filter(Boolean)
        .join(' ');

    return (
        <button type="button" className={classes} onClick={onClick} disabled={disabled} aria-label={listening ? 'Stop listening' : 'Microphone'} aria-pressed={listening}>
            <span></span>
        </button>
    );
}

export default App;
