import { transcribeAudio as transcribeOpenAiWhisper } from '../voice/alignment.js';

export async function transcribeOpenAI(audioPath) {
  return transcribeOpenAiWhisper(audioPath);
}
