import * as THREE from 'https://threejsfundamentals.org/threejs/resources/threejs/r132/build/three.module.js';
import { OrbitControls } from 'https://threejsfundamentals.org/threejs/resources/threejs/r132/examples/jsm/controls/OrbitControls.js';
import { AlvaARConnectorTHREE } from './alva_ar_three.js'

const AR_CHARACTER_SPRITE_EVENT = 'archaractersprite';
const AR_CHARACTER_SPRITE_SET_EVENT = 'archaracterspriteset';
const AR_CHARACTER_DEFAULT_CROP = {
    x: 0.16,
    y: 0,
    width: 0.72,
    height: 0.94
};
const AR_CHARACTER_DEFAULT_SPRITES = {
    idle: {
        url: './ar-character-idle.png?v=20260423-alpha',
        columns: 4,
        rows: 8,
        frameCount: 30,
        fps: 7,
        loop: true,
        crop: AR_CHARACTER_DEFAULT_CROP
    },
    sunlight: {
        url: './ar-character-sunlight.png?v=20260423-alpha',
        columns: 4,
        rows: 8,
        frameCount: 30,
        fps: 8,
        loop: false,
        crop: AR_CHARACTER_DEFAULT_CROP
    },
    talking: {
        url: './ar-character-talking.png?v=20260423-alpha',
        columns: 4,
        rows: 8,
        frameCount: 30,
        fps: 9,
        loop: true,
        crop: AR_CHARACTER_DEFAULT_CROP
    },
    water: {
        url: './ar-character-water.png?v=20260423-alpha',
        columns: 4,
        rows: 8,
        frameCount: 30,
        fps: 8,
        loop: false,
        crop: AR_CHARACTER_DEFAULT_CROP
    }
};
const AR_CHARACTER_SPRITES = {};

function normalizeSpriteConfig( sprite, fallback )
{
    if( !sprite || !sprite.url )
    {
        return { ...fallback, crop: { ...fallback.crop } };
    }

    return {
        ...fallback,
        ...sprite,
        columns: Number( sprite.columns ) || fallback.columns,
        rows: Number( sprite.rows ) || fallback.rows,
        frameCount: Number( sprite.frameCount || sprite.frame_count ) || fallback.frameCount,
        fps: Number( sprite.fps ) || fallback.fps,
        loop: typeof sprite.loop === 'boolean' ? sprite.loop : fallback.loop,
        crop: { ...AR_CHARACTER_DEFAULT_CROP, ...( sprite.crop || {} ) }
    };
}

function applyRuntimeSprites( sprites = null )
{
    for( const [ state, fallback ] of Object.entries( AR_CHARACTER_DEFAULT_SPRITES ) )
    {
        AR_CHARACTER_SPRITES[state] = normalizeSpriteConfig( sprites?.[state], fallback );
    }
}

applyRuntimeSprites( window.__AR_COMPANION_SPRITES__ || null );

