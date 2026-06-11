import { useState, useRef, useCallback, useEffect } from "react";

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
}

export function useSpeech(): UseSpeechReturn {
  const isSupported =
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);

  const [isVoiceMode, setIsVoiceMode] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");

  const recognitionRef = useRef<any>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    return () => {
      window.speechSynthesis?.cancel();
      recognitionRef.current?.abort();
    };
  }, []);

  const speak = useCallback((text: string, onEnd?: () => void) => {
    if (!isSupported) return;
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.95;
    utterance.lang = "en-US";
    utteranceRef.current = utterance;

    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => {
      setIsSpeaking(false);
      onEnd?.();
    };
    utterance.onerror = () => setIsSpeaking(false);

    window.speechSynthesis.speak(utterance);
  }, [isSupported]);

  const startListening = useCallback(() => {
    if (!isSupported) return;
    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.continuous = false;
    recognition.interimResults = true;

    recognition.onstart = () => {
      setIsListening(true);
      setTranscript("");
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
    recognition.onerror = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
  }, [isSupported]);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    setIsListening(false);
  }, []);

  const toggleVoiceMode = useCallback(() => {
    setIsVoiceMode((v) => {
      if (v) {
        window.speechSynthesis?.cancel();
        recognitionRef.current?.abort();
        setIsSpeaking(false);
        setIsListening(false);
        setTranscript("");
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
  };
}
