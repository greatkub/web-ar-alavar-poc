import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRealtimeAsrSession } from './asr/realtimeAsr.js';
import { useMicrophone } from './microphone/index.js';
import { supabase } from './supabase.js';
import { SignInScreen } from './SignInScreen.jsx';

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

function useAuth() {
    const [session, setSession] = useState(undefined);

    useEffect(() => {
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
    const isLiveAr = useMemo(() => new URLSearchParams(window.location.search).get('mode') === 'ar', []);

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

    if (isLiveAr) {
        return <LiveCameraDemo />;
    }

    return <GreenCreditPrototype session={session} />;
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

function GreenCreditPrototype({ session }) {
    const handleSignOut = useCallback(async () => {
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
    } else if (activeScreen === 'about' || activeScreen === 'makers') {
        body = <InfoScreen type={activeScreen} onBack={() => navigate('home', 'back')} />;
    } else {
        body = (
            <HomeScreen
                onOpenDetail={() => navigate('detail', 'forward')}
                onOpenStore={() => navigate('store', 'forward')}
                onOpenInfo={(screen) => navigate(screen, 'forward')}
                onOpenCapture={() => {
                    setCaptureReturnScreen('home');
                    navigate('capture', 'forward');
                }}
                userEmail={session?.user?.email}
                onSignOut={handleSignOut}
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

function HomeScreen({ onOpenDetail, onOpenStore, onOpenInfo, onOpenCapture, userEmail, onSignOut }) {
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
                    <button type="button" onClick={() => onOpenInfo('about')}>About the app</button>
                    <button type="button" onClick={() => onOpenInfo('makers')}>Meet the makers</button>
                    <button type="button" onClick={onOpenCapture}>
                        Live AR camera
                    </button>
                </nav>
                <div className="home-signout">
                    {userEmail && <span className="home-signout-email">{userEmail}</span>}
                    <button type="button" className="home-signout-btn" onClick={onSignOut}>
                        Sign out
                    </button>
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
    const asrSessionRef = useRef(null);

    const stopAsrSession = useCallback(() => {
        asrSessionRef.current?.stop();
        asrSessionRef.current = null;
        setAsrStatus('idle');
    }, []);

    const handleStream = useCallback((stream) => {
        stopAsrSession();
        setLiveCaption('');
        setAsrError('');

        const session = createRealtimeAsrSession({
            stream,
            onStatus: setAsrStatus,
            onPartial: (caption) => {
                setLiveCaption(caption);
            },
            onCompleted: (transcript) => {
                setLiveCaption(transcript);
                setLines(previousLines => [...previousLines, transcript].slice(-8));
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
    }, [stopAsrSession]);

    const { isListening, startListening, stopListening } = useMicrophone({ onStream: handleStream });

    useEffect(() => () => stopAsrSession(), [stopAsrSession]);

    const handleMicClick = async () => {
        if (isListening) {
            stopAsrSession();
            stopListening();
        } else {
            setAsrError('');
            setLiveCaption('');
            try {
                await startListening();
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Microphone permission failed.';
                setAsrError(message);
                setAsrStatus('error');
            }
        }
    };

    const overlayText = asrError || liveCaption || (asrStatus === 'connecting' ? 'Connecting ASR...' : 'Listening...');
    const hasLiveCaption = Boolean(liveCaption && !asrError);

    return (
        <div className={`chat-transcript${isListening ? ' is-listening' : ''}${asrError ? ' has-error' : ''}`}>
            <div className="chat-transcript-lines" tabIndex={0} aria-label="Conversation transcript">
                {lines.map((line, index) => (
                    <p key={`${line}-${index}`} className={index % 2 === 1 ? 'faded' : ''}>{line}</p>
                ))}
                {asrError && !isListening && (
                    <p className="chat-transcript-error">{asrError}</p>
                )}
            </div>
            <div className="chat-transcript-listening-overlay" aria-live="polite" aria-hidden={!isListening}>
                {hasLiveCaption && <span className="asr-status-label">Listening...</span>}
                <strong className={hasLiveCaption ? 'asr-caption' : ''}>{overlayText}</strong>
            </div>
            <MicButton warning={Boolean(asrError)} listening={isListening} onClick={handleMicClick} />
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

function MicButton({ onClick, warning = false, listening = false }) {
    const classes = [
        'mic-button',
        warning && 'warning',
        listening && 'mic-button--listening'
    ]
        .filter(Boolean)
        .join(' ');

    return (
        <button type="button" className={classes} onClick={onClick} aria-label={listening ? 'Stop listening' : 'Microphone'} aria-pressed={listening}>
            <span></span>
        </button>
    );
}

export default App;