class ARCamView
{
    constructor( container, width, height, x = 0, y = 0, z = -10, scale = 1.0)
    {
        this.applyPose = AlvaARConnectorTHREE.Initialize( THREE );
        this.width = width;
        this.height = height;
        this.anchorDistance = Math.abs( z );
        this.anchorPosition = new THREE.Vector3( x, y, z );
        this.anchorReady = false;
        this.anchorLocked = false;
        this.anchorUpdates = 0;
        this.rayPoint = new THREE.Vector3();
        this.rayDirection = new THREE.Vector3();
        this.cameraUp = new THREE.Vector3();
        this.cameraRight = new THREE.Vector3();
        this.baseScale = new THREE.Vector3( scale, scale, scale );
        this.spriteTexture = null;
        this.spriteTextureState = null;
        this.spriteTextureCache = new Map();
        this.spriteLoadToken = 0;
        this.markerScale = scale;
        this.spriteState = 'idle';
        this.spriteStateStartedAt = performance.now();
        this.sprite = this.createSpriteState( 'idle' );
        this.interaction = {
            lift: 0,
            offsetX: 0,
            scaleBoost: 0,
            roll: 0,
            cheekPull: 0
        };
        this.handleSpriteStateEvent = event =>
        {
            const state = event.detail?.state || event.detail?.action;
            this.setSpriteState( state );
        };
        this.handleSpriteSetEvent = event =>
        {
            applyRuntimeSprites( event.detail?.sprites || null );
            this.spriteTextureCache.clear();
            this.sprite = this.createSpriteState( this.spriteState );
            this.loadSpriteTexture();
        };

        this.renderer = new THREE.WebGLRenderer( { antialias: true, alpha: true } );
        this.renderer.setClearColor( 0, 0 );
        this.renderer.setSize( width, height );
        this.renderer.setPixelRatio( window.devicePixelRatio );

        this.camera = new THREE.PerspectiveCamera( 75, width / height, 0.1, 1000 );
        this.camera.rotation.reorder( 'YXZ' );
        this.camera.updateProjectionMatrix();

        const markerGeometry = new THREE.PlaneGeometry( 1, 1 );
        markerGeometry.translate( 0, 0.5, 0 );

        this.object = new THREE.Mesh(
            markerGeometry,
            new THREE.MeshBasicMaterial( {
                transparent: true,
                side: THREE.DoubleSide,
                depthWrite: false
            } )
        );
        this.object.scale.set( scale, scale, scale );
        this.baseScale.copy( this.object.scale );
        this.object.position.set( x, y, z );
        this.object.visible = false;
        this.loadSpriteTexture();

        this.scene = new THREE.Scene();
        this.scene.add( new THREE.AmbientLight( 0x808080 ) );
        this.scene.add( new THREE.HemisphereLight( 0x404040, 0xf0f0f0, 1 ) );
        this.scene.add( this.camera );
        this.scene.add( this.object );

        container.appendChild( this.renderer.domElement );
        window.addEventListener( AR_CHARACTER_SPRITE_EVENT, this.handleSpriteStateEvent );
        window.addEventListener( AR_CHARACTER_SPRITE_SET_EVENT, this.handleSpriteSetEvent );

        const render = () =>
        {
            requestAnimationFrame( render.bind( this ) );

            this.updateSpriteFrame( performance.now() );
            this.renderer.render( this.scene, this.camera );
        }

        render();
    }

    createSpriteState( state )
    {
        const sprite = AR_CHARACTER_SPRITES[state] || AR_CHARACTER_SPRITES.idle;

        return {
            ...sprite,
            currentFrame: -1,
            crop: { ...sprite.crop }
        };
    }

    normalizeSpriteState( state )
    {
        if( state === 'sun' )
        {
            return 'sunlight';
        }

        if( state === 'default' || state === 'move' || state === 'move-a-little' )
        {
            return 'idle';
        }

        return AR_CHARACTER_SPRITES[state] ? state : 'idle';
    }

    setSpriteState( state )
    {
        const nextState = this.normalizeSpriteState( state );

        if( nextState === this.spriteState )
        {
            return;
        }

        this.spriteState = nextState;
        this.spriteStateStartedAt = performance.now();
        this.sprite = this.createSpriteState( nextState );
        this.loadSpriteTexture();
    }

    loadSpriteTexture()
    {
        const cacheKey = this.spriteState;
        const cached = this.spriteTextureCache.get( cacheKey );

        if( cached )
        {
            this.applySpriteTexture( cached.texture, cached.frameAspectRatio );
            return;
        }

        const spriteUrl = new URL( this.sprite.url, import.meta.url ).href;
        const loadToken = ++this.spriteLoadToken;

        new THREE.TextureLoader().load( spriteUrl, ( sourceTexture ) =>
        {
            const sprite = AR_CHARACTER_SPRITES[cacheKey];
            const texture = this.createColorKeyedSpriteTexture( sourceTexture.image, sprite );
            const frameAspectRatio = (
                sourceTexture.image.width / sprite.columns * sprite.crop.width
            ) / (
                sourceTexture.image.height / sprite.rows * sprite.crop.height
            );

            texture.encoding = THREE.sRGBEncoding;
            texture.wrapS = THREE.ClampToEdgeWrapping;
            texture.wrapT = THREE.ClampToEdgeWrapping;
            texture.minFilter = THREE.LinearFilter;
            texture.magFilter = THREE.LinearFilter;
            texture.generateMipmaps = false;

            this.spriteTextureCache.set( cacheKey, { texture, frameAspectRatio } );

            if( loadToken === this.spriteLoadToken && cacheKey === this.spriteState )
            {
                this.applySpriteTexture( texture, frameAspectRatio );
            }

            sourceTexture.dispose();
        }, undefined, ( error ) =>
        {
            console.warn( `Could not load AR character sprite: ${ spriteUrl }`, error );
        } );
    }

