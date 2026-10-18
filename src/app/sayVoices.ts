// Parser for `say -v ?` output (macOS voice list)
// Example lines:
//   Alex                en_US    # Most people recognize me by my voice.
//   Ava (Premium)       en_US    # Hello! My name is Ava.

export interface SayVoice {
  name: string;
  lang: string;
}

export function parseSayVoices(stdout: string): SayVoice[] {
  const voices: SayVoice[] = [];
  for (const line of stdout.split('\n')) {
    const m = line.match(/^(.+?)\s+([a-z]{2,3}[_-][A-Za-z0-9_-]+)\s+#/);
    if (m) {
      voices.push({ name: m[1].trim(), lang: m[2].replace('_', '-') });
    }
  }
  return voices;
}
