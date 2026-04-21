import { useEffect, useMemo, useState } from 'react';

const ASSETS = {
    character: '/assets/demo-marker.png'
};

const CREDITS = '1,240';

function App()
{
    const isLiveAr = useMemo( () => new URLSearchParams( window.location.search ).get( 'mode' ) === 'ar', [] );

    if( isLiveAr )
    {
        return <LiveCameraDemo />;
    }

    return <GreenCreditPrototype />;
}

function LiveCameraDemo()
{
    useEffect( () =>
    {
        let mounted = true;

        import( './cameraDemo.js' ).then( ( { initializeCameraDemo } ) =>
        {
            if( mounted )
            {
                initializeCameraDemo();
            }
        } );

        return () =>
        {
            mounted = false;
        };
    }, [] );

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

function GreenCreditPrototype()
{
    const [activeScreen, setActiveScreen] = useState( 'home' );
    const [chatState, setChatState] = useState( 'intro' );

    const goChat = ( state = 'intro' ) =>
    {
        setChatState( state );
        setActiveScreen( 'chat' );
    };

    const openLiveAr = () =>
    {
        window.location.search = '?mode=ar';
    };

    if( activeScreen === 'detail' )
    {
        return <PlantDetailScreen onBack={() => setActiveScreen( 'home' )} onCapture={() => setActiveScreen( 'capture' )} onTalk={() => goChat( 'intro' )} />;
    }

    if( activeScreen === 'capture' )
    {
        return <CaptureScreen onBack={() => setActiveScreen( 'detail' )} onCapture={() => goChat( 'intro' )} />;
    }

    if( activeScreen === 'chat' )
    {
        return <ChatScreen chatState={chatState} setChatState={setChatState} onBack={() => setActiveScreen( 'detail' )} />;
    }

    if( activeScreen === 'store' )
    {
        return <StoreScreen onBack={() => setActiveScreen( 'home' )} />;
    }

    if( activeScreen === 'about' || activeScreen === 'makers' )
    {
        return <InfoScreen type={activeScreen} onBack={() => setActiveScreen( 'home' )} />;
    }

    return <HomeScreen onOpenDetail={() => setActiveScreen( 'detail' )} onOpenStore={() => setActiveScreen( 'store' )} onOpenInfo={setActiveScreen} onOpenLiveAr={openLiveAr} />;
}

function HomeScreen( { onOpenDetail, onOpenStore, onOpenInfo, onOpenLiveAr } )
{
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
                    <button type="button" onClick={() => onOpenInfo( 'about' )}>About the app</button>
                    <button type="button" onClick={() => onOpenInfo( 'makers' )}>Meet the makers</button>
                    <button type="button" onClick={onOpenLiveAr}>Live AR camera</button>
                </nav>
            </section>
        </main>
    );
}

