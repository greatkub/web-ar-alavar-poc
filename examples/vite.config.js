import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const projectRoot = fileURLToPath( new URL( '.', import.meta.url ) );
const publicModelsRoot = path.join( projectRoot, 'public/models' );

const crossOriginIsolationHeaders = {
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'OPTIONS, GET',
    'Access-Control-Request-Method': '*',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp'
};

const httpsConfig = fs.existsSync( 'ssl/key.pem' ) && fs.existsSync( 'ssl/cert.pem' )
    ? {
        key: fs.readFileSync( 'ssl/key.pem' ),
        cert: fs.readFileSync( 'ssl/cert.pem' )
    }
    : undefined;

function modelAsset404Middleware( request, response, next )
{
    let pathname;

    try
    {
        pathname = decodeURIComponent( new URL( request.url || '/', 'http://localhost' ).pathname );
    }
    catch
    {
        next();
        return;
    }

    if( !pathname.startsWith( '/models/' ) )
    {
        next();
        return;
    }

    const filePath = path.join( projectRoot, 'public', pathname );
    const relativePath = path.relative( publicModelsRoot, filePath );
    const isInsideModels = relativePath && !relativePath.startsWith( '..' ) && !path.isAbsolute( relativePath );
    const isExistingFile = isInsideModels && fs.existsSync( filePath ) && fs.statSync( filePath ).isFile();

    if( isExistingFile )
    {
        next();
        return;
    }

    response.statusCode = 404;
    response.setHeader( 'Content-Type', 'text/plain; charset=utf-8' );
    response.end( 'Not found' );
}

function modelAsset404Plugin()
{
    return {
        name: 'model-asset-404',
        configureServer( server )
        {
            server.middlewares.use( modelAsset404Middleware );
        },
        configurePreviewServer( server )
        {
            server.middlewares.use( modelAsset404Middleware );
        }
    };
}

export default defineConfig( {
    plugins: [modelAsset404Plugin(), react()],
    server: {
        host: '0.0.0.0',
        port: 5174,
        headers: crossOriginIsolationHeaders,
        https: httpsConfig,
        allowedHosts: true
    },
    preview: {
        host: '0.0.0.0',
        port: 4174,
        headers: crossOriginIsolationHeaders,
        https: httpsConfig
    }
} );
