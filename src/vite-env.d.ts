/// <reference types="vite/client" />

interface Window {
  SpeechRecognition: typeof SpeechRecognition;
  webkitSpeechRecognition: typeof SpeechRecognition;
}

// Shared contracts import zod with Deno's npm: specifier; Vite aliases it to the "zod" package.
declare module "npm:zod@3.25.76" {
  export * from "zod";
}
