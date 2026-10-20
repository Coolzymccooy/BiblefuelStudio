import { Input } from '../ui/Input';
import { Button } from '../ui/Button';

interface Props {
    label: string;
    value: string;
    /** The server holds a value for this secret (it never sends the value itself). */
    saved: boolean;
    /** The user asked for the saved value to be removed on the next save. */
    cleared: boolean;
    onChange: (value: string) => void;
    onClear: () => void;
}

/**
 * A secret the server keeps but never sends back. Blank on save keeps the
 * saved value; Clear sends an explicit null so it can still be removed.
 */
export function SecretField({ label, value, saved, cleared, onChange, onClear }: Props) {
    const placeholder = cleared
        ? `${label}: will be removed when you save`
        : saved ? `${label}: saved, leave blank to keep` : label;
    return (
        <div className="flex gap-2 items-center">
            <Input
                type="password"
                autoComplete="off"
                aria-label={label}
                className="flex-1 min-w-0"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
            />
            {saved && !cleared && !value && (
                <Button variant="ghost" className="text-xs h-8 px-2 flex-shrink-0" onClick={onClear} aria-label={`Clear saved ${label}`}>
                    Clear
                </Button>
            )}
        </div>
    );
}
