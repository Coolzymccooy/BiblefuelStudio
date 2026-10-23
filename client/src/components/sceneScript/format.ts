export const money = (usd: number) => `$${(Math.round((Number(usd) || 0) * 100) / 100).toFixed(2)}`;

export function clock(sec: number | null | undefined) {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return '–';
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export const kindLabel: Record<string, string> = {
  narration: '',
  scripture: 'Scripture',
  reference: 'Reference',
  chant: 'Chant',
};
