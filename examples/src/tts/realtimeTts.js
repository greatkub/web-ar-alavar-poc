const TTS_SAMPLE_RATE = 24000;
const TTS_WS_URL = import.meta.env.VITE_TTS_WS_URL || 'wss://web-ar-alavar-poc-fastapi-production.up.railway.app/ws/tts';
const TTS_CLIENT_TOKEN = (
    import.meta.env.VITE_TTS_CLIENT_TOKEN ||
    import.meta.env.VITE_ASR_CLIENT_TOKEN ||
    ''
).trim();
const TTS_VOICE = import.meta.env.VITE_TTS_VOICE || 'myvoice';

let playbackContext = null;

function startMessage() {
    const message = {
        type: 'start',
        model: 'qwen3-tts-vd-realtime-2026-01-15',
        voice: TTS_VOICE,
        region: 'international',
        audio_format: 'pcm',
        sample_rate: TTS_SAMPLE_RATE,
        mode: 'server_commit'
    };

    if (TTS_CLIENT_TOKEN) {
        message.client_token = TTS_CLIENT_TOKEN;
    }

    return message;
}

export async function prepareTtsAudio() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;

    if (!AudioContextClass) {
        throw new Error('Web Audio is not available in this browser.');
    }

    if (!playbackContext || playbackContext.state === 'closed') {
        playbackContext = new AudioContextClass();
    }

    if (playbackContext.state === 'suspended') {
        await playbackContext.resume();
    }

    return playbackContext;
}

function concatenateChunks(chunks) {
    const byteLength = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
    const bytes = new Uint8Array(byteLength);
    let offset = 0;

    for (const chunk of chunks) {
        bytes.set(new Uint8Array(chunk), offset);
        offset += chunk.byteLength;
    }

    return bytes.buffer;
}

function serviceErrorMessage(message) {
    const detail = message.detail || message.error || message.message;

    if (!detail) {
        return 'TTS service returned an error.';
    }

    if (typeof detail === 'string') {
        return detail;
    }

    if (detail.message) {
        return detail.message;
    }

    return JSON.stringify(detail);
}

async function playPcm16(buffer) {
    if (!buffer.byteLength) {
        return;
    }

    const context = await prepareTtsAudio();
    const view = new DataView(buffer);
    const sampleCount = Math.floor(buffer.byteLength / 2);
    const audioBuffer = context.createBuffer(1, sampleCount, TTS_SAMPLE_RATE);
    const channel = audioBuffer.getChannelData(0);

    for (let index = 0; index < sampleCount; index++) {
        channel[index] = view.getInt16(index * 2, true) / 32768;
    }

    await new Promise((resolve) => {
        const source = context.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(context.destination);
        source.onended = resolve;
        source.start();
    });
}

export function createRealtimeTtsSession({
    text,
    onStatus,
    onError
}) {
    let ws = null;
    let stopped = false;
    let settled = false;
    const chunks = [];

    const reportError = (error) => {
        const message = error instanceof Error ? error.message : String(error);
        onError?.(message);
    };

    const stop = () => {
        stopped = true;

        if (ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING) {
            ws.close(1000, 'cancelled');
        }
    };

    const start = () => new Promise((resolve, reject) => {
        const finish = async () => {
            if (settled) {
                return;
            }

            settled = true;
            onStatus?.('playing');

            try {
                if (!chunks.length) {
                    throw new Error('TTS returned no audio. Check that the configured voice is valid for the realtime model.');
                }

                await playPcm16(concatenateChunks(chunks));
                onStatus?.('done');
                resolve();
            } catch (error) {
                reportError(error);
                reject(error);
            } finally {
                if (ws?.readyState === WebSocket.OPEN) {
                    ws.close(1000, 'done');
                }
            }
        };

        onStatus?.('connecting');
        ws = new WebSocket(TTS_WS_URL);
        ws.binaryType = 'arraybuffer';

        ws.onopen = () => {
            onStatus?.('speaking');
            ws.send(JSON.stringify(startMessage()));
            ws.send(JSON.stringify({ type: 'text', text }));
            ws.send(JSON.stringify({ type: 'finish' }));
        };

        ws.onmessage = (event) => {
            if (typeof event.data !== 'string') {
                chunks.push(event.data);
                return;
            }

            let message;
            try {
                message = JSON.parse(event.data);
            } catch {
                return;
            }

            if (message.type === 'error') {
                const error = new Error(serviceErrorMessage(message));
                reportError(error);
                reject(error);
                stop();
                return;
            }

            if (message.type === 'response.done' || message.type === 'session.finished') {
                finish();
            }
        };

        ws.onerror = () => {
            const error = new Error('Could not connect to the TTS service.');
            reportError(error);
            reject(error);
        };

        ws.onclose = () => {
            if (!settled && !stopped && chunks.length) {
                finish();
                return;
            }

            if (!settled && stopped) {
                settled = true;
                resolve();
                return;
            }

            if (!settled) {
                const error = new Error('TTS connection closed before audio was returned.');
                settled = true;
                reportError(error);
                reject(error);
            }
        };
    });

    return { start, stop };
}
