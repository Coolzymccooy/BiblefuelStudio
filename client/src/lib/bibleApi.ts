/**
 * Client helpers for the /api/bible and /api/series endpoints.
 *
 * Thin typed wrapper around the shared `api` axios client.
 * Mirrors the server-side return shapes so the consumer doesn't have to
 * branch on response.ok / response.data — these helpers throw on error.
 */

import { api } from './api';

export interface BibleVerse {
    book: string;
    chapter: number;
    verse: number;
    text: string;
}

export interface YouVersionLink {
    translation: string;
    url: string;
}

export interface ParsedReference {
    canonical: string;
    book: string;
    bookUsfm: string;
    chapter: number;
    verseFrom: number | null;
    verseTo: number | null;
}

export interface VerseLookupResponse {
    reference: string;
    translation: string;
    requestedTranslation: string;
    verses: BibleVerse[];
    source: 'cache' | 'api-bible' | 'bible-api';
    warning?: string;
    youversion: YouVersionLink | null;
}

export interface TranslationOption {
    code: string;
    label: string;
    requiresApiKey: boolean;
}

export interface YouVersionTranslationOption {
    key: string;
    code: string;
    label: string;
}

export interface TranslationsResponse {
    apiBibleConfigured: boolean;
    translations: TranslationOption[];
    youversion: YouVersionTranslationOption[];
}

export interface SeriesSegment {
    partNumber: number;
    totalParts: number;
    reference: string;
    verseFrom: number;
    verseTo: number;
    verses: BibleVerse[];
    hook: string;
    caption: string;
    youVersionUrl: string;
}

export interface SeriesPlan {
    seriesId: string;
    chapterReference: string;
    book: string;
    chapter: number;
    translation: string;
    totalParts: number;
    segments: SeriesSegment[];
}

export interface SeriesRecord {
    seriesId: string;
    userId: string;
    chapterReference: string;
    book: string;
    chapter: number;
    translation: string;
    totalParts: number;
    jobIds: string[];
    createdAt: string;
}

export interface SeriesGenerateInput {
    reference: string;
    parts: number;
    translation: string;
    destination?: 'webhook' | 'buffer' | 'youtube';
    webhookId?: string;
    webhookUrl?: string;
    profileIds?: string[];
    privacyStatus?: 'public' | 'unlisted' | 'private';
    niche?: string;
    tone?: string;
    voiceId?: string;
    aspect?: 'portrait' | 'square' | 'landscape';
    durationSec?: number;
    backgroundQuery?: string;
    titlePrefix?: string;
}

export interface SeriesGenerateResponse {
    series: SeriesRecord;
    plan: SeriesPlan;
    jobIds: string[];
}

function unwrap<T>(response: { ok: boolean; data?: any; error?: string }): T {
    if (!response.ok) throw new Error(response.error || 'Request failed');
    if (!response.data?.ok) throw new Error(response.data?.error || 'Request failed');
    return response.data as T;
}

export const bibleApi = {
    listTranslations: async (): Promise<TranslationsResponse> => {
        const resp = await api.get('/api/bible/translations');
        return unwrap<TranslationsResponse>(resp);
    },

    parseReference: async (reference: string, translation = 'kjv'): Promise<{ reference: ParsedReference; youversion: YouVersionLink }> => {
        const resp = await api.get(`/api/bible/parse?reference=${encodeURIComponent(reference)}&translation=${encodeURIComponent(translation)}`);
        return unwrap<{ reference: ParsedReference; youversion: YouVersionLink }>(resp);
    },

    lookupVerse: async (reference: string, translation = 'kjv'): Promise<VerseLookupResponse> => {
        const resp = await api.get(`/api/bible/verse?reference=${encodeURIComponent(reference)}&translation=${encodeURIComponent(translation)}`);
        return unwrap<VerseLookupResponse>(resp);
    },
};

export const seriesApi = {
    preview: async (input: { reference: string; parts: number; translation: string }): Promise<{ plan: SeriesPlan }> => {
        const resp = await api.post('/api/series/preview', input);
        return unwrap<{ plan: SeriesPlan }>(resp);
    },

    generate: async (input: SeriesGenerateInput): Promise<SeriesGenerateResponse> => {
        const resp = await api.post('/api/series/generate', input);
        return unwrap<SeriesGenerateResponse>(resp);
    },

    list: async (limit = 50): Promise<{ series: SeriesRecord[] }> => {
        const resp = await api.get(`/api/series?limit=${limit}`);
        return unwrap<{ series: SeriesRecord[] }>(resp);
    },
};