    applySpriteTexture( texture, frameAspectRatio )
    {
        this.spriteTexture = texture;
        this.spriteTextureState = this.spriteState;
        this.spriteStateStartedAt = performance.now();
        this.sprite.currentFrame = -1;
        this.object.material.map = texture;
        this.object.material.needsUpdate = true;
        this.object.scale.set( this.markerScale * frameAspectRatio * 2.2, this.markerScale * 2.2, this.markerScale );
        this.baseScale.copy( this.object.scale );
        this.updateSpriteFrame( performance.now(), true );
    }

    createColorKeyedSpriteTexture( image, sprite )
    {
        const canvas = document.createElement( 'canvas' );
        canvas.width = image.width;
        canvas.height = image.height;

        const ctx = canvas.getContext( '2d' );
        ctx.drawImage( image, 0, 0 );

        const pixels = ctx.getImageData( 0, 0, canvas.width, canvas.height );
        const data = pixels.data;
        let transparentPixels = 0;

        for( let index = 3; index < data.length; index += 4 )
        {
            if( data[index] < 16 )
            {
                data[index] = 0;
                transparentPixels++;
            }
        }

        if( transparentPixels / ( data.length / 4 ) > 0.05 )
        {
            ctx.putImageData( pixels, 0, 0 );
            return new THREE.CanvasTexture( canvas );
        }

        const maxCellWidth = Math.ceil( canvas.width / sprite.columns );
        const maxCellHeight = Math.ceil( canvas.height / sprite.rows );
        const queue = new Int32Array( maxCellWidth * maxCellHeight );
        const visited = new Uint8Array( maxCellWidth * maxCellHeight );

        const isBackgroundKeyCandidate = index =>
        {
            if( data[index + 3] < 16 )
            {
                return true;
            }

            const r = data[index];
            const g = data[index + 1];
            const b = data[index + 2];
            const max = Math.max( r, g, b );
            const min = Math.min( r, g, b );
            const chroma = max - min;
            const brightness = ( r + g + b ) / 3;
            const neutral = chroma <= 14;
            const nearBlack = max <= 18 && chroma <= 18;

            return nearBlack || neutral && (
                ( brightness >= 105 && brightness <= 210 ) ||
                brightness >= 235
            );
        };

        for( let cellRow = 0; cellRow < sprite.rows; cellRow++ )
        {
            for( let cellColumn = 0; cellColumn < sprite.columns; cellColumn++ )
            {
                const x0 = Math.floor( cellColumn * canvas.width / sprite.columns );
                const x1 = Math.floor( ( cellColumn + 1 ) * canvas.width / sprite.columns );
                const y0 = Math.floor( cellRow * canvas.height / sprite.rows );
                const y1 = Math.floor( ( cellRow + 1 ) * canvas.height / sprite.rows );
                const cellWidth = x1 - x0;
                const cellHeight = y1 - y0;
                const cellSize = cellWidth * cellHeight;
                let head = 0;
                let tail = 0;

                visited.fill( 0, 0, cellSize );

                const getPixelIndex = localIndex =>
                {
                    const y = Math.floor( localIndex / cellWidth );
                    const x = localIndex - y * cellWidth;

                    return ( ( y0 + y ) * canvas.width + x0 + x ) * 4;
                };

                const enqueue = localIndex =>
                {
                    if( visited[localIndex] )
                    {
                        return;
                    }

                    if( !isBackgroundKeyCandidate( getPixelIndex( localIndex ) ) )
                    {
                        return;
                    }

                    visited[localIndex] = 1;
                    queue[tail++] = localIndex;
                };

                for( let x = 0; x < cellWidth; x++ )
                {
                    enqueue( x );
                    enqueue( ( cellHeight - 1 ) * cellWidth + x );
                }

                for( let y = 1; y < cellHeight - 1; y++ )
                {
                    enqueue( y * cellWidth );
                    enqueue( y * cellWidth + cellWidth - 1 );
                }

                while( head < tail )
                {
                    const localIndex = queue[head++];
                    const x = localIndex % cellWidth;
                    const y = ( localIndex - x ) / cellWidth;

                    data[getPixelIndex( localIndex ) + 3] = 0;

                    if( x > 0 )
                    {
                        enqueue( localIndex - 1 );
                    }
                    if( x < cellWidth - 1 )
                    {
                        enqueue( localIndex + 1 );
                    }
                    if( y > 0 )
                    {
                        enqueue( localIndex - cellWidth );
                    }
                    if( y < cellHeight - 1 )
                    {
                        enqueue( localIndex + cellWidth );
                    }
                }
            }
        }

        ctx.putImageData( pixels, 0, 0 );

        return new THREE.CanvasTexture( canvas );
    }

