import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from './api';

export type AppFeatures = {
    scripts: boolean;
    tts: boolean;
    pexels: boolean;
    pixabay: boolean;
    render: boolean;
    audioProcessing: boolean;
};

export type AppConfig = {
    env: string;
    features: AppFeatures;
    warnings: string[];
};

const defaultConfig: AppConfig = {
    env: 'unknown',
    features: {
        scripts: true,
        tts: true,
        pexels: true,
        pixabay: true,
        render: true,
        audioProcessing: true,
    },
    warnings: [],
};

type ConfigContextValue = {
    config: AppConfig;
    isLoading: boolean;
    refresh: () => Promise<void>;
};

const ConfigContext = createContext<ConfigContextValue>({
    config: defaultConfig,
    isLoading: true,
    refresh: async () => undefined,
});

export function ConfigProvider({ children }: { children: ReactNode }) {
    const [config, setConfig] = useState<AppConfig>(defaultConfig);
    const [isLoading, setIsLoading] = useState(true);

    const fetchConfig = useCallback(async () => {
        setIsLoading(true);
        try {
            const res = await api.get('/api/config');
            if (res.ok && res.data?.features) {
                setConfig({
                    env: res.data.env || 'unknown',
                    features: res.data.features,
                    warnings: res.data.warnings || [],
                });
            }
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchConfig();
    }, [fetchConfig]);

    const value = useMemo(() => ({ config, isLoading, refresh: fetchConfig }), [config, isLoading, fetchConfig]);

    return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>;
}

export function useConfig() {
    return useContext(ConfigContext);
}
