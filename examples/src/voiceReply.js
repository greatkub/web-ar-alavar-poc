const REPLY_VOICE_URL = (
    import.meta.env.VITE_REPLY_VOICE_URL ||
    'https://web-ar-alavar-poc-fastapi-production.up.railway.app/reply/voice/stream'
).trim();

const REPLY_BEARER_TOKEN = (
    import.meta.env.VITE_ASR_CLIENT_TOKEN ||
    ''
).trim();

const PCM_SAMPLE_RATE = 24000;

let playbackContext = null;

async function getAudioContext() {
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

export async function prepareVoiceReplyAudio() {
    return getAudioContext();
}

function concatenateChunks(chunks) {
    const byteLength = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
    const bytes = new Uint8Array(byteLength);
    let offset = 0;

    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }

    return bytes.buffer;
}

async function playPcm16(buffer) {
    if (!buffer.byteLength) {
        return;
    }

    const context = await getAudioContext();
    const view = new DataView(buffer);
    const sampleCount = Math.floor(buffer.byteLength / 2);
    const audioBuffer = context.createBuffer(1, sampleCount, PCM_SAMPLE_RATE);
    const channel = audioBuffer.getChannelData(0);

    for (let i = 0; i < sampleCount; i++) {
        channel[i] = view.getInt16(i * 2, true) / 32768;
    }

    await new Promise((resolve) => {
        const source = context.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(context.destination);
        source.onended = resolve;
        source.start();
    });
}

export function createVoiceReplySession({ text, persona, onStatus, onError }) {
    let abortController = null;
    let stopped = false;

    const reportError = (error) => {
        const message = error instanceof Error ? error.message : String(error);
        onError?.(message);
    };

    const stop = () => {
        stopped = true;
        abortController?.abort();
    };

    const start = async () => {
        abortController = new AbortController();
        onStatus?.('connecting');

        const headers = { 'Content-Type': 'application/json' };

        if (REPLY_BEARER_TOKEN) {
            headers['Authorization'] = `Bearer ${REPLY_BEARER_TOKEN}`;
        }

        const body = {
            text,
            response_model: import.meta.env.VITE_REPLY_RESPONSE_MODEL || 'qwen3.6-plus',
            tts_model: import.meta.env.VITE_TTS_MODEL || 'qwen3-tts-vd-realtime-2026-01-15',
            voice: import.meta.env.VITE_TTS_VOICE || 'myvoice',
            region: import.meta.env.VITE_TTS_REGION || 'international',
            language: import.meta.env.VITE_REPLY_LANGUAGE || 'en',
            audio_format: 'pcm',
            ...(persona ? { persona } : {})
        };

        let response;

        try {
            response = await fetch(REPLY_VOICE_URL, {
                method: 'POST',
                headers,
                body: JSON.stringify(body),
                signal: abortController.signal
            });
        } catch (error) {
            if (stopped) {
                return;
            }

            const message = error instanceof Error ? error.message : 'Could not connect to the voice reply service.';
            const wrapped = new Error(message);
            reportError(wrapped);
            throw wrapped;
        }

        if (!response.ok) {
            let detail = `Voice reply service returned ${response.status}.`;

            try {
                const json = await response.json();
                detail = json.detail || json.error || json.message || detail;

                if (typeof detail === 'object') {
                    detail = detail.message || JSON.stringify(detail);
                }
            } catch {
                // ignore json parse errors
            }

            const error = new Error(detail);
            reportError(error);
            throw error;
        }

        onStatus?.('speaking');

        const chunks = [];
        const reader = response.body.getReader();

        try {
            while (true) {
                const { done, value } = await reader.read();

                if (done) {
                    break;
                }

                if (stopped) {
                    reader.cancel();
                    return;
                }

                chunks.push(value);
            }
        } catch (error) {
            if (stopped) {
                return;
            }

            const message = error instanceof Error ? error.message : 'Error reading voice reply stream.';
            const wrapped = new Error(message);
            reportError(wrapped);
            throw wrapped;
        }

        if (stopped) {
            return;
        }

        if (!chunks.length) {
            const error = new Error('Voice reply returned no audio.');
            reportError(error);
            throw error;
        }

        onStatus?.('playing');

        try {
            await playPcm16(concatenateChunks(chunks));

            if (!stopped) {
                onStatus?.('done');
            }
        } catch (error) {
            if (stopped) {
                return;
            }

            const message = error instanceof Error ? error.message : 'Could not play voice reply audio.';
            const wrapped = new Error(message);
            reportError(wrapped);
            throw wrapped;
        }
    };

    return { start, stop };
}
