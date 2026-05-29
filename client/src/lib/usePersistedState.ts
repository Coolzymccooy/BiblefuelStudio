import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { loadJson, saveJson } from './storage';

/**
 * useState that survives browser refresh by mirroring the value to localStorage.
 *
 * The initial value is hydrated synchronously inside `useState`'s lazy initializer,
 * so the first render already sees the persisted value (no flash of the fallback).
 * Subsequent changes write through to localStorage on the next microtask.
 *
 * Caller owns the storage key; pass STORAGE_KEYS.* to avoid typos and to keep
 * the catalog of persisted keys discoverable from one place.
 */
export function usePersistedState<T>(
    key: string,
    fallback: T,
): [T, Dispatch<SetStateAction<T>>] {
    const [value, setValue] = useState<T>(() => loadJson<T>(key, fallback));
    useEffect(() => {
        saveJson(key, value);
    }, [key, value]);
    return [value, setValue];
}
