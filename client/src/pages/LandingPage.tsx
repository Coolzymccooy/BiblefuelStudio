// client/src/pages/LandingPage.tsx
import { Header } from '../components/landing/Header';
import { Hero } from '../components/landing/Hero';
import { WhatsInside } from '../components/landing/WhatsInside';
import { HowItWorks } from '../components/landing/HowItWorks';
import { AccessForm } from '../components/landing/AccessForm';
import { Footer } from '../components/landing/Footer';

export function LandingPage() {
  return (
    <div className="min-h-screen bg-editorial-paper text-editorial-ink antialiased">
      <Header />
      <Hero />
      <WhatsInside />
      <HowItWorks />
      <AccessForm />
      <Footer />
    </div>
  );
}
