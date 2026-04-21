import fs from 'fs';
import https from 'https';
import os from 'os';
import path from 'path';
import express from 'express';
import { Server } from 'socket.io';

const SERVER_PORT = Number( process.env.PORT || 443 );
const PROJECT_ROOT = process.cwd();
const STATIC_FOLDER = fs.existsSync( path.join( PROJECT_ROOT, 'dist/index.html' ) ) ? 'dist' : 'public';
const STATIC_ROOT = path.join( PROJECT_ROOT, STATIC_FOLDER );

const app = express();

function getLocalAddress()
{
    for( const networkInterface of Object.values( os.networkInterfaces() ) )
    {
        for( const address of networkInterface || [] )
        {
            if( address.family === 'IPv4' && !address.internal )
            {
                return address.address;
            }
        }
    }

    return 'localhost';
}

app.use( ( req, response, next ) =>
{
    // response.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
    // response.setHeader('Access-Control-Allow-Headers', request.header.origin );
    response.setHeader( 'Access-Control-Allow-Headers', '*' );
    response.setHeader( 'Access-Control-Allow-Origin', '*' );
    response.setHeader( 'Access-Control-Allow-Methods', 'OPTIONS, GET' );
    response.setHeader( 'Access-Control-Request-Method', '*' );
    response.setHeader( 'Cross-Origin-Opener-Policy', 'same-origin' );
    response.setHeader( 'Cross-Origin-Embedder-Policy', 'require-corp' );
    next();
} );

app.use( express.static( STATIC_ROOT ) );

if( fs.existsSync( path.join( STATIC_ROOT, 'index.html' ) ) )
{
    app.get( '*', ( req, response ) =>
    {
        response.sendFile( 'index.html', { root: STATIC_ROOT } );
    } );
}

const httpsServer = https.createServer(
    {
        key: fs.readFileSync( 'ssl/key.pem' ),
        cert: fs.readFileSync( 'ssl/cert.pem' )
    },
    app
);

httpsServer.listen( SERVER_PORT, () =>
{
    const url = `https://${ getLocalAddress() }:${ SERVER_PORT }`;
    console.log( `Serving ${ STATIC_FOLDER } at: \x1b[36m${ url }\x1b[0m` );
} );

const socketServer = new Server( httpsServer );
socketServer.on( 'connection', ( socket ) =>
{
    socket.on( 'data', ( data ) => socketServer.emit( 'data', data ) );
} );
