import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRealtimeAsrSession } from './asr/realtimeAsr.js';
import { useMicrophone } from './microphone/index.js';
import { createRealtimeTtsSession, prepareTtsAudio } from './tts/realtimeTts.js';
import { isSupabaseConfigured, supabase } from './supabase.js';
import { SignInScreen } from './SignInScreen.jsx';
import { analyzeTreePhoto } from './treeAnalysis.js';
import {
    analyzeSam3LiteTextPhoto,
    drawSam3LiteTextMasks,
    getSam3LiteTextOverlayUrl,
    getOnDeviceSegmentationStatus,
    summarizeSam3LiteTextOutput
} from './sam3LiteText.js';

const SAM3_ROUTE = 'sam3-litetext';

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

    if (browserRoute === 'ar') {
        return <LiveCameraDemo />;
    }

    if (browserRoute === SAM3_ROUTE) {
        return <Sam3LiteTextScreen onBack={() => openBrowserRoute('')} />;
    }

    return <GreenCreditPrototype session={session} onOpenSam3LiteText={() => openBrowserRoute(SAM3_ROUTE)} />;
}

function LiveCameraDemo() {
    useEffect(() => {
        let mounted = true;

        import('./cameraDemo.js').then(({ initializeCameraDemo }) => {
            if (mounted) {
                initializeCameraDemo();
            }
        });

        return () => {
            mounted = false;
        };
    }, []);

    return (
        <main className="camera-app">
            <div id="container"></div>
            <button id="place_image_button" type="button" aria-label="Place image marker" title="Place image marker" hidden></button>
            <button id="hand_toggle_button" type="button" aria-label="Enable hand interactions" aria-pressed="false" hidden>Hand</button>
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
                onCapture={() => goChat('intro', 'capture', { slideUpPanel: true })}
            />
        );
    } else if (activeScreen === 'chat') {
        body = (
            <ChatScreen
                chatState={chatState}
                setChatState={setChatState}
                onBack={() => navigate(chatBackScreen, 'back')}
                slideUpPanel={chatEnterSlideUp}
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

function HomeScreen({ onOpenDetail, onOpenStore, onOpenInfo, onOpenTreeAnalysis, onOpenSam3LiteText, onOpenCapture, userEmail, onSignOut, canSignOut }) {
    return (
        <main className="prototype-shell home-screen">
            <section className="home-content">
                <h1>GreenCredit</h1>
                <div className="home-menu" aria-label="GreenCredit menu">
                    <MenuCard title="Discover" caption="Befriend and interact with plants" onClick={onOpenDetail} />
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
    return (
        <main className="capture-screen foliage-scene">
            <BackButton onClick={onBack} light />
            <button type="button" className="capture-control" aria-label="Capture Jasmine" onClick={onCapture}></button>
        </main>
    );
}

function TreeAnalysisScreen({ onBack }) {
    const cameraInputRef = useRef(null);
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

    const handleFileChange = (event) => {
        const [file] = event.target.files || [];
        event.target.value = '';
        startAnalysis(file);
    };

    const openCamera = () => cameraInputRef.current?.click();
    const openGallery = () => galleryInputRef.current?.click();
    const retry = () => startAnalysis(lastFile);
    const loading = status === 'loading';

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
                <div className={`tree-photo-preview${previewUrl ? ' has-image' : ''}`}>
                    {previewUrl ? (
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
                </div>
                <input
                    ref={cameraInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="tree-file-input"
                    onChange={handleFileChange}
                />
                <input
                    ref={galleryInputRef}
                    type="file"
                    accept="image/*"
                    className="tree-file-input"
                    onChange={handleFileChange}
                />
                <div className="tree-capture-actions">
                    <button type="button" className="tree-action-button tree-action-button--primary" onClick={openCamera} disabled={loading}>
                        <span className="tree-action-icon tree-action-icon--camera" aria-hidden="true"></span>
                        Open camera
                    </button>
                    <button type="button" className="tree-action-button" onClick={openGallery} disabled={loading}>
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
            {error && (
                <section className="tree-error" role="alert">
                    <strong>Analysis failed</strong>
                    <p>{error}</p>
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

function Sam3LiteTextScreen({ onBack }) {
    const cameraInputRef = useRef(null);
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
        setSelectedFile(file);
    };

    const loading = status === 'loading';
    const summary = result ? summarizeSam3LiteTextOutput(result) : null;
    const canRun = Boolean(lastFile && prompt.trim() && !loading);

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
                <Sam3LiteTextPreview previewUrl={previewUrl} result={result} loading={loading} />
                <input
                    ref={cameraInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="tree-file-input"
                    onChange={handleFileChange}
                />
                <input
                    ref={galleryInputRef}
                    type="file"
                    accept="image/*"
                    className="tree-file-input"
                    onChange={handleFileChange}
                />
                <div className="tree-capture-actions sam3-source-actions">
                    <button type="button" className="tree-action-button tree-action-button--primary" onClick={() => cameraInputRef.current?.click()} disabled={loading}>
                        <span className="tree-action-icon tree-action-icon--camera" aria-hidden="true"></span>
                        Open camera
                    </button>
                    <button type="button" className="tree-action-button" onClick={() => galleryInputRef.current?.click()} disabled={loading}>
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
                    Runtime {runtimeInfo.deviceLabel}, {runtimeInfo.webgpu ? 'WebGPU available' : 'WASM fallback'}
                </p>
                {imageMeta && (
                    <p className="tree-image-meta">
                        Processed {imageMeta.width}x{imageMeta.height} JPEG, {formatBytes(imageMeta.compressedBytes)}
                    </p>
                )}
            </section>
            {error && (
                <section className="tree-error" role="alert">
                    <strong>Segmentation failed</strong>
                    <p>{error}</p>
                </section>
            )}
            {summary && <Sam3LiteTextSummary summary={summary} />}
            {result && <Sam3LiteTextRawOutput result={result} />}
        </main>
    );
}

function Sam3LiteTextPreview({ previewUrl, result, loading }) {
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
        <div className={`sam3-preview${previewUrl ? ' has-image' : ''}`}>
            {previewUrl ? (
                <img src={previewUrl} alt="Selected image preview" />
            ) : (
                <span className="tree-photo-placeholder" aria-hidden="true"></span>
            )}
            {overlayUrl && <img className="sam3-overlay-image" src={overlayUrl} alt="" aria-hidden="true" />}
            {!overlayUrl && <canvas ref={canvasRef} className="sam3-mask-canvas" aria-hidden="true"></canvas>}
            {maskMessage && <span className="sam3-mask-message">{maskMessage}</span>}
            {loading && (
                <div className="tree-loading" role="status" aria-live="polite">
                    <span className="tree-loading-spinner"></span>
                    <strong>Loading local model...</strong>
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

function ChatScreen({ chatState, setChatState, onBack, slideUpPanel = false }) {
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
                <div className="chat-photo foliage-scene" aria-hidden="true"></div>
                {careAnimation === 'water' && (
                    <div className="care-effect care-effect--water" aria-hidden="true"></div>
                )}
                {careAnimation === 'sun' && (
                    <div className="care-effect care-effect--sun" aria-hidden="true"></div>
                )}
                <img
                    className={`chat-character${careAnimation ? ' chat-character--joy' : ''}`}
                    src={ASSETS.character}
                    alt="Jasmine character"
                />
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
                {chatState === 'intro' && <ChatIntro onTalk={() => setChatState('speaking')} />}
                {chatState === 'speaking' && <ChatTranscript />}
            </section>
        </main>
    );
}

function ChatIntro({ onTalk }) {
    return (
        <div className="chat-intro">
            <h2>Jasmine</h2>
            <p>Native plants help increase green spaces and absorb carbon.</p>
            <Pill label="Moderate" />
            <button type="button" className="text-link" onClick={onTalk}>Talk to Jasmine</button>
        </div>
    );
}

function ChatTranscript() {
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

        const session = createRealtimeTtsSession({
            text: transcript,
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
    }, [stopTtsSession]);

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
                await prepareTtsAudio();
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
