/**
 * Creates a microphone stream controller.
 * Pure JS — no React, no JSX.
 *
 * @param {{ onStream?: (stream: MediaStream) => void }} options
 * @returns {{ start: () => Promise<MediaStream>, stop: () => void }}
 */
export function createMicrophoneStream({ onStream } = {}) {
    let stream = null;

    async function start() {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        onStream?.(stream);
        return stream;
    }

    function stop() {
        stream?.getTracks().forEach(t => t.stop());
        stream = null;
    }

    return { start, stop };
}
