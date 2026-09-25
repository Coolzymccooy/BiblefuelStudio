import { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Toaster, ToastBar, toast } from 'react-hot-toast';
import { X } from 'lucide-react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Layout } from './components/Layout';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ConfigProvider } from './lib/config';
import { LandingPage } from './pages/LandingPage';
import { PrivacyPage } from './pages/PrivacyPage';
import { CookieBanner } from './components/CookieBanner';

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
const AdminPage = lazy(() => import('./pages/AdminPage').then((m) => ({ default: m.AdminPage })));
const StoryVideoPage = lazy(() => import('./pages/StoryVideoPage').then((m) => ({ default: m.StoryVideoPage })));
const CreateHubPage = lazy(() => import('./pages/CreateHubPage').then((m) => ({ default: m.CreateHubPage })));
const StudioHubPage = lazy(() => import('./pages/StudioHubPage').then((m) => ({ default: m.StudioHubPage })));

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
                <Route path="/privacy" element={<PrivacyPage />} />
                <Route path="/app" element={<Layout />}>
                  <Route index element={<HomePage />} />
                  <Route path="create" element={<CreateHubPage />} />
                  <Route path="studio" element={<StudioHubPage />} />
                  <Route path="wizard" element={<WizardPage />} />
                  <Route path="scripts" element={<ScriptsPage />} />
                  <Route path="queue" element={<QueuePage />} />
                  <Route path="jobs" element={<JobsPage />} />
                  <Route path="backgrounds" element={<BackgroundsPage />} />
                  <Route path="voice-audio" element={<VoiceAudioPage />} />
                  <Route path="timeline" element={<TimelinePage />} />
                  <Route path="render" element={<RenderPage />} />
                  <Route path="story" element={<StoryVideoPage />} />
                  <Route path="gumroad" element={<GumroadPage />} />
                  <Route path="series" element={<SeriesPage />} />
                  <Route path="settings" element={<SettingsPage />} />
                  <Route path="help" element={<HelpPage />} />
                  <Route path="admin" element={<AdminPage />} />
                </Route>
              </Routes>
            </Suspense>
          </ErrorBoundary>
          {/* Toaster lives inside BrowserRouter so toast bodies that
              render <Link> (e.g. Voice & Audio "Use → Open Render →")
              have access to the Router context. Without this, the toast
              throws and ErrorBoundary blanks the page.

              Default error duration is bumped to 10s (vs react-hot-toast's
              default 4s) because the rendering pipeline emits long ffmpeg
              stderr messages that users can't read in 4s. Errors also get a
              wider max-width so the full message fits without truncation. */}
          {/* top-center reads better on phones (top-right toasts overflow the
              narrow viewport and overlap the burger menu / bell). gutter keeps
              stacked toasts from merging into one wall, and the container is
              nudged below the sticky mobile header. Durations are tuned so a
              toast always auto-dismisses ("threads down") within a few seconds:
              success 2.5s, plain 3s, error 5s (was 10s — long ffmpeg errors
              piled up and never cleared on mobile). Repeated identical toasts
              are de-duplicated at their call sites via a stable `id`. */}
          {/* Every toast gets a manual ✕ so it can ALWAYS be dismissed. On iOS
              the auto-dismiss timer can stall (react-hot-toast pauses on touch
              "hover" with no reliable mouse-leave to resume), and loading
              toasts never auto-dismiss by design — both left users with a
              notification stuck on screen until a full refresh. The close
              button guarantees a way out regardless of the timer state. */}
          <Toaster
            position="top-center"
            gutter={8}
            containerStyle={{ top: 'calc(env(safe-area-inset-top, 0px) + 64px)' }}
            toastOptions={{
              duration: 3000,
              // Editor palette, not the library's green/red defaults.
              style: { maxWidth: 'min(92vw, 480px)', wordBreak: 'break-word', background: '#1a150d', color: '#f3ead6', border: '1px solid rgba(216,184,120,.22)', fontSize: '13px' },
              success: { duration: 2500, iconTheme: { primary: '#e6c98a', secondary: '#14100a' } },
              error: {
                duration: 5000,
                style: { maxWidth: 'min(92vw, 480px)', wordBreak: 'break-word', background: '#1a150d', color: '#f3ead6', border: '1px solid rgba(216,184,120,.22)', fontSize: '13px' },
                iconTheme: { primary: '#c9a17f', secondary: '#14100a' },
              },
            }}
          >
            {(t) => (
              <ToastBar toast={t}>
                {({ icon, message }) => (
                  <div className="flex items-center gap-2">
                    {icon}
                    <div className="flex-1">{message}</div>
                    <button
                      onClick={() => toast.dismiss(t.id)}
                      aria-label="Dismiss notification"
                      className="-mr-1 shrink-0 rounded-md p-1 text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
                    >
                      <X size={15} />
                    </button>
                  </div>
                )}
              </ToastBar>
            )}
          </Toaster>
          {/* Cookie/privacy notice — mounts on every route, dismisses once
              and stores acknowledgement in localStorage. UK PECR baseline. */}
          <CookieBanner />
        </BrowserRouter>
      </ConfigProvider>
    </QueryClientProvider>
  );
}

export default App;
