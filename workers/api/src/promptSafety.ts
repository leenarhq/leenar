// Shared prompt-safety helpers: input sanitization, prompt-injection detection,
// and language detection. Used by both the canvas/dashboard chat (routes/chat.ts)
// and the agent runtime (agentRuntime.ts) so every user-facing AI surface applies
// the same boundary defenses without drifting apart.

import type { ChatMessage } from "./conversation";

export const MAX_MSG_LEN = 2_000; // per individual message

// Known prompt-injection trigger phrases — block at the boundary (EN + TR + FR + DE + ES)
const INJECTION_PATTERNS = [
  // English
  /ignore\s+(all\s+)?(previous|above|prior|earlier)\s+instructions?/i,
  /disregard\s+(all\s+)?(previous|above|prior|earlier)/i,
  /forget\s+(everything|all|your)\s+(you\s+know|instructions?|guidelines?|rules?)/i,
  /you\s+are\s+now\s+(a\s+)?(new|different|another|general)/i,
  /act\s+as\s+(an?\s+)?(different|new|general|unrestricted)/i,
  /new\s+(persona|personality|role|identity|mode)/i,
  /reveal\s+(your\s+)?(system\s+prompt|instructions?|api\s+key|secret)/i,
  /print\s+(your\s+)?(system\s+prompt|instructions?|api\s+key|secret)/i,
  /show\s+(me\s+)?(your\s+)?(system\s+prompt|hidden\s+instructions?)/i,
  /jailbreak/i,
  /dan\s+mode/i,
  /developer\s+mode/i,
  // Turkish
  /önceki\s+(tüm\s+)?(talimatları|kuralları|yönergeleri)\s+(yok\s+say|unut|görmezden\s+gel)/i,
  /tüm\s+talimatları\s+(unut|yok\s+say)/i,
  /sistem\s+(komutu|prompt[u']?unu?|talimatın[ıi])\s+(göster|yaz|söyle|ver|paylaş)/i,
  /gizli\s+(talimatları|bilgileri|promptu?)\s+(göster|ver|söyle|paylaş)/i,
  /artık\s+.{0,30}\s+(olarak\s+davran|gibi\s+konuş|gibi\s+davran)/i,
  /\b(asistan|yapay\s+zeka|ai|bot)\s+olarak\s+davran/i,
  /rol\s+(oyna|yap|al)\b/i,
  /kısıtlamalarını\s+(kaldır|unut|yok\s+say)/i,
  /kısıtsız\s+(mod|şekilde|olarak)/i,
  /api\s+(anahtarını|key[''']?ini?)\s+(söyle|ver|göster|yaz)/i,
  /talimatlarını\s+(paylaş|göster|ver|söyle|yaz)/i,
  // French
  /ignor[ez]+\s+(toutes?\s+)?(les?\s+)?instructions?\s+précédentes?/i,
  /oubli[ez]+\s+(tout|vos?\s+instructions?)/i,
  /affichez?\s+(le\s+)?prompt\s+système/i,
  // German
  /ignorier[e]?\s+(alle\s+)?(vorherigen?\s+)?anweisungen/i,
  /vergiss\s+(alles|deine\s+anweisungen)/i,
  // Spanish
  /ignora[r]?\s+(todas?\s+)?(las?\s+)?instrucciones?\s+anteriores?/i,
  /olvida\s+(todo|tus\s+instrucciones)/i,
];

export function sanitizeMessage(content: string): string {
  // Strip null bytes and non-printable control chars (keep newlines/tabs)
  return content
    .replace(/\x00/g, "")
    .replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .slice(0, MAX_MSG_LEN);
}

export function containsInjection(content: string): boolean {
  return INJECTION_PATTERNS.some((p) => p.test(content));
}

export function detectLangFromContent(
  messages: ChatMessage[],
): string | undefined {
  const last = [...messages].reverse().find((m) => m.role === "user");
  if (!last) return undefined;
  const c = last.content;
  if (/[ğüşıöçĞÜŞİÖÇ]/.test(c)) return "tr";
  if (/[àâèéêëîïôùûüæœÀÂÈÉÊËÎÏÔÙÛÜÆŒ]/.test(c)) return "fr";
  if (/[äöüßÄÖÜ]/.test(c)) return "de";
  if (/[ñáéíóúÑÁÉÍÓÚ]/.test(c)) return "es";
  return undefined;
}
