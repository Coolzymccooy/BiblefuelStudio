import { useEffect, useState } from 'react';
import { api } from '../lib/api';

interface AuthedImageProps {
    src: string;
    alt?: string;
    className?: string;
    /** Open in a new tab on click. Defaults to true since these are small thumbnails. */
    openOnClick?: boolean;
}

/**
 * <img> that fetches a protected URL with the bearer token, blobs the
 * response, and exposes it via an object URL.
 *
 * Native <img src="..."> doesn't send Authorization headers, so we can't
 * point it directly at a protected route. This component bridges that gap.
 * Object URLs are revoked on unmount or when `src` changes to avoid leaking
 * Blob refs.
 */
export function AuthedImage({ src, alt = '', className, openOnClick = true }: AuthedImageProps) {
    const [url, setUrl] = useState<string | null>(null);
    const [err, setErr] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        let createdUrl: string | null = null;
        setUrl(null);
        setErr(null);

        const fetchAndBlob = async () => {
            try {
                const fullUrl = `${api.baseUrl}${src}`;
                const token = localStorage.getItem('BF_TOKEN');
                const headers: Record<string, string> = {};
                if (token && token !== 'null' && token !== 'undefined') {
                    headers['Authorization'] = `Bearer ${token}`;
                }
                const resp = await fetch(fullUrl, { headers });
                if (!resp.ok) {
                    if (!cancelled) setErr(`HTTP ${resp.status}`);
                    return;
                }
                const blob = await resp.blob();
                if (cancelled) return;
                createdUrl = URL.createObjectURL(blob);
                setUrl(createdUrl);
            } catch (e) {
                if (!cancelled) setErr(String((e as Error)?.message || e));
            }
        };

        fetchAndBlob();

        return () => {
            cancelled = true;
            if (createdUrl) URL.revokeObjectURL(createdUrl);
        };
    }, [src]);

    if (err) {
        return <div className={`text-[10px] text-red-400 italic ${className || ''}`}>image: {err}</div>;
    }
    if (!url) {
        return <div className={`bg-white/5 animate-pulse rounded ${className || ''}`} aria-label="loading image" />;
    }
    const img = <img src={url} alt={alt} className={className} />;
    if (openOnClick) {
        return (
            <button
                type="button"
                onClick={() => window.open(url, '_blank', 'noopener')}
                className="block focus:outline-none focus:ring-2 focus:ring-amber-500/50 rounded"
                aria-label={`Open ${alt || 'image'} full size`}
            >
                {img}
            </button>
        );
    }
    return img;
}
