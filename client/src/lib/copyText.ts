/**
 * Copy text to the clipboard. Call it straight from the tap: iPhone Safari
 * refuses a clipboard write that first waits on anything else. Falls back to
 * a hidden textarea where the Clipboard API is missing (older browsers, or a
 * page not served over https). Resolves false if neither worked.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the textarea
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    area.style.fontSize = '16px'; // iOS zooms into anything smaller
    document.body.appendChild(area);
    area.select();
    area.setSelectionRange(0, text.length); // iOS ignores select() on its own
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

/** Save text as a .txt file through the browser's own download. */
export function downloadText(fileName: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
