import { useState, useRef, useCallback, useEffect } from "react";
import {
  getRecognitionCtor, isTtsSupported, micProblemFromRecognition, primeSpeech, speakText, stopSpeaking,
  type MicProblem, type SpeakHandle,
} from "@/lib/speech";

export interface UseSpeechReturn {
  isVoiceMode: boolean;
  toggleVoiceMode: () => void;
  isSpeaking: boolean;
  isListening: boolean;
  transcript: string;
  speak: (text: string, onEnd?: () => void) => void;
  startListening: () => void;
  stopListening: () => void;
  isSupported: boolean;
  /** The browser refused to play speech (needs a tap). Show a "Tap to hear" button that calls replay(). */
  audioBlocked: boolean;
  /** From a tap: replays the last text (the tap unlocks audio on mobile). */
  replay: () => void;
  micProblem: MicProblem | null;
}

/** Voice mode for the text mock interview. Speech handling lives in src/lib/speech.ts. */
export function useSpeech(): UseSpeechReturn {
  const isSupported = isTtsSupported() && !!getRecognitionCtor();

  const [isVoiceMode, setIsVoiceMode] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [micProblem, setMicProblem] = useState<MicProblem | null>(null);

  const recognitionRef = useRef<any>(null);
  const speakRef = useRef<SpeakHandle | null>(null);
  const lastRef = useRef<{ text: string; onEnd?: () => void } | null>(null);

  useEffect(() => {
    return () => {
      speakRef.current?.cancel();
      stopSpeaking();
      recognitionRef.current?.abort();
    };
  }, []);

  const speak = useCallback((text: string, onEnd?: () => void) => {
    if (!isSupported) return;
    speakRef.current?.cancel();
    lastRef.current = { text, onEnd };
    setAudioBlocked(false);
    const handle = speakText(text, { onStart: () => setIsSpeaking(true) });
    speakRef.current = handle;
    void handle.done.then((outcome) => {
      if (speakRef.current !== handle || outcome === "cancelled") return;
      setIsSpeaking(false);
      if (outcome === "blocked") { setAudioBlocked(true); return; }
      onEnd?.();
    });
  }, [isSupported]);

  const replay = useCallback(() => {
    primeSpeech();
    if (lastRef.current) speak(lastRef.current.text, lastRef.current.onEnd);
  }, [speak]);

  const startListening = useCallback(() => {
    if (!isSupported) return;
    const SpeechRecognition = getRecognitionCtor() as any;
    if (!SpeechRecognition) { setMicProblem("unsupported"); return; }

    const recognition = new SpeechRecognition();
    recognition.lang = "en-IN";
    recognition.continuous = false;
    recognition.interimResults = true;

    recognition.onstart = () => {
      setIsListening(true);
      setTranscript("");
      setMicProblem(null);
    };
    recognition.onresult = (e: any) => {
      let interim = "";
      let final = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) {
          final += e.results[i][0].transcript;
        } else {
          interim += e.results[i][0].transcript;
        }
      }
      setTranscript(final || interim);
    };
    recognition.onend = () => {
      setIsListening(false);
    };
    recognition.onerror = (e: any) => {
      setIsListening(false);
      const problem = micProblemFromRecognition(e?.error ?? "");
      if (problem) setMicProblem(problem);
    };

    recognitionRef.current = recognition;
    try { recognition.start(); } catch { setIsListening(false); }
  }, [isSupported]);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    setIsListening(false);
  }, []);

  const toggleVoiceMode = useCallback(() => {
    setIsVoiceMode((v) => {
      if (v) {
        speakRef.current?.cancel();
        stopSpeaking();
        recognitionRef.current?.abort();
        setIsSpeaking(false);
        setIsListening(false);
        setTranscript("");
        setAudioBlocked(false);
      } else {
        // Turning voice mode on is a tap: unlock speech for the rest of the interview.
        primeSpeech();
      }
      return !v;
    });
  }, []);

  return {
    isVoiceMode,
    toggleVoiceMode,
    isSpeaking,
    isListening,
    transcript,
    speak,
    startListening,
    stopListening,
    isSupported,
    audioBlocked,
    replay,
    micProblem,
  };
}
