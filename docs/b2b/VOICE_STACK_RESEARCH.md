# Voice stack for the AI interview (D4 · R5.2, R5.3)

_Researched 2026-10-29 from vendors' current docs and pricing pages (sources at the end). Prices change; re-check before signing up._

## Why the current voice mode isn't good enough

The V1 room and the pilot both use the **browser Web Speech API**: `SpeechRecognition` for listening and `speechSynthesis` for speaking (`src/lib/speech.ts`, `src/features/b2b/hooks/useVoiceAnswer.ts`).
- **The recogniser varies by browser and OS.** In Chrome it's Google's cloud recogniser; in Edge it's Microsoft's. Mobile Safari behaves differently again.
- **The voice is whatever the operating system has installed.** Many laptops have no Indian English voice at all, so the interviewer sounds American or British, or robotic.
- **It can't be streamed, measured or tuned**, and it gives no reliable end-of-turn events.

Past voice bugs in this repo point to the same thing: speech silent on mobile until unlocked by a tap (`b499622`), and an interview looping and ending itself (`857c330`). These are timing and turn-detection problems that a vendor's streaming events and voice-activity detection solve properly.

## Options compared

Cost per **interview minute**, under these assumptions:
- **Listening:** the candidate's microphone is streamed to speech-to-text (STT) for the whole minute. Gating it with voice-activity detection (sending audio only while the candidate speaks) would roughly halve STT cost.
- **Speaking:** the interviewer speaks about 40% of the time at about 150 words per minute. That's roughly 60 words, or about 360 characters, of text-to-speech (TTS) per minute.
- **Exchange rate:** ₹88 to the US dollar.

Interviewer LLM cost is separate (D1), and so is evaluation.

| Stack | STT (streaming) | TTS (streaming) | Indian English | ≈ per interview minute | ≈ 20-min interview |
|---|---|---|---|---|---|
| **Sarvam** (Saaras STT + Bulbul TTS) | ₹0.49/min pay-as-you-go | ₹3.00 per 1K characters (Bulbul V3 list price) | Built for India. en-IN STT with a **codemix** mode for Hindi-English. Bulbul has "English (Indian accent)" voices. | **₹1.57** (STT ₹0.49 + TTS ₹1.08) | **₹31** |
| **Azure Speech** (en-IN neural) | $1.00/hour (S1, Central India) | $15 per 1M characters (neural), $22 HD | Mature en-IN neural voices and en-IN STT. Free tier: 5 hours STT and 0.5M characters a month. | ₹1.95 ($0.0167 + $0.0054) | ₹39 |
| **Deepgram** (Nova-3 + Aura-2) | $0.0077/min (Nova-3 single-language); $0.0092 multilingual | $0.030 per 1K characters | Nova-3 multilingual code-switches English and Hindi. en-IN is documented for Nova-3 Medical; general Nova-3 en-IN and **Indian-accent Aura voices are not confirmed**. | ₹1.63 | ₹33 |
| **ElevenLabs** (Scribe Realtime + Flash) | $0.39/hour | $0.04 per 1K characters (Flash/Turbo); $0.08 (Multilingual) | Very natural voices. Indian-accent English depends on choosing or cloning a voice; Flash quotes about 75 ms latency. | ₹1.84 | ₹37 |
| **Gemini Live** native audio (speech-to-speech) | $3 per 1M audio input tokens | $12 per 1M audio output tokens | Voice and accent are fixed by the model. The conversation context is resent on every turn, so cost grows during an interview. The interviewer and STT can't be swapped independently. | ≈ $0.013+, rising with length | uncertain |

Framework for turn-taking and interruptions:
- **Pipecat** (BSD-2) with **Smart Turn v3** for end-of-turn detection. The model is open source, about 8 MB, runs on CPU in under 100 ms, and covers 23 languages. Pipecat also handles interruptions (barge-in) and echo cancellation.
- **LiveKit Agents** has an adaptive interruption model and its own turn detector, but that detector's licence allows use only inside LiveKit Agents. Smart Turn can also be plugged into LiveKit.

