import fs from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

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

export default defineConfig( {
    plugins: [react()],
    server: {
        host: '0.0.0.0',
        port: 5174,
        headers: crossOriginIsolationHeaders,
        https: httpsConfig
    },
    preview: {
        host: '0.0.0.0',
        port: 4174,
        headers: crossOriginIsolationHeaders,
        https: httpsConfig
    }
} );
