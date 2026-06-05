/**
 * Bible verse lookup widget.
 *
 * Reusable card-shaped component: user types a reference + picks translation,
 * sees the verse text + a "Read on YouVersion" deep link. Used standalone on
 * HomePage and embedded inside SeriesPage as a sanity-check before kicking off
 * a generate.
 */

import { useEffect, useMemo, useState } from 'react';
import { BookOpen, ExternalLink, Loader2 } from 'lucide-react';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Select } from './ui/Select';
import { bibleApi, type TranslationsResponse, type VerseLookupResponse } from '../lib/bibleApi';

const DEFAULT_REFERENCE = 'John 3:16';
const DEFAULT_TRANSLATION = 'kjv';

export function BibleVerseLookup({
    initialReference = DEFAULT_REFERENCE,
    initialTranslation = DEFAULT_TRANSLATION,
    onResolved,
}: {
    initialReference?: string;
    initialTranslation?: string;
    onResolved?: (result: VerseLookupResponse) => void;
}) {
    const [reference, setReference] = useState(initialReference);
    const [translation, setTranslation] = useState(initialTranslation);
    const [catalog, setCatalog] = useState<TranslationsResponse | null>(null);
    const [result, setResult] = useState<VerseLookupResponse | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        bibleApi
            .listTranslations()
            .then(setCatalog)
            .catch(() => setCatalog(null));
    }, []);

    const handleLookup = async () => {
        const trimmed = reference.trim();
        if (!trimmed) {
            setError('Enter a reference like "John 3:16" or "Psalm 23".');
            return;
        }
        setIsLoading(true);
        setError(null);
        try {
            const resolved = await bibleApi.lookupVerse(trimmed, translation);
            setResult(resolved);
            onResolved?.(resolved);
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Lookup failed';
            setError(message);
            setResult(null);
        } finally {
            setIsLoading(false);
        }
    };

    const sortedTranslations = useMemo(() => {
        if (!catalog?.translations) return [];
        // Public domain first (always works), then API.Bible (may need key).
        return [...catalog.translations].sort((a, b) => {
            if (a.requiresApiKey === b.requiresApiKey) return a.code.localeCompare(b.code);
            return a.requiresApiKey ? 1 : -1;
        });
    }, [catalog]);

    const apiBibleNote = catalog && !catalog.apiBibleConfigured ? (
        <p className="text-xs text-amber-300/80 mt-2">
            Copyrighted translations (NIV, NKJV, NLT) are unavailable —{' '}
            <code className="text-amber-200">SCRIPTURE_API_BIBLE_KEY</code> is not set on the server.
            Public domain (KJV, WEB, ASV, BBE, YLT) works without a key.
        </p>
    ) : null;

    return (
        <Card title="Bible verse lookup" icon={BookOpen}>
            <div className="flex flex-col sm:flex-row gap-2">
                <Input
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    placeholder='e.g. "John 3:16" or "1 Cor 13:4-7"'
                    onKeyDown={(e) => e.key === 'Enter' && handleLookup()}
                    className="flex-1"
                    aria-label="Bible reference"
                />
                <Select
                    value={translation}
                    onChange={(e) => setTranslation(e.target.value)}
                    aria-label="Translation"
                    className="sm:w-48"
                >
                    {sortedTranslations.length === 0 ? (
                        <option value="kjv">KJV (King James Version)</option>
                    ) : (
                        sortedTranslations.map((t) => (
                            <option key={t.code} value={t.code}>
                                {t.code.toUpperCase()} — {t.label}
                                {t.requiresApiKey && !catalog?.apiBibleConfigured ? ' (key required)' : ''}
                            </option>
                        ))
                    )}
                </Select>
                <Button onClick={handleLookup} isLoading={isLoading} className="sm:w-32">
                    {isLoading ? null : 'Lookup'}
                </Button>
            </div>

            {apiBibleNote}

            {error && (
                <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                    {error}
                </div>
            )}

            {result && (
                <div className="mt-4 space-y-3">
                    <div className="text-sm uppercase tracking-wider text-content-secondary">
                        {result.reference} · {result.translation.toUpperCase()}
                        {result.source === 'cache' && <span className="ml-2 text-xs text-content-tertiary">(cached)</span>}
                    </div>
                    {result.warning && (
                        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                            {result.warning}
                        </div>
                    )}
                    <ol className="space-y-1.5 text-gray-100 leading-relaxed">
                        {result.verses.map((v) => (
                            <li key={`${v.book}-${v.chapter}-${v.verse}`}>
                                <span className="text-primary-400 font-mono text-xs mr-2 align-top">{v.verse}</span>
                                <span>{v.text}</span>
                            </li>
                        ))}
                    </ol>
                    {result.youversion?.url && (
                        <a
                            href={result.youversion.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 text-sm text-primary-300 hover:text-primary-200 transition-colors"
                        >
                            <ExternalLink size={14} />
                            Read on YouVersion ({result.youversion.translation})
                        </a>
                    )}
                </div>
            )}
            {isLoading && !result && (
                <div className="mt-3 flex items-center gap-2 text-sm text-content-secondary">
                    <Loader2 size={14} className="animate-spin" />
                    Fetching verses…
                </div>
            )}
        </Card>
    );
}