    updateSpriteFrame( time, force = false )
    {
        if( !this.spriteTexture || this.spriteTextureState !== this.spriteState )
        {
            return;
        }

        const elapsed = Math.max( 0, time - this.spriteStateStartedAt );
        let frame = Math.floor( elapsed / 1000 * this.sprite.fps );

        if( this.sprite.loop )
        {
            frame %= this.sprite.frameCount;
        }
        else if( frame >= this.sprite.frameCount )
        {
            this.setSpriteState( 'idle' );
            return;
        }

        if( !force && frame === this.sprite.currentFrame )
        {
            return;
        }

        const column = frame % this.sprite.columns;
        const row = Math.floor( frame / this.sprite.columns );
        const crop = this.sprite.crop;

        this.spriteTexture.repeat.set( crop.width / this.sprite.columns, crop.height / this.sprite.rows );
        this.spriteTexture.offset.set(
            ( column + crop.x ) / this.sprite.columns,
            1 - ( row + crop.y + crop.height ) / this.sprite.rows
        );
        this.sprite.currentFrame = frame;
    }

    updateCameraPose( pose, anchor = null )
    {
        this.applyPose( pose, this.camera.quaternion, this.camera.position );

        if( anchor && ( !this.anchorLocked || anchor.follow ) )
        {
            this.updateAnchorFromScreen( anchor, true );
        }

        if( this.anchorReady )
        {
            this.applyMarkerTransform();
        }
        else
        {
            this.object.visible = false;
        }
    }

    lostCamera()
    {
        this.object.visible = false;
    }

    setInteraction( interaction = {} )
    {
        this.interaction = {
            lift: interaction.lift || 0,
            offsetX: interaction.offsetX || 0,
            scaleBoost: interaction.scaleBoost || 0,
            roll: interaction.roll || 0,
            cheekPull: interaction.cheekPull || 0
        };

        if( this.anchorReady )
        {
            this.applyMarkerTransform();
        }
    }

    applyMarkerTransform()
    {
        const lift = this.interaction.lift;
        const offsetX = this.interaction.offsetX;
        const scaleBoost = this.interaction.scaleBoost;
        const cheekPull = this.interaction.cheekPull;

        this.cameraUp.set( 0, 1, 0 ).applyQuaternion( this.camera.quaternion );
        this.cameraRight.set( 1, 0, 0 ).applyQuaternion( this.camera.quaternion );
        this.object.position.copy( this.anchorPosition );
        this.object.position.addScaledVector( this.cameraUp, lift );
        this.object.position.addScaledVector( this.cameraRight, offsetX + cheekPull * 0.16 );
        this.object.quaternion.copy( this.camera.quaternion );

        if( this.interaction.roll )
        {
            this.object.rotateZ( this.interaction.roll );
        }

        this.object.scale.set(
            this.baseScale.x * ( 1 + scaleBoost + Math.abs( cheekPull ) * 0.08 ),
            this.baseScale.y * ( 1 + scaleBoost * 0.55 ),
            this.baseScale.z
        );
        this.object.visible = true;
    }

    getMarkerScreenBounds()
    {
        if( !this.object.visible )
        {
            return null;
        }

        const corners = [
            new THREE.Vector3( -0.5, 0, 0 ),
            new THREE.Vector3( 0.5, 0, 0 ),
            new THREE.Vector3( -0.5, 1, 0 ),
            new THREE.Vector3( 0.5, 1, 0 )
        ];
        let left = Infinity;
        let right = -Infinity;
        let top = Infinity;
        let bottom = -Infinity;

        this.object.updateMatrixWorld( true );

        for( const corner of corners )
        {
            corner.applyMatrix4( this.object.matrixWorld ).project( this.camera );

            const x = ( corner.x * 0.5 + 0.5 ) * this.width;
            const y = ( -corner.y * 0.5 + 0.5 ) * this.height;

            left = Math.min( left, x );
            right = Math.max( right, x );
            top = Math.min( top, y );
            bottom = Math.max( bottom, y );
        }

        return {
            left,
            right,
            top,
            bottom,
            width: Math.max( 1, right - left ),
            height: Math.max( 1, bottom - top ),
            centerX: ( left + right ) * 0.5,
            centerY: ( top + bottom ) * 0.5
        };
    }

