import { Stats } from "../public/assets/stats.js";
import { AlvaAR } from '../public/assets/alva_ar.js';
import { ARCamView } from "../public/assets/view.js";
import { Camera, onFrame, resize2cover } from "../public/assets/utils.js";

export function initializeCameraDemo()
{
    const config = {
        video: {
            facingMode: 'environment',
            aspectRatio: 16 / 9,
            width: { ideal: 640 }
        },
        audio: false
    }

    const leafOcclusion = {
        minGreen: 35,
        minChroma: 20,
        minDominance: 8,
        alphaBoost: 80
    };
    const mediaPipeConfig = {
        scriptUrl: 'https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/hands.js',
        assetBaseUrl: 'https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240',
        frameIntervalMs: 450,
        sampleWidth: 192
    };
    const interactionConfig = {
        pinchRatio: 0.22,
        rubRadiusRatio: 0.16,
        cheekRadiusRatio: 0.14,
        scoopWidthRatio: 0.58,
        statusDecay: 0.72
    };

    const $container = document.getElementById( 'container' );
    const $view = document.createElement( 'div' );
    const $canvas = document.createElement( 'canvas' );
    const $occlusion = document.createElement( 'canvas' );
    const $overlay = document.getElementById( 'overlay' );
    const $start = document.getElementById( 'start_button' );
    const $splash = document.getElementById( 'splash' );
    const $placeImage = document.getElementById( 'place_image_button' );
    const $handToggle = document.getElementById( 'hand_toggle_button' );
    const $gestureStatus = document.getElementById( 'gesture_status' );
    const splashFadeTime = 800;

    $splash.style.transition = `opacity ${ splashFadeTime / 1000 }s ease`;
    $splash.style.opacity = 0;

    function renderLeafOcclusion( frame, occlusionCtx, occlusionFrame )
    {
        const src = frame.data;
        const dst = occlusionFrame.data;

        for( let i = 0; i < src.length; i += 4 )
        {
            const r = src[i];
            const g = src[i + 1];
            const b = src[i + 2];
            const max = Math.max( r, g, b );
            const min = Math.min( r, g, b );
            const chroma = max - min;
            const dominance = g - Math.max( r, b );
            const isLeafLike = g === max &&
                g >= leafOcclusion.minGreen &&
                chroma >= leafOcclusion.minChroma &&
                dominance >= leafOcclusion.minDominance;

            dst[i] = r;
            dst[i + 1] = g;
            dst[i + 2] = b;
            dst[i + 3] = isLeafLike ? Math.min( 255, leafOcclusion.alphaBoost + dominance * 6 ) : 0;
        }

        occlusionCtx.putImageData( occlusionFrame, 0, 0 );
    }

    const clamp = ( value, min, max ) => Math.max( min, Math.min( max, value ) );

    const distance = ( a, b ) =>
    {
        const dx = a.x - b.x;
        const dy = a.y - b.y;

        return Math.sqrt( dx * dx + dy * dy );
    };

    const midpoint = ( a, b ) => ( {
        x: ( a.x + b.x ) * 0.5,
        y: ( a.y + b.y ) * 0.5,
        z: ( ( a.z || 0 ) + ( b.z || 0 ) ) * 0.5
    } );

    const averagePoints = points =>
    {
        const total = points.reduce( ( acc, point ) =>
        {
            acc.x += point.x;
            acc.y += point.y;
            acc.z += point.z || 0;
            return acc;
        }, { x: 0, y: 0, z: 0 } );

        return {
            x: total.x / points.length,
            y: total.y / points.length,
            z: total.z / points.length
        };
    };

    function setGestureStatus( action, text )
    {
        $gestureStatus.dataset.action = action;
        $gestureStatus.querySelector( 'span' ).textContent = text;
    }

    function createNoopGestureTracker( statusText )
    {
        setGestureStatus( 'unavailable', statusText );

        return {
            ready: false,
            enabled: false,
            enable()
            {
                setGestureStatus( 'unavailable', statusText );
            },
            disable()
            {
                setGestureStatus( 'hand_off', 'Hand off' );
            },
            update()
            {
                return { ready: false, hands: [] };
            },
            processFrame() {},
            reset()
            {
                setGestureStatus( 'hand_off', 'Hand off' );
            }
        };
    }

    let handsScriptPromise = null;

    function loadMediaPipeHands()
    {
        if( window.Hands )
        {
            return Promise.resolve( window.Hands );
        }

        if( handsScriptPromise )
        {
            return handsScriptPromise;
        }

        handsScriptPromise = new Promise( ( resolve, reject ) =>
        {
            const script = document.createElement( 'script' );
            script.src = mediaPipeConfig.scriptUrl;
            script.async = true;
            script.crossOrigin = 'anonymous';
            script.onload = () =>
            {
                if( window.Hands )
                {
                    resolve( window.Hands );
                }
                else
                {
                    reject( new Error( 'MediaPipe Hands global missing.' ) );
                }
            };
            script.onerror = () => reject( new Error( 'Failed to load MediaPipe Hands.' ) );
            document.head.appendChild( script );
        } );

        return handsScriptPromise;
    }

    function createHandGestureTracker( sourceCanvas, onStateChange )
    {
        const sampleCanvas = document.createElement( 'canvas' );
        const sampleCtx = sampleCanvas.getContext( '2d', { alpha: false } );
        let previousIndexTips = [];
        let lastFrame = { ready: false, hands: [] };
        let enabled = false;
        let ready = false;
        let running = false;
        let lastSentTime = 0;
        let hands = null;

        const setEnabled = value =>
        {
            enabled = value;
            onStateChange( enabled );
        };

        const buildHands = ( landmarks, handednesses, screenWidth, screenHeight ) =>
        {
            const nextIndexTips = [];
            const hands = landmarks.map( ( handLandmarks, index ) =>
            {
                const points = handLandmarks.map( point => ( {
                    x: point.x * screenWidth,
                    y: point.y * screenHeight,
                    z: point.z || 0
                } ) );
                const minX = Math.min( ...points.map( point => point.x ) );
                const maxX = Math.max( ...points.map( point => point.x ) );
                const minY = Math.min( ...points.map( point => point.y ) );
                const maxY = Math.max( ...points.map( point => point.y ) );
                const handSize = Math.max( 1, Math.sqrt( ( maxX - minX ) ** 2 + ( maxY - minY ) ** 2 ) );
                const indexTip = points[8];
                const thumbTip = points[4];
                const previousIndex = previousIndexTips[index];
                const handedness = handednesses[index]?.[0]?.categoryName || 'Unknown';
                const pinchDistance = distance( thumbTip, indexTip );
                const fingerSpread = (
                    distance( points[8], points[12] ) +
                    distance( points[12], points[16] ) +
                    distance( points[16], points[20] )
                ) / handSize;
                const isOpenPalm = fingerSpread > 0.52;

                nextIndexTips[index] = indexTip;

                return {
                    points,
                    gesture: isOpenPalm ? 'Open_Palm' : 'Hand',
                    handedness,
                    handSize,
                    palmCenter: averagePoints( [points[0], points[5], points[9], points[13], points[17]] ),
                    pinchCenter: midpoint( thumbTip, indexTip ),
                    pinchDistance,
                    isPinching: pinchDistance < handSize * interactionConfig.pinchRatio,
                    isOpenPalm,
                    indexTip,
                    indexSpeed: previousIndex ? distance( indexTip, previousIndex ) : 0
                };
            } );

            previousIndexTips = nextIndexTips;
            lastFrame = { ready: true, hands };
        };

        const ensureHands = () =>
        {
            if( hands )
            {
                return Promise.resolve();
            }

            return loadMediaPipeHands().then( Hands =>
            {
                hands = new Hands( {
                    locateFile: file => `${ mediaPipeConfig.assetBaseUrl }/${ file }`
                } );
                hands.setOptions( {
                    maxNumHands: 2,
                    modelComplexity: 0,
                    minDetectionConfidence: 0.55,
                    minTrackingConfidence: 0.45
                } );
                hands.onResults( results =>
                {
                    buildHands(
                        results.multiHandLandmarks || [],
                        results.multiHandedness || [],
                        sourceCanvas.width,
                        sourceCanvas.height
                    );
                } );

                return hands.initialize();
            } ).then( () =>
            {
                ready = true;
                setGestureStatus( 'idle', 'Show hand near character' );
            } );
        };

        const processFrame = time =>
        {
            if( !enabled || !ready || running || time - lastSentTime < mediaPipeConfig.frameIntervalMs )
            {
                return;
            }

            lastSentTime = time;
            running = true;
            sampleCanvas.width = mediaPipeConfig.sampleWidth;
            sampleCanvas.height = Math.max( 1, Math.round( sourceCanvas.height / sourceCanvas.width * sampleCanvas.width ) );
            sampleCtx.drawImage( sourceCanvas, 0, 0, sampleCanvas.width, sampleCanvas.height );

            hands.send( { image: sampleCanvas } ).catch( error =>
            {
                console.warn( 'Hand sample failed.', error );
                ready = false;
                setEnabled( false );
                setGestureStatus( 'unavailable', 'Hand unavailable' );
            } ).finally( () =>
            {
                running = false;
            } );
        };

        return {
            ready: true,
            get enabled()
            {
                return enabled;
            },
            enable()
            {
                if( enabled )
                {
                    return;
                }

                setEnabled( true );
                setGestureStatus( ready ? 'idle' : 'loading', ready ? 'Show hand near character' : 'Loading hand model...' );

                ensureHands().catch( error =>
                {
                    console.warn( 'MediaPipe Hands unavailable.', error );
                    ready = false;
                    setEnabled( false );
                    setGestureStatus( 'unavailable', 'Hand unavailable' );
                } );
            },
            disable()
            {
                setEnabled( false );
                previousIndexTips = [];
                lastFrame = { ready: false, hands: [] };
                setGestureStatus( 'hand_off', 'Hand off' );
            },
            update()
            {
                return lastFrame;
            },
            processFrame,
            reset()
            {
                previousIndexTips = [];
                lastFrame = { ready: enabled, hands: [] };
                setGestureStatus( enabled ? 'idle' : 'hand_off', enabled ? 'Show hand near character' : 'Hand off' );
            }
        };
    }

    function createCharacterInteraction()
    {
        const effect = {
            lift: 0,
            offsetX: 0,
            scaleBoost: 0,
            roll: 0,
            cheekPull: 0
        };
        let previousAction = 'idle';

        const decayEffects = () =>
        {
            effect.lift *= interactionConfig.statusDecay;
            effect.offsetX *= interactionConfig.statusDecay;
            effect.scaleBoost *= interactionConfig.statusDecay;
            effect.roll *= interactionConfig.statusDecay;
            effect.cheekPull *= interactionConfig.statusDecay;
        };

        const emitAction = detail =>
        {
            if( detail.action !== previousAction || detail.intensity > 0.25 )
            {
                window.dispatchEvent( new CustomEvent( 'characterinteraction', { detail } ) );
            }

            previousAction = detail.action;
        };

        const getRegions = bounds =>
        {
            const minSize = Math.min( bounds.width, bounds.height );

            return {
                head: {
                    x: bounds.centerX,
                    y: bounds.top + bounds.height * 0.28,
                    radius: minSize * interactionConfig.rubRadiusRatio
                },
                leftCheek: {
                    side: 'left',
                    x: bounds.centerX - bounds.width * 0.13,
                    y: bounds.top + bounds.height * 0.38,
                    radius: minSize * interactionConfig.cheekRadiusRatio
                },
                rightCheek: {
                    side: 'right',
                    x: bounds.centerX + bounds.width * 0.13,
                    y: bounds.top + bounds.height * 0.38,
                    radius: minSize * interactionConfig.cheekRadiusRatio
                }
            };
        };

        const scoreHandAction = ( hand, bounds, regions ) =>
        {
            const headDistance = distance( hand.indexTip, regions.head );
            const rubScore = clamp(
                1 - headDistance / regions.head.radius + hand.indexSpeed / Math.max( 24, hand.handSize * 0.24 ),
                0,
                1
            );
            let best = null;

            if( rubScore > 0.34 && !hand.isPinching )
            {
                best = {
                    action: 'rub_head',
                    label: 'Rub head',
                    intensity: rubScore,
                    point: hand.indexTip,
                    hand
                };
            }

            if( hand.isPinching )
            {
                for( const cheek of [regions.leftCheek, regions.rightCheek] )
                {
                    const cheekDistance = distance( hand.pinchCenter, cheek );

                    if( cheekDistance < cheek.radius )
                    {
                        const sideSign = cheek.side === 'left' ? -1 : 1;
                        const outward = Math.max( 0, sideSign * ( hand.pinchCenter.x - cheek.x ) ) / cheek.radius;
                        const intensity = clamp( 1 - cheekDistance / cheek.radius + outward * 0.65, 0, 1 );
                        const candidate = {
                            action: `pull_${ cheek.side }_cheek`,
                            label: cheek.side === 'left' ? 'Pull left cheek' : 'Pull right cheek',
                            intensity,
                            sideSign,
                            point: hand.pinchCenter,
                            hand
                        };

                        if( !best || candidate.intensity > best.intensity )
                        {
                            best = candidate;
                        }
                    }
                }
            }

            if( hand.isOpenPalm )
            {
                const palm = hand.palmCenter;
                const insideScoopX = Math.abs( palm.x - bounds.centerX ) < bounds.width * interactionConfig.scoopWidthRatio;
                const insideScoopY = palm.y > bounds.top + bounds.height * 0.46 && palm.y < bounds.bottom + bounds.height * 0.34;

                if( insideScoopX && insideScoopY )
                {
                    const horizontalScore = 1 - Math.abs( palm.x - bounds.centerX ) / ( bounds.width * interactionConfig.scoopWidthRatio );
                    const verticalScore = 1 - Math.abs( palm.y - ( bounds.bottom + bounds.height * 0.04 ) ) / ( bounds.height * 0.50 );
                    const intensity = clamp( horizontalScore * 0.62 + verticalScore * 0.58, 0, 1 );
                    const candidate = {
                        action: 'scoop_lift',
                        label: 'Scoop lift',
                        intensity,
                        point: palm,
                        hand
                    };

                    if( !best || candidate.intensity > best.intensity )
                    {
                        best = candidate;
                    }
                }
            }

            return best;
        };

        return {
            reset( view )
            {
                previousAction = 'idle';
                effect.lift = 0;
                effect.offsetX = 0;
                effect.scaleBoost = 0;
                effect.roll = 0;
                effect.cheekPull = 0;
                view.setInteraction();
            },

            update( view, handFrame )
            {
                const bounds = view.getMarkerScreenBounds();

                decayEffects();

                if( !handFrame.ready )
                {
                    view.setInteraction( effect );
                    return;
                }

                if( !bounds )
                {
                    view.setInteraction( effect );
                    setGestureStatus( 'waiting_anchor', 'Place character first' );
                    emitAction( { action: 'waiting_anchor', intensity: 0 } );
                    return;
                }

                const regions = getRegions( bounds );
                const hands = handFrame.hands || [];

                if( hands.length === 0 )
                {
                    view.setInteraction( effect );
                    setGestureStatus( 'idle', 'Show hand near character' );
                    emitAction( { action: 'idle', intensity: 0 } );
                    return;
                }

                const best = hands
                    .map( hand => scoreHandAction( hand, bounds, regions ) )
                    .filter( Boolean )
                    .sort( ( a, b ) => b.intensity - a.intensity )[0];

                if( !best )
                {
                    view.setInteraction( effect );
                    setGestureStatus( 'tracking', `${ hands[0].gesture } hand detected` );
                    emitAction( { action: 'tracking', intensity: 0.15, gesture: hands[0].gesture, handedness: hands[0].handedness } );
                    return;
                }

                if( best.action === 'rub_head' )
                {
                    const rubDirection = clamp( ( best.point.x - regions.head.x ) / regions.head.radius, -1, 1 );
                    effect.roll = rubDirection * 0.08 * best.intensity + Math.sin( performance.now() / 60 ) * 0.025 * best.intensity;
                    effect.scaleBoost = Math.max( effect.scaleBoost, 0.035 * best.intensity );
                    effect.lift = Math.max( effect.lift, 0.04 * best.intensity );
                }
                else if( best.action === 'scoop_lift' )
                {
                    effect.lift = Math.max( effect.lift, 0.72 * best.intensity );
                    effect.offsetX = clamp( ( best.point.x - bounds.centerX ) / bounds.width, -0.45, 0.45 ) * 0.55 * best.intensity;
                    effect.scaleBoost = Math.max( effect.scaleBoost, 0.025 * best.intensity );
                }
                else if( best.action.startsWith( 'pull_' ) )
                {
                    effect.cheekPull = best.sideSign * 0.88 * best.intensity;
                    effect.roll = best.sideSign * 0.06 * best.intensity;
                    effect.scaleBoost = Math.max( effect.scaleBoost, 0.05 * best.intensity );
                }

                view.setInteraction( effect );
                setGestureStatus( best.action, `${ best.label } ${ Math.round( best.intensity * 100 ) }%` );
                emitAction( {
                    action: best.action,
                    intensity: best.intensity,
                    gesture: best.hand.gesture,
                    handedness: best.hand.handedness,
                    x: best.point.x,
                    y: best.point.y
                } );
            }
        };
    }

    function createPatchTracker( width, height )
    {
        const radius = Math.max( 16, Math.round( Math.min( width, height ) * 0.042 ) );
        const size = radius * 2 + 1;
        const searchRadius = Math.max( 42, Math.round( Math.min( width, height ) * 0.12 ) );
        const sampleStep = 2;
        const coarseStep = 6;
        const fineStep = 2;
        const templateY = new Float32Array( size * size );
        const templateCb = new Float32Array( size * size );
        const templateCr = new Float32Array( size * size );
        const templateEdge = new Float32Array( size * size );
        const state = {
            active: false,
            x: 0,
            y: 0,
            confidence: 0,
            lost: 0,
            frames: 0
        };

        const grayAt = ( data, x, y ) =>
        {
            const sx = Math.max( 0, Math.min( width - 1, x ) );
            const sy = Math.max( 0, Math.min( height - 1, y ) );
            const i = ( sy * width + sx ) * 4;

            return data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
        };

        const canSample = ( x, y ) => x >= radius && y >= radius && x < width - radius && y < height - radius;

        const featuresAt = ( data, x, y ) =>
        {
            const i = ( y * width + x ) * 4;
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            const yv = r * 0.299 + g * 0.587 + b * 0.114;
            const cb = -0.168736 * r - 0.331264 * g + 0.5 * b + 128;
            const cr = 0.5 * r - 0.418688 * g - 0.081312 * b + 128;
            const gx = grayAt( data, x + 1, y ) - grayAt( data, x - 1, y );
            const gy = grayAt( data, x, y + 1 ) - grayAt( data, x, y - 1 );

            return {
                y: yv,
                cb,
                cr,
                edge: Math.min( 255, Math.abs( gx ) + Math.abs( gy ) )
            };
        };

        const capture = ( frame, x, y ) =>
        {
            if( !canSample( x, y ) )
            {
                return false;
            }

            const data = frame.data;
            let mean = 0;
            let edgeMean = 0;
            let count = 0;

            for( let yy = -radius; yy <= radius; yy++ )
            {
                for( let xx = -radius; xx <= radius; xx++ )
                {
                    const features = featuresAt( data, Math.round( x + xx ), Math.round( y + yy ) );
                    const ti = ( yy + radius ) * size + xx + radius;
                    templateY[ti] = features.y;
                    templateCb[ti] = features.cb;
                    templateCr[ti] = features.cr;
                    templateEdge[ti] = features.edge;
                    mean += features.y;
                    edgeMean += features.edge;
                    count++;
                }
            }

            mean /= count;
            edgeMean /= count;

            let contrast = 0;

            for( let i = 0; i < templateY.length; i++ )
            {
                contrast += Math.abs( templateY[i] - mean );
            }

            return contrast / templateY.length > 5.5 || edgeMean > 9;
        };

        const scoreAt = ( frame, x, y ) =>
        {
            if( !canSample( x, y ) )
            {
                return -Infinity;
            }

            const data = frame.data;
            let error = 0;
            let count = 0;

            for( let yy = -radius; yy <= radius; yy += sampleStep )
            {
                for( let xx = -radius; xx <= radius; xx += sampleStep )
                {
                    const features = featuresAt( data, Math.round( x + xx ), Math.round( y + yy ) );
                    const ti = ( yy + radius ) * size + xx + radius;
                    const yError = Math.abs( features.y - templateY[ti] );
                    const colorError = Math.abs( features.cb - templateCb[ti] ) + Math.abs( features.cr - templateCr[ti] );
                    const edgeError = Math.abs( features.edge - templateEdge[ti] );
                    error += yError * 0.58 + colorError * 0.24 + edgeError * 0.18;
                    count++;
                }
            }

            const distanceFromLast = Math.sqrt( ( x - state.x ) ** 2 + ( y - state.y ) ** 2 );
            const jumpPenalty = Math.min( 0.10, distanceFromLast / Math.max( 1, searchRadius ) * 0.07 );

            return 1 - error / ( count * 255 ) - jumpPenalty;
        };

        const searchBest = ( frame, centerX, centerY, radius, step ) =>
        {
            let best = {
                x: centerX,
                y: centerY,
                score: -Infinity
            };
            let secondScore = -Infinity;

            for( let y = centerY - radius; y <= centerY + radius; y += step )
            {
                for( let x = centerX - radius; x <= centerX + radius; x += step )
                {
                    const score = scoreAt( frame, Math.round( x ), Math.round( y ) );

                    if( score > best.score )
                    {
                        secondScore = best.score;
                        best = {
                            x: Math.round( x ),
                            y: Math.round( y ),
                            score
                        };
                    }
                    else if( score > secondScore )
                    {
                        secondScore = score;
                    }
                }
            }

            best.margin = best.score - secondScore;

            return best;
        };

        return {
            reset()
            {
                state.active = false;
                state.confidence = 0;
                state.lost = 0;
                state.frames = 0;
            },

            lock( frame, anchor )
            {
                const x = Math.round( anchor.x );
                const y = Math.round( anchor.y );

                if( !capture( frame, x, y ) )
                {
                    state.active = false;
                    return {
                        x,
                        y,
                        confidence: anchor.confidence,
                        follow: true
                    };
                }

                state.active = true;
                state.x = x;
                state.y = y;
                state.confidence = Math.max( 0.7, anchor.confidence );
                state.lost = 0;
                state.frames = 0;

                return {
                    x: state.x,
                    y: state.y,
                    confidence: state.confidence,
                    follow: true
                };
            },

            update( frame )
            {
                if( !state.active )
                {
                    return null;
                }

                state.frames++;

                const coarse = searchBest( frame, state.x, state.y, searchRadius, coarseStep );
                const best = searchBest( frame, coarse.x, coarse.y, coarseStep * 2, fineStep );
                const jump = Math.sqrt( ( best.x - state.x ) ** 2 + ( best.y - state.y ) ** 2 );

                if( best.score < 0.53 || ( best.margin < 0.012 && jump > radius * 0.55 ) )
                {
                    state.lost++;

                    if( state.lost > 12 )
                    {
                        state.active = false;
                        return null;
                    }

                    return {
                        x: state.x,
                        y: state.y,
                        confidence: Math.max( 0.2, state.confidence * 0.86 ),
                        follow: true
                    };
                }

                const alpha = best.score > 0.70 && best.margin > 0.018 ? 0.92 : 0.62;
                state.x += ( best.x - state.x ) * alpha;
                state.y += ( best.y - state.y ) * alpha;
                state.confidence = Math.min( 1, Math.max( 0.45, best.score ) );
                state.lost = 0;

                if( state.frames % 18 === 0 && best.score > 0.78 && best.margin > 0.018 )
                {
                    capture( frame, Math.round( state.x ), Math.round( state.y ) );
                }

                return {
                    x: state.x,
                    y: state.y,
                    confidence: state.confidence,
                    follow: true
                };
            }
        };
    }

    function createTreeBaseTracker( width, height )
    {
        const step = Math.max( 4, Math.round( Math.min( width, height ) / 140 ) );
        const columns = Math.ceil( width / step );
        const green = new Float32Array( columns );
        const stem = new Float32Array( columns );
        const soil = new Float32Array( columns );
        const base = new Float32Array( columns );
        const state = {
            frames: 0,
            anchor: null,
            pending: null,
            hits: 0
        };

        const sumRange = ( values, center, radius ) =>
        {
            let total = 0;
            const from = Math.max( 0, center - radius );
            const to = Math.min( values.length - 1, center + radius );

            for( let i = from; i <= to; i++ )
            {
                total += values[i];
            }

            return total;
        };

        const isGreen = ( r, g, b ) =>
        {
            const max = Math.max( r, g, b );
            const min = Math.min( r, g, b );

            return g === max && g > 45 && max - min > 18 && g > r * 1.08 && g > b * 1.03;
        };

        const isStem = ( r, g, b ) =>
        {
            const max = Math.max( r, g, b );
            const min = Math.min( r, g, b );
            const brightness = r + g + b;
            const greenish = g >= Math.max( r, b ) && g > 35 && max - min > 12;
            const brownish = r >= g * 0.75 && g >= b * 0.75 && brightness < 310;

            return greenish || brownish;
        };

        const isSoil = ( r, g, b ) =>
        {
            const max = Math.max( r, g, b );
            const min = Math.min( r, g, b );
            const brightness = r + g + b;

            return brightness < 245 && max - min < 90;
        };

        const refineBaseY = ( frame, x ) =>
        {
            const data = frame.data;
            const xMin = Math.max( 0, x - width * 0.045 );
            const xMax = Math.min( width - 1, x + width * 0.045 );
            const yStart = Math.round( height * 0.34 );
            const yEnd = Math.round( height * 0.84 );

            for( let y = yStart; y < yEnd; y += step )
            {
                let soilCount = 0;
                let plantAboveCount = 0;

                for( let yy = y; yy < Math.min( height, y + height * 0.055 ); yy += step )
                {
                    for( let xx = xMin; xx <= xMax; xx += step )
                    {
                        const i = ( Math.round( yy ) * width + Math.round( xx ) ) * 4;
                        soilCount += isSoil( data[i], data[i + 1], data[i + 2] ) ? 1 : 0;
                    }
                }

                for( let yy = Math.max( 0, y - height * 0.20 ); yy < y; yy += step )
                {
                    for( let xx = Math.max( 0, x - width * 0.018 ); xx <= Math.min( width - 1, x + width * 0.018 ); xx += step )
                    {
                        const i = ( Math.round( yy ) * width + Math.round( xx ) ) * 4;
                        plantAboveCount += isStem( data[i], data[i + 1], data[i + 2] ) ? 1 : 0;
                    }
                }

                if( soilCount >= 5 && plantAboveCount >= 4 )
                {
                    return y;
                }
            }

            return height * 0.58;
        };

        return {
            reset()
            {
                state.frames = 0;
                state.anchor = null;
                state.pending = null;
                state.hits = 0;
            },

            update( frame )
            {
                state.frames++;

                if( state.frames % 4 !== 0 )
                {
                    return null;
                }

                green.fill( 0 );
                stem.fill( 0 );
                soil.fill( 0 );
                base.fill( 0 );

                const data = frame.data;
                const yTop = Math.round( height * 0.12 );
                const yBottom = Math.round( height * 0.88 );

                for( let y = yTop; y < yBottom; y += step )
                {
                    for( let x = Math.round( width * 0.08 ); x < Math.round( width * 0.92 ); x += step )
                    {
                        const col = Math.min( columns - 1, Math.floor( x / step ) );
                        const i = ( y * width + x ) * 4;
                        const r = data[i];
                        const g = data[i + 1];
                        const b = data[i + 2];

                        if( y < height * 0.76 && isGreen( r, g, b ) )
                        {
                            green[col] += 1 + y / height;
                        }

                        if( y > height * 0.18 && y < height * 0.82 && isStem( r, g, b ) )
                        {
                            stem[col] += 1;
                            base[col] = Math.max( base[col], y );
                        }

                        if( y > height * 0.38 && isSoil( r, g, b ) )
                        {
                            soil[col] += 1;
                        }
                    }
                }

                let best = null;

                for( let col = 2; col < columns - 2; col++ )
                {
                    if( base[col] < height * 0.30 || base[col] > height * 0.86 )
                    {
                        continue;
                    }

                    const localGreen = sumRange( green, col, 5 );
                    const localStem = sumRange( stem, col, 2 );
                    const localSoil = sumRange( soil, col, 8 );
                    const wideGreen = sumRange( green, col, 14 );
                    const narrowness = localStem / Math.max( 1, wideGreen );
                    const x = col * step;
                    const centerBias = 1 - Math.min( 0.55, Math.abs( x / width - 0.5 ) );
                    const score = ( localGreen * 0.15 + localStem * 1.2 + localSoil * 0.45 ) * centerBias * ( 0.7 + narrowness );

                    if( score > 28 && ( !best || score > best.score ) )
                    {
                        best = {
                            x,
                            y: refineBaseY( frame, x ),
                            score
                        };
                    }
                }

                if( !best )
                {
                    return null;
                }

                const confidence = Math.min( 1, best.score / 95 );
                const candidate = {
                    x: best.x,
                    y: best.y,
                    confidence
                };

                if( state.pending )
                {
                    const dx = candidate.x - state.pending.x;
                    const dy = candidate.y - state.pending.y;
                    const distance = Math.sqrt( dx * dx + dy * dy );
                    state.hits = distance < width * 0.12 ? state.hits + 1 : 1;
                }
                else
                {
                    state.hits = 1;
                }

                state.pending = candidate;

                if( state.hits >= 2 )
                {
                    if( state.anchor )
                    {
                        state.anchor.x += ( candidate.x - state.anchor.x ) * 0.12;
                        state.anchor.y += ( candidate.y - state.anchor.y ) * 0.12;
                        state.anchor.confidence = Math.max( state.anchor.confidence * 0.95, confidence );
                    }
                    else
                    {
                        state.anchor = candidate;
                    }

                    return state.anchor;
                }

                return null;
            }
        };
    }

    async function demo( media )
    {
        const $video = media.el;

        const size = resize2cover( $video.videoWidth, $video.videoHeight, $container.clientWidth, $container.clientHeight );

        $canvas.width = $container.clientWidth;
        $canvas.height = $container.clientHeight;
        $occlusion.width = $container.clientWidth;
        $occlusion.height = $container.clientHeight;
        $occlusion.style.pointerEvents = 'none';
        $video.style.width = size.width + 'px';
        $video.style.height = size.height + 'px';

        const ctx = $canvas.getContext( '2d', { alpha: false, desynchronized: true, willReadFrequently: true } );
        const occlusionCtx = $occlusion.getContext( '2d' );
        const occlusionFrame = occlusionCtx.createImageData( $occlusion.width, $occlusion.height );
        const alva = await AlvaAR.Initialize( $canvas.width, $canvas.height );
        const view = new ARCamView( $view, $canvas.width, $canvas.height );
        const treeBaseTracker = createTreeBaseTracker( $canvas.width, $canvas.height );
        const patchTracker = createPatchTracker( $canvas.width, $canvas.height );
        const characterInteraction = createCharacterInteraction();
        const gestureTracker = createHandGestureTracker( $canvas, enabled =>
        {
            $handToggle.setAttribute( 'aria-pressed', enabled ? 'true' : 'false' );
            $handToggle.textContent = enabled ? 'Hand On' : 'Hand';
        } );
        let requestedAnchor = null;

        Stats.add( 'total' );
        Stats.add( 'video' );
        Stats.add( 'slam' );

        $container.appendChild( $canvas );
        $container.appendChild( $view );
        $container.appendChild( $occlusion );

        document.body.appendChild( Stats.el );
        const resetPlacement = () =>
        {
            requestedAnchor = null;
            view.resetAnchor();
            treeBaseTracker.reset();
            patchTracker.reset();
            characterInteraction.reset( view );
        };

        const resetTracking = () =>
        {
            alva.reset();
            resetPlacement();
            gestureTracker.reset();
        };

        const requestAnchorAt = ( clientX, clientY ) =>
        {
            const containerRect = $container.getBoundingClientRect();
            const x = clientX - containerRect.left;
            const y = clientY - containerRect.top;

            resetPlacement();
            requestedAnchor = {
                x: Math.max( 0, Math.min( $canvas.width, x ) ),
                y: Math.max( 0, Math.min( $canvas.height, y ) ),
                confidence: 1,
                follow: true
            };
        };

        const requestButtonAnchor = () =>
        {
            const buttonRect = $placeImage.getBoundingClientRect();
            const x = buttonRect.left + buttonRect.width / 2;
            const y = buttonRect.top + buttonRect.height / 2;

            requestAnchorAt( x, y );
        };

        $placeImage.hidden = false;
        $handToggle.hidden = false;
        $container.addEventListener( 'pointerup', event =>
        {
            if( !event.isPrimary )
            {
                return;
            }

            requestAnchorAt( event.clientX, event.clientY );
        }, false );
        $container.addEventListener( 'dblclick', event =>
        {
            event.stopPropagation();
            resetTracking();
        }, false );
        $placeImage.addEventListener( "click", event =>
        {
            event.stopPropagation();
            requestButtonAnchor();
        }, false );
        $handToggle.addEventListener( "click", event =>
        {
            event.stopPropagation();

            if( gestureTracker.enabled )
            {
                gestureTracker.disable();
                characterInteraction.reset( view );
                return;
            }

            gestureTracker.enable();
        }, false );

        onFrame( () =>
        {
            Stats.next();
            Stats.start( 'total' );

            ctx.clearRect( 0, 0, $canvas.width, $canvas.height );

            if( !document['hidden'] )
            {
                Stats.start( 'video' );
                ctx.drawImage( $video, 0, 0, $video.videoWidth, $video.videoHeight, size.x, size.y, size.width, size.height );
                gestureTracker.processFrame( performance.now() );
                const frame = ctx.getImageData( 0, 0, $canvas.width, $canvas.height );
                Stats.stop( 'video' );

                Stats.start( 'slam' );
                const pose = alva.findCameraPose( frame );
                Stats.stop( 'slam' );

                if( pose )
                {
                    let anchor = null;

                    if( requestedAnchor )
                    {
                        anchor = patchTracker.lock( frame, requestedAnchor );
                    }
                    else
                    {
                        anchor = patchTracker.update( frame );
                    }

                    if( !anchor )
                    {
                        anchor = view.isAnchorLocked() ? null : treeBaseTracker.update( frame );
                    }

                    requestedAnchor = null;
                    view.updateCameraPose( pose, anchor );
                    characterInteraction.update( view, gestureTracker.update() );
                    renderLeafOcclusion( frame, occlusionCtx, occlusionFrame );
                }
                else
                {
                    view.lostCamera();
                    view.setInteraction();
                    occlusionCtx.clearRect( 0, 0, $occlusion.width, $occlusion.height );

                    const dots = alva.getFramePoints();

                    for( const p of dots )
                    {
                        ctx.fillStyle = 'white';
                        ctx.fillRect( p.x, p.y, 2, 2 );
                    }
                }
            }
            else
            {
                occlusionCtx.clearRect( 0, 0, $occlusion.width, $occlusion.height );
            }

            Stats.stop( 'total' );
            Stats.render();

            return true;
        }, 30 );
    }

    setTimeout( () =>
    {
        $splash.remove();
    }, splashFadeTime );

    $start.addEventListener( 'click', () =>
    {
        $overlay.remove();

        Camera.Initialize( config ).then( media => demo( media ) ).catch( error => alert( 'Camera ' + error ) );

    }, { once: true } );
}
