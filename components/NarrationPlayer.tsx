'use client';

import { useTextToSpeech } from '@/hooks/useTextToSpeech';
import { useEffect, useState } from 'react';

interface NarrationPlayerProps {
    narrationText: string;
    slideId: string;
    autoPlay?: boolean;
}

export const NarrationPlayer = ({
    narrationText,
    slideId,
    autoPlay = false
}: NarrationPlayerProps) => {
    const { speak, stop, isSpeaking, getSupportedVoices, supportedVoices } = useTextToSpeech({
        lang: 'en-US',
        rate: 1.0,
        pitch: 1.0,
        volume: 1.0
    });

    const [selectedVoiceIndex, setSelectedVoiceIndex] = useState<number>(0);

    useEffect(() => {
        // Load available voices on mount
        getSupportedVoices();
    }, [getSupportedVoices]);

    useEffect(() => {
        // Auto-play if enabled
        if (autoPlay && narrationText) {
            handleSpeak();
        }
    }, [autoPlay, narrationText]);

    const handleSpeak = async () => {
        try {
            await speak(narrationText, {
                // Can customize voice if needed
            });
        } catch (error) {
            console.error('Failed to speak:', error);
        }
    };

    const handleStop = async () => {
        try {
            await stop();
        } catch (error) {
            console.error('Failed to stop:', error);
        }
    };

    return (
        <div className="narration-player p-4 bg-gray-100 rounded-lg">
            <div className="mb-4">
                <h3 className="text-lg font-semibold mb-2">Narration</h3>
                <p className="text-sm text-gray-600">{narrationText}</p>
            </div>

            {/* Voice Selection */}
            {supportedVoices.length > 0 && (
                <div className="mb-4">
                    <label className="block text-sm font-medium mb-2">
                        Select Voice:
                    </label>
                    <select
                        value={selectedVoiceIndex}
                        onChange={(e) => setSelectedVoiceIndex(Number(e.target.value))}
                        className="w-full p-2 border rounded"
                    >
                        {supportedVoices.map((voice, index) => (
                            <option key={index} value={index}>
                                {voice.name} ({voice.lang})
                            </option>
                        ))}
                    </select>
                </div>
            )}

            {/* Playback Controls */}
            <div className="flex gap-2">
                <button
                    onClick={handleSpeak}
                    disabled={isSpeaking}
                    className={`px-4 py-2 rounded font-medium ${isSpeaking
                            ? 'bg-gray-300 cursor-not-allowed'
                            : 'bg-blue-500 text-white hover:bg-blue-600'
                        }`}
                >
                    {isSpeaking ? 'Speaking...' : 'Play Narration'}
                </button>

                {isSpeaking && (
                    <button
                        onClick={handleStop}
                        className="px-4 py-2 bg-red-500 text-white rounded font-medium hover:bg-red-600"
                    >
                        Stop
                    </button>
                )}
            </div>

            {/* Status Indicator */}
            {isSpeaking && (
                <div className="mt-4 flex items-center gap-2">
                    <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                    <span className="text-sm text-gray-600">Playing narration...</span>
                </div>
            )}
        </div>
    );
};