    resetAnchor()
    {
        this.anchorReady = false;
        this.anchorLocked = false;
        this.anchorUpdates = 0;
        this.setInteraction();
        this.object.visible = false;
    }

    isAnchorLocked()
    {
        return this.anchorLocked;
    }

    updateAnchorFromScreen( anchor, lock = false )
    {
        if( anchor.confidence < 0.4 )
        {
            return false;
        }

        if( this.anchorLocked && !lock )
        {
            return false;
        }

        const ndcX = ( anchor.x / this.width ) * 2 - 1;
        const ndcY = -( anchor.y / this.height ) * 2 + 1;

        this.rayPoint.set( ndcX, ndcY, 0.5 ).unproject( this.camera );
        this.rayDirection.copy( this.rayPoint ).sub( this.camera.position ).normalize();

        const target = this.camera.position.clone().addScaledVector( this.rayDirection, this.anchorDistance );

        if( !this.anchorReady || lock )
        {
            this.anchorPosition.copy( target );
            this.anchorReady = true;
            this.anchorLocked = lock;
            this.anchorUpdates = 1;
            return true;
        }

        const alpha = this.anchorUpdates < 12 ? 0.18 : 0.035;
        this.anchorPosition.lerp( target, Math.min( 0.22, alpha * anchor.confidence ) );
        this.anchorUpdates++;

        return true;
    }
}

class ARCamIMUView
{
    constructor( container, width, height )
    {
        this.applyPose = AlvaARConnectorTHREE.Initialize( THREE );

        this.renderer = new THREE.WebGLRenderer( { antialias: true, alpha: true } );
        this.renderer.setClearColor( 0, 0 );
        this.renderer.setSize( width, height );
        this.renderer.setPixelRatio( window.devicePixelRatio );

        this.camera = new THREE.PerspectiveCamera( 60, width / height, 0.01, 1000 );

        this.raycaster = new THREE.Raycaster();

        this.ground = new THREE.Mesh(
            new THREE.CircleGeometry( 1000, 64 ),
            new THREE.MeshBasicMaterial( {
                color: 0xffffff,
                transparent: true,
                depthTest: true,
                opacity: 0.1,
                side: THREE.DoubleSide
            } )
        );

        this.ground.rotation.x = Math.PI / 2; // 90 deg
        this.ground.position.y = -10;

        this.scene = new THREE.Scene();
        this.scene.add( new THREE.AmbientLight( 0x808080 ) );
        this.scene.add( new THREE.HemisphereLight( 0x404040, 0xf0f0f0, 1 ) );
        this.scene.add( this.ground );
        this.scene.add( this.camera );

        container.appendChild( this.renderer.domElement );

        const render = () =>
        {
            requestAnimationFrame( render.bind( this ) );

            this.renderer.render( this.scene, this.camera );
        }

        render();
    }

    updateCameraPose( pose )
    {
        this.applyPose( pose, this.camera.quaternion, this.camera.position );

        this.ground.position.x = this.camera.position.x;
        this.ground.position.z = this.camera.position.z;

        this.scene.children.forEach( obj => obj.visible = true );
    }

    lostCamera()
    {
        this.scene.children.forEach( obj => obj.visible = false );
    }

    addObjectAt( x, y, scale = 1.0 )
    {
        const el = this.renderer.domElement;

        const coord = new THREE.Vector2( (x / el.offsetWidth) * 2 - 1, -(y / el.offsetHeight) * 2 + 1 );

        this.raycaster.setFromCamera( coord, this.camera );

        const intersections = this.raycaster.intersectObjects( [this.ground] );

        if( intersections.length > 0 )
        {
            const point = intersections[0].point;

            const object = new THREE.Mesh(
                new THREE.IcosahedronGeometry( 1, 0 ),
                new THREE.MeshNormalMaterial( { flatShading: true } )
            );

            object.scale.set( scale, scale, scale );
            object.position.set( point.x, point.y, point.z );
            object.custom = true;

            this.scene.add( object );
        }
    }

