const ASR_SAMPLE_RATE = 16000;
const ASR_WS_URL = import.meta.env.VITE_ASR_WS_URL || 'wss://web-ar-alavar-poc-fastapi-production.up.railway.app/ws/asr';
const ASR_CLIENT_TOKEN = (import.meta.env.VITE_ASR_CLIENT_TOKEN || '').trim();

function createStartMessage() {
    const message = {
        type: 'start',
        model: 'qwen3-asr-flash-realtime-2026-02-10',
        region: 'international',
        language: 'en',
        sample_rate: ASR_SAMPLE_RATE,
        vad: true,
        silence_duration_ms: 400
    };

    if (ASR_CLIENT_TOKEN) {
        message.client_token = ASR_CLIENT_TOKEN;
    }

    return message;
}

function normalizeSpeechPart(value) {
    if (!value) {
        return '';
    }

    if (Array.isArray(value)) {
        return value.map(normalizeSpeechPart).filter(Boolean).join(' ');
    }

    if (typeof value === 'object') {
        return Object.values(value).map(normalizeSpeechPart).filter(Boolean).join(' ');
    }

    return String(value).trim();
}

function partialCaption(message) {
    return [
        normalizeSpeechPart(message.stash),
        normalizeSpeechPart(message.text)
    ]
        .filter(Boolean)
        .join(' ')
        .trim();
}

function downsample(buffer, inputRate, outputRate) {
    if (inputRate === outputRate) {
        return buffer;
    }

    const ratio = inputRate / outputRate;
    const length = Math.round(buffer.length / ratio);
    const result = new Float32Array(length);
    let offsetResult = 0;
    let offsetBuffer = 0;

    while (offsetResult < result.length) {
        const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
        let accum = 0;
        let count = 0;

        for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
            accum += buffer[i];
            count++;
        }

        result[offsetResult] = count ? accum / count : 0;
        offsetResult++;
        offsetBuffer = nextOffsetBuffer;
    }

    return result;
}

function floatTo16BitPcm(samples) {
    const output = new ArrayBuffer(samples.length * 2);
    const view = new DataView(output);

    for (let i = 0; i < samples.length; i++) {
        const sample = Math.max(-1, Math.min(1, samples[i]));
        view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    }

    return output;
}

export function createRealtimeAsrSession({
    stream,
    onPartial,
    onCompleted,
    onError,
    onStatus
}) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    let ws = null;
    let audioContext = null;
    let source = null;
    let processor = null;
    let closeTimer = null;
    let stopped = false;

    const reportError = (error) => {
        const message = error instanceof Error ? error.message : String(error);
        onError?.(message);
    };

    const disconnectAudio = () => {
        processor?.disconnect();
        source?.disconnect();
        processor = null;
        source = null;

        if (audioContext?.state !== 'closed') {
            audioContext.close().catch(() => {});
        }
        audioContext = null;
    };

    const stop = () => {
        stopped = true;
        disconnectAudio();

        if (closeTimer) {
            clearTimeout(closeTimer);
            closeTimer = null;
        }

        if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'finish' }));
            closeTimer = window.setTimeout(() => ws?.close(1000, 'finished'), 250);
        } else if (ws?.readyState === WebSocket.CONNECTING) {
            ws.close(1000, 'cancelled');
        }

        onStatus?.('idle');
    };

    const start = async () => {
        if (!AudioContextClass) {
            throw new Error('Web Audio is not available in this browser.');
        }

        onStatus?.('connecting');

        ws = new WebSocket(ASR_WS_URL);
        ws.binaryType = 'arraybuffer';

        ws.onmessage = (event) => {
            let message;

            try {
                message = JSON.parse(event.data);
            } catch {
                return;
            }

            if (message.type === 'asr.partial') {
                onPartial?.(partialCaption(message));
                return;
            }

            if (message.type === 'asr.completed') {
                const transcript = normalizeSpeechPart(message.transcript);
                if (transcript) {
                    onCompleted?.(transcript);
                }
                return;
            }

            if (message.type === 'error') {
                reportError(message.message || message.error || 'ASR service returned an error.');
            }
        };

        ws.onclose = () => {
            if (!stopped) {
                onStatus?.('closed');
            }
        };

        await new Promise((resolve, reject) => {
            ws.onopen = resolve;
            ws.onerror = () => reject(new Error('Could not connect to the ASR service.'));
        });

        if (stopped) {
            return;
        }

        ws.send(JSON.stringify(createStartMessage()));

        audioContext = new AudioContextClass();
        if (audioContext.state === 'suspended') {
            await audioContext.resume();
        }

        source = audioContext.createMediaStreamSource(stream);
        processor = audioContext.createScriptProcessor(4096, 1, 1);
        processor.onaudioprocess = (event) => {
            if (stopped || ws?.readyState !== WebSocket.OPEN) {
                return;
            }

            const input = event.inputBuffer.getChannelData(0);
            const pcm16 = floatTo16BitPcm(downsample(input, audioContext.sampleRate, ASR_SAMPLE_RATE));
            ws.send(pcm16);
        };

        source.connect(processor);
        processor.connect(audioContext.destination);
        onStatus?.('listening');
    };

    return { start, stop };
}