## Recommendation

**Sarvam for STT and TTS, orchestrated by Pipecat with Smart Turn v3, with the LLM behind our AI gateway (D1).**

- **Accent and accuracy:** it's the only option built for Indian-accented English, with Hindi-English code-mixing handled natively. That's R5.3's core need, and it's where the other vendors are unconfirmed or rely on picking a voice.
- **Streaming:** both STT and TTS work over WebSockets. STT can detect speech boundaries on the server (tunable pause length, default 500 ms) and has a "fast" stream mode for conversations. TTS starts playback as soon as the first audio chunk is ready. That covers R5.2's "stream LLM output into TTS sentence by sentence".
- **Cost:** about ₹31 for a 20-minute interview, the lowest of the specialist stacks, and billed in INR. Gating STT to only the candidate's speech brings it to about ₹26.
- **Fallback:** Azure en-IN is the safe second choice. It's mature, has a free tier for development, and can sit behind the same Pipecat pipeline, so switching later doesn't touch the room UI.

**What this changes in the architecture.** Supabase edge functions can't hold a long-lived audio pipeline. The voice loop needs a small always-on service: a Pipecat worker in Python, connected to the browser over WebRTC or a WebSocket. Interview state and the turn rules stay in Postgres through the existing SQL functions, so the engine and evaluator don't change. This is new infrastructure for you to choose a host for (Fly.io, Render or a small VM in Mumbai).

## Before committing (a 1-day bake-off)

1. **Listening test:** record about 10 interview answers from 4–5 Indian speakers (mixed regions, some Hindi or Telugu words). Run Sarvam, Azure en-IN and Deepgram on them and compare word error rate by hand.
2. **Voice test:** three people blind-rate Sarvam's Bulbul and Azure's en-IN voices for naturalness.
3. **Latency:** measure time from the end of speech to the first audio, end to end through Pipecat. R5.2 targets under about 1 second typical; report p50 and p95 against the room's existing latency meter (`turn-latency.ts`).
4. **Confirm with the vendors:** Sarvam's concurrency limits (not published) and whether Bulbul V4-flash is priced like V3. Their streaming docs mention V4-flash; the pricing page lists V3.

## Sources
- [Sarvam API pricing](https://www.sarvam.ai/api-pricing)
- [Sarvam realtime streaming STT](https://docs.sarvam.ai/api/api-guides-tutorials/speech-to-text/realtime-streaming)
- [Sarvam streaming STT API](https://docs.sarvam.ai/api/api-guides-tutorials/speech-to-text/streaming-api)
- [Sarvam TTS streaming](https://docs.sarvam.ai/api/api-guides-tutorials/text-to-speech/streaming-api)
- [Azure retail prices API (Azure Speech, centralindia)](https://prices.azure.com/api/retail/prices?$filter=productName%20eq%20%27Azure%20Speech%27%20and%20armRegionName%20eq%20%27centralindia%27)
- [Azure Speech pricing (free tier)](https://azure.microsoft.com/en-us/pricing/details/cognitive-services/speech-services/)
- [Deepgram pricing](https://deepgram.com/pricing)
- [Deepgram Nova-3 multilingual](https://deepgram.com/learn/nova-3-multilingual-major-wer-improvements-across-languages)
- [Deepgram Nova-3 Medical multilingual (en-IN)](https://deepgram.com/learn/introducing-nova-3-medical-multilingual)
- [ElevenLabs API pricing](https://elevenlabs.io/pricing/api)
- [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [Pipecat Smart Turn / LiveKit plugin discussion](https://community.livekit.io/t/livekit-plugin-for-smart-turn-eot-detection-models/2013)
- [LiveKit turn handling](https://docs.livekit.io/reference/agents/turn-handling-options/)
- [LiveKit adaptive interruption handling](https://docs.livekit.io/agents/logic/turns/adaptive-interruption-handling/)
