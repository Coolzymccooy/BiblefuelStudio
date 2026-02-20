import { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Layout } from './components/Layout';
import { ConfigProvider } from './lib/config';

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
          <Suspense
            fallback={
              <div className="min-h-screen flex items-center justify-center text-sm text-gray-400">
                Loading...
              </div>
            }
          >
            <Routes>
              <Route path="/" element={<Layout />}>
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
                <Route path="settings" element={<SettingsPage />} />
                <Route path="help" element={<HelpPage />} />
              </Route>
            </Routes>
          </Suspense>
        </BrowserRouter>
      </ConfigProvider>
      <Toaster position="top-right" />
    </QueryClientProvider>
  );
}

export default App;