function MenuCard( { title, caption, onClick } )
{
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

function PlantDetailScreen( { onBack, onCapture, onTalk } )
{
    return (
        <main className="prototype-shell detail-screen">
            <BackButton onClick={onBack} />
            <section className="plant-copy">
                <h1>Jasmine</h1>
                <p className="latin-name">Jasminum</p>
                <p className="plant-intro">Native plants help increase green spaces and absorb carbon.</p>
                <Pill label="Moderate" />
                <div className="carbon-card">
                    <span>Carbon Absorbed</span>
                    <strong>45</strong>
                    <small>kg CO2e</small>
                </div>
                <button type="button" className="help-link">What does it mean?</button>
            </section>
            <button type="button" className="plant-portrait" onClick={onCapture} aria-label="Open AR capture">
                <img src={ASSETS.character} alt="Jasmine character" />
            </button>
            <div className="plant-carousel" aria-label="Plant collection">
                {[0, 1, 2, 3].map( index => (
                    <button key={index} type="button" className={index === 0 ? 'active' : ''} onClick={index === 2 ? onCapture : onTalk} aria-label={`Plant view ${ index + 1 }`}>
                        <img src={ASSETS.character} alt="" />
                    </button>
                ) )}
            </div>
        </main>
    );
}

function CaptureScreen( { onBack, onCapture } )
{
    return (
        <main className="capture-screen foliage-scene">
            <BackButton onClick={onBack} light />
            <button type="button" className="capture-control" aria-label="Capture Jasmine" onClick={onCapture}></button>
        </main>
    );
}

function ChatScreen( { chatState, setChatState, onBack } )
{
    return (
        <main className={`prototype-shell chat-screen chat-${ chatState }`}>
            <section className="chat-hero">
                <div className="chat-photo foliage-scene" aria-hidden="true"></div>
                <img className="chat-character" src={ASSETS.character} alt="Jasmine character" />
                <BackButton onClick={onBack} light />
                <CreditPill />
                <div className="care-actions" aria-label="Care actions">
                    <button type="button" className="care-action water" aria-label="Water Jasmine" onClick={() => setChatState( 'speaking' )}></button>
                    <button type="button" className="care-action sun" aria-label="Give sunlight" onClick={() => setChatState( 'speaking' )}></button>
                </div>
            </section>
            <section className="chat-panel">
                {chatState === 'intro' && <ChatIntro onTalk={() => setChatState( 'suggestions' )} />}
                {chatState === 'suggestions' && <ChatSuggestions onListen={() => setChatState( 'listening' )} onSpeak={() => setChatState( 'speaking' )} />}
                {chatState === 'speaking' && <ChatTranscript onListen={() => setChatState( 'listening' )} />}
                {chatState === 'listening' && <ListeningState onDone={() => setChatState( 'speaking' )} />}
            </section>
        </main>
    );
}

function ChatIntro( { onTalk } )
{
    return (
        <div className="chat-intro">
            <h2>Jasmine</h2>
            <p>Native plants help increase green spaces and absorb carbon.</p>
            <Pill label="Moderate" />
            <button type="button" className="text-link" onClick={onTalk}>Talk to Jasmine</button>
        </div>
    );
}

function ChatSuggestions( { onListen, onSpeak } )
{
    return (
        <div className="chat-suggestions">
            <p className="faded">Jasmine saying...</p>
            <p>Good morning, Great! Nice weather, isn't it?</p>
            <button type="button" className="prompt-chip" onClick={onSpeak}>How's the weather today?</button>
            <button type="button" className="prompt-chip" onClick={onSpeak}>How much carbon did you eat today?</button>
            <button type="button" className="help-link prompt-help">How to display the help?</button>
            <MicButton onClick={onListen} />
        </div>
    );
}

function ChatTranscript( { onListen } )
{
    const lines = [
        'Good morning, Great! Nice weather',
        'Good morning',
        'Good morning, Great! Nice weather',
        'Good morning',
        'Good morning, Great! Nice weather',
        'Good morning, Great! Nice weather',
        'Good morning'
    ];

    return (
        <div className="chat-transcript">
            <p className="faded">Jasmine saying...</p>
            {lines.map( ( line, index ) => (
                <p key={`${ line }-${ index }`} className={index % 2 === 1 ? 'faded' : ''}>{line}</p>
            ) )}
            <MicButton onClick={onListen} />
        </div>
    );
}

function ListeningState( { onDone } )
{
    return (
        <div className="listening-state">
            <div className="ghost-lines">
                <p>Good morning, Great! Nice weather</p>
                <p>Good morning, Great! Nice weather</p>
                <p>Good morning, Great! Nice weather</p>
                <p>Good morning, Great! Nice weather</p>
            </div>
            <strong>Listening...</strong>
            <button type="button" className="help-link" onClick={onDone}>Use sound wave if possible</button>
            <MicButton warning onClick={onDone} />
        </div>
    );
}

function StoreScreen( { onBack } )
{
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
                {items.map( item => (
                    <button key={item.name} type="button" className="store-item">
                        <span className={`store-icon ${ item.icon }`}></span>
                        <span>{item.name}</span>
                        <strong>{item.cost}</strong>
                    </button>
                ) )}
            </section>
        </main>
    );
}

function InfoScreen( { type, onBack } )
{
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
                {Array.from( { length: 24 }, ( _, index ) => <span key={index}></span> )}
            </div>
        </main>
    );
}

function BackButton( { onClick, light = false } )
{
    return (
        <button type="button" className={`back-button ${ light ? 'light' : '' }`} onClick={onClick} aria-label="Go back">
            <span aria-hidden="true"></span>
        </button>
    );
}

function CreditPill()
{
    return (
        <div className="credit-pill">
            <span className="leaf-icon"></span>
            <strong>{CREDITS}</strong>
        </div>
    );
}

function Pill( { label } )
{
    return (
        <span className="plant-pill">
            <span className="leaf-icon"></span>
            {label}
        </span>
    );
}

function MicButton( { onClick, warning = false } )
{
    return (
        <button type="button" className={`mic-button ${ warning ? 'warning' : '' }`} onClick={onClick} aria-label="Microphone">
            <span></span>
        </button>
    );
}

export default App;
