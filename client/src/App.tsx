import { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Layout } from './components/Layout';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ConfigProvider } from './lib/config';
import { LandingPage } from './pages/LandingPage';

const HomePage = lazy(() => import('./pages/HomePage').then((m) => ({ default: m.HomePage })));
const WizardPage = lazy(() => import('./pages/WizardPage').then((m) => ({ default: m.WizardPage })));
const ScriptsPage = lazy(() => import('./pages/ScriptsPage').then((m) => ({ default: m.ScriptsPage })));
const QueuePage = lazy(() => import('./pages/QueuePage').then((m) => ({ default: m.QueuePage })));
const JobsPage = lazy(() => import('./pages/JobsPage').then((m) => ({ default: m.JobsPage })));
const BackgroundsPage = lazy(() => import('./pages/BackgroundsPage').then((m) => ({ default: m.BackgroundsPage })));
const VoiceAudioPage = lazy(() => import('./pages/VoiceAudioPage').then((m) => ({ default: m.VoiceAudioPage })));
const TimelinePage = lazy(() => import('./pages/TimelinePage').then((m) => ({ default: m.TimelinePage })));
const RenderPage = lazy(() => import('./pages/RenderPage').then((m) => ({ default: m.RenderPage })));
const GumroadPage = lazy(() => import('./pages/GumroadPage').then((m) => ({ default: m.GumroadPage })));
const SeriesPage = lazy(() => import('./pages/SeriesPage').then((m) => ({ default: m.SeriesPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const HelpPage = lazy(() => import('./pages/HelpPage').then((m) => ({ default: m.HelpPage })));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ConfigProvider>
        <BrowserRouter>
          <ErrorBoundary>
            <Suspense
              fallback={
                <div className="min-h-screen flex items-center justify-center text-sm text-gray-400">
                  Loading...
                </div>
              }
            >
              <Routes>
                {/* Public landing route. Both authed and unauthed users
                    can view it; the Header surfaces a "Resume in Studio"
                    CTA when a session token is present. */}
                <Route path="/" element={<LandingPage />} />
                <Route path="/app" element={<Layout />}>
                  <Route index element={<HomePage />} />
                  <Route path="wizard" element={<WizardPage />} />
                  <Route path="scripts" element={<ScriptsPage />} />
                  <Route path="queue" element={<QueuePage />} />
                  <Route path="jobs" element={<JobsPage />} />
                  <Route path="backgrounds" element={<BackgroundsPage />} />
                  <Route path="voice-audio" element={<VoiceAudioPage />} />
                  <Route path="timeline" element={<TimelinePage />} />
                  <Route path="render" element={<RenderPage />} />
                  <Route path="gumroad" element={<GumroadPage />} />
                  <Route path="series" element={<SeriesPage />} />
                  <Route path="settings" element={<SettingsPage />} />
                  <Route path="help" element={<HelpPage />} />
                </Route>
              </Routes>
            </Suspense>
          </ErrorBoundary>
          {/* Toaster lives inside BrowserRouter so toast bodies that
              render <Link> (e.g. Voice & Audio "Use → Open Render →")
              have access to the Router context. Without this, the toast
              throws and ErrorBoundary blanks the page. */}
          <Toaster position="top-right" />
        </BrowserRouter>
      </ConfigProvider>
    </QueryClientProvider>
  );
}

export default App;
