import { useCallback, useEffect, useRef, useState } from 'react';
import { createMicrophoneStream } from './microphoneStream.js';

/**
 * React hook that manages the microphone stream lifecycle.
 *
 * @param {{ onStream?: (stream: MediaStream) => void }} options
 * @returns {{ isListening: boolean, startListening: () => Promise<void>, stopListening: () => void }}
 */
export function useMicrophone({ onStream } = {}) {
    const [isListening, setIsListening] = useState(false);
    const micRef = useRef(null);

    const startListening = useCallback(async () => {
        micRef.current = createMicrophoneStream({ onStream });
        await micRef.current.start();
        setIsListening(true);
    }, [onStream]);

    const stopListening = useCallback(() => {
        micRef.current?.stop();
        micRef.current = null;
        setIsListening(false);
    }, []);

    useEffect(() => () => stopListening(), [stopListening]);

    return { isListening, startListening, stopListening };
}
