export interface ScriptTemplateOption { id: string; label: string }
export interface VoiceOption { id: string; label: string }

// Mirror of the backend template ids (labels only; backend owns the prompts).
export const STORY_SCRIPT_TEMPLATES: ScriptTemplateOption[] = [
  { id: 'devotional-30', label: '30s Devotional' },
  { id: 'teaching-60', label: '60s Teaching' },
  { id: 'meditation', label: 'Scripture Meditation' },
  { id: 'testimony', label: 'Testimony / Encouragement' },
  { id: 'custom', label: 'Custom' },
];

// Curated free Microsoft Edge neural voices.
export const STORY_VOICES: VoiceOption[] = [
  { id: 'en-US-GuyNeural', label: 'Guy — US, male' },
  { id: 'en-US-AriaNeural', label: 'Aria — US, female' },
  { id: 'en-GB-RyanNeural', label: 'Ryan — UK, male' },
  { id: 'en-NG-AbeoNeural', label: 'Abeo — Nigeria, male' },
  { id: 'en-NG-EzinneNeural', label: 'Ezinne — Nigeria, female' },
];
