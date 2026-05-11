import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  isChunkError: boolean;
  message: string;
}

const CHUNK_RELOAD_KEY = 'bfs:chunk-reload-attempted';

function isChunkLoadError(error: unknown): boolean {
  if (!error) return false;
  const e = error as { name?: string; message?: string };
  const text = `${e.name || ''} ${e.message || ''}`;
  return /ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module|Importing a module script failed/i.test(text);
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, isChunkError: false, message: '' };

  static getDerivedStateFromError(error: unknown): State {
    const chunkErr = isChunkLoadError(error);
    return {
      hasError: true,
      isChunkError: chunkErr,
      message: (error as Error)?.message || 'Unexpected error',
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    if (import.meta.env.DEV) {
      console.error('[ErrorBoundary]', error, info.componentStack);
    }
    if (isChunkLoadError(error)) {
      const alreadyTried = sessionStorage.getItem(CHUNK_RELOAD_KEY);
      if (!alreadyTried) {
        sessionStorage.setItem(CHUNK_RELOAD_KEY, '1');
        window.location.reload();
      }
    }
  }

  handleReload = (): void => {
    sessionStorage.removeItem(CHUNK_RELOAD_KEY);
    window.location.reload();
  };

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="min-h-screen flex items-center justify-center bg-dark-950 text-gray-100 px-6">
        <div className="max-w-md w-full text-center space-y-4">
          <h1 className="text-2xl font-semibold">
            {this.state.isChunkError ? 'A new version is available' : 'Something went wrong'}
          </h1>
          <p className="text-sm text-gray-400">
            {this.state.isChunkError
              ? 'The app was updated since you last loaded this page. Reload to get the latest version.'
              : this.state.message}
          </p>
          <button
            type="button"
            onClick={this.handleReload}
            className="px-4 py-2 rounded-lg bg-white text-black text-sm font-medium hover:bg-gray-200 transition-colors"
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
