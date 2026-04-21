import * as THREE from 'https://threejsfundamentals.org/threejs/resources/threejs/r132/build/three.module.js';
import { OrbitControls } from 'https://threejsfundamentals.org/threejs/resources/threejs/r132/examples/jsm/controls/OrbitControls.js';
import { AlvaARConnectorTHREE } from './alva_ar_three.js'

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
        this.sprite = {
            columns: 4,
            rows: 5,
            frameCount: 17,
            fps: 7,
            currentFrame: -1,
            crop: {
                x: 0.30,
                y: 0.14,
                width: 0.42,
                height: 0.72
            }
        };
        this.interaction = {
            lift: 0,
            offsetX: 0,
            scaleBoost: 0,
            roll: 0,
            cheekPull: 0
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
        this.loadSpriteTexture( scale );

        this.scene = new THREE.Scene();
        this.scene.add( new THREE.AmbientLight( 0x808080 ) );
        this.scene.add( new THREE.HemisphereLight( 0x404040, 0xf0f0f0, 1 ) );
        this.scene.add( this.camera );
        this.scene.add( this.object );

        container.appendChild( this.renderer.domElement );

        const render = () =>
        {
            requestAnimationFrame( render.bind( this ) );

            this.updateSpriteFrame( performance.now() );
            this.renderer.render( this.scene, this.camera );
        }

        render();
    }

    loadSpriteTexture( scale )
    {
        const spriteUrl = new URL( './demo-character-sprite.png', import.meta.url ).href;

        new THREE.TextureLoader().load( spriteUrl, ( sourceTexture ) =>
        {
            const texture = this.createColorKeyedSpriteTexture( sourceTexture.image );
            const frameAspectRatio = (
                sourceTexture.image.width / this.sprite.columns * this.sprite.crop.width
            ) / (
                sourceTexture.image.height / this.sprite.rows * this.sprite.crop.height
            );

            texture.encoding = THREE.sRGBEncoding;
            texture.wrapS = THREE.ClampToEdgeWrapping;
            texture.wrapT = THREE.ClampToEdgeWrapping;
            texture.minFilter = THREE.LinearFilter;
            texture.magFilter = THREE.LinearFilter;
            texture.generateMipmaps = false;

            this.spriteTexture = texture;
            this.object.material.map = texture;
            this.object.material.needsUpdate = true;
            this.object.scale.set( scale * frameAspectRatio * 2.2, scale * 2.2, scale );
            this.baseScale.copy( this.object.scale );
            this.updateSpriteFrame( performance.now(), true );

            sourceTexture.dispose();
        } );
    }

    createColorKeyedSpriteTexture( image )
    {
        const canvas = document.createElement( 'canvas' );
        canvas.width = image.width;
        canvas.height = image.height;

        const ctx = canvas.getContext( '2d' );
        ctx.drawImage( image, 0, 0 );

        const pixels = ctx.getImageData( 0, 0, canvas.width, canvas.height );
        const data = pixels.data;

        for( let i = 0; i < data.length; i += 4 )
        {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            const max = Math.max( r, g, b );
            const min = Math.min( r, g, b );
            const chroma = max - min;
            const brightness = ( r + g + b ) / 3;
            const neutral = chroma < 12;
            const greySheetBackground = neutral && brightness >= 112 && brightness <= 202;
            const whiteEmptyCell = neutral && brightness >= 238;

            if( greySheetBackground || whiteEmptyCell )
            {
                data[i + 3] = 0;
            }
        }

        ctx.putImageData( pixels, 0, 0 );

        return new THREE.CanvasTexture( canvas );
    }

    updateSpriteFrame( time, force = false )
    {
        if( !this.spriteTexture )
        {
            return;
        }

        const frame = Math.floor( time / 1000 * this.sprite.fps ) % this.sprite.frameCount;

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
