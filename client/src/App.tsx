import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Layout } from './components/Layout';
import { ConfigProvider } from './lib/config';
import {
  HomePage,
  ScriptsPage,
  QueuePage,
  JobsPage,
  BackgroundsPage,
  VoiceAudioPage,
  TimelinePage,
  RenderPage,
  GumroadPage,
  SettingsPage,
  HelpPage,
  WizardPage
} from './pages';

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
        </BrowserRouter>
      </ConfigProvider>
      <Toaster position="top-right" />
    </QueryClientProvider>
  );
}

export default App;