    reset()
    {
        this.scene.children.filter( o => o.custom ).forEach( o => this.scene.remove( o ) );
    }
}

class ARSimpleView
{
    constructor( container, width, height, mapView = null )
    {
        this.applyPose = AlvaARConnectorTHREE.Initialize( THREE );

        this.renderer = new THREE.WebGLRenderer( { antialias: true, alpha: true } );
        this.renderer.setClearColor( 0, 0 );
        this.renderer.setSize( width, height );
        this.renderer.setPixelRatio( window.devicePixelRatio );

        this.camera = new THREE.PerspectiveCamera( 75, width / height, 0.1, 1000 );
        this.camera.rotation.reorder( 'YXZ' );
        this.camera.updateProjectionMatrix();

        this.scene = new THREE.Scene();
        this.scene.add( new THREE.AmbientLight( 0x808080 ) );
        this.scene.add( new THREE.HemisphereLight( 0x404040, 0xf0f0f0, 1 ) );
        this.scene.add( this.camera );

        this.body = document.body;

        container.appendChild( this.renderer.domElement );

        if( mapView )
        {
            this.mapView = mapView;
            this.mapView.camHelper = new THREE.CameraHelper( this.camera );
            this.mapView.scene.add( this.mapView.camHelper );
        }
    }

    updateCameraPose( pose )
    {
        this.applyPose( pose, this.camera.quaternion, this.camera.position );

        this.renderer.render( this.scene, this.camera );

        this.body.classList.add( "tracking" );
    }

    lostCamera()
    {
        this.body.classList.remove( "tracking" );
    }

    createObjectWithPose( pose, scale = 1.0 )
    {
        const plane = new THREE.Mesh( new THREE.PlaneGeometry( scale, scale ), new THREE.MeshBasicMaterial( {
            color: 0xffffff,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.1
        } ) );

        scale *= 0.25;

        const cube = new THREE.Mesh( new THREE.BoxGeometry( scale, scale, scale ), new THREE.MeshNormalMaterial( { flatShading: true } ) );
        cube.position.z = scale * 0.5;

        plane.add( cube );
        plane.custom = true;

        this.applyPose( pose, plane.quaternion, plane.position );
        this.scene.add( plane );

        if( this.mapView )
        {
            this.mapView.scene.add( plane.clone() );
        }
    }

    reset()
    {
        this.scene.children.filter( o => o.custom ).forEach( o => this.scene.remove( o ) );

        if( this.mapView )
        {
            this.mapView.scene.children.filter( o => o.custom ).forEach( o => this.mapView.scene.remove( o ) );
        }
    }
}

class ARSimpleMap
{
    constructor( container, width, height )
    {
        this.renderer = new THREE.WebGLRenderer( { antialias: false } );
        this.renderer.setClearColor( new THREE.Color( 'rgb(255, 255, 255)' ) );
        this.renderer.setPixelRatio( window.devicePixelRatio );
        this.renderer.setSize( width, height, false );
        this.renderer.domElement.style.width = width + 'px';
        this.renderer.domElement.style.height = height + 'px';

        this.camera = new THREE.PerspectiveCamera( 50, width / height, 0.01, 1000 );
        this.camera.position.set( -1, 2, 2 );

        this.controls = new OrbitControls( this.camera, this.renderer.domElement, );
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.1;
        this.controls.minDistance = 0.1;
        this.controls.maxDistance = 1000;

        this.gridHelper = new THREE.GridHelper( 150, 100 );
        this.gridHelper.position.y = -1;

        this.axisHelper = new THREE.AxesHelper( 0.25 );

        this.camHelper = null;

        this.scene = new THREE.Scene();
        this.scene.add( new THREE.AmbientLight( 0xefefef ) );
        this.scene.add( new THREE.HemisphereLight( 0x404040, 0xf0f0f0, 1 ) );
        this.scene.add( this.gridHelper );
        this.scene.add( this.axisHelper );

        container.appendChild( this.renderer.domElement );

        const render = () =>
        {
            this.controls.update();
            this.renderer.render( this.scene, this.camera );

            requestAnimationFrame( render );
        }

        render();
    }
}

export { ARCamView, ARCamIMUView, ARSimpleView, ARSimpleMap }
