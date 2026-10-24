import { Copy } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from '../ui/Button';
import { copyText } from '../../lib/copyText';

interface CopyButtonProps {
  text: string;
  /** Accessible name; says what is copied, e.g. "Copy endpoint URL". */
  label: string;
}

export function CopyButton({ text, label }: CopyButtonProps) {
  const copy = async () => {
    const ok = await copyText(text);
    if (ok) toast.success('Copied');
    else toast.error('Could not copy. Select the text and copy it by hand.');
  };

  return (
    <Button type="button" variant="secondary" className="h-8 shrink-0 px-3 text-xs" aria-label={label} onClick={copy}>
      <Copy size={14} aria-hidden="true" />
      Copy
    </Button>
  );
}
