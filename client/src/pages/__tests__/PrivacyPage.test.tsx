import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PrivacyPage } from '../PrivacyPage';

// Google's OAuth verification reviews this page for the YouTube scopes.
// These are the parts a reviewer looks for; losing one fails verification.
describe('PrivacyPage — YouTube and Google data', () => {
  const renderPage = () => render(<MemoryRouter><PrivacyPage /></MemoryRouter>);

  it('carries the Limited Use statement, linked to the policy it names', () => {
    renderPage();
    expect(screen.getByText(/will adhere to the/i)).toHaveTextContent(/including the Limited Use requirements/);
    expect(screen.getByRole('link', { name: /google api services user data policy/i }))
      .toHaveAttribute('href', 'https://developers.google.com/terms/api-services-user-data-policy');
  });

  it('names both scopes and what each is for', () => {
    renderPage();
    expect(screen.getByText('youtube.upload')).toBeInTheDocument();
    expect(screen.getByText('youtube.readonly')).toBeInTheDocument();
  });

  it('links YouTube\'s terms, Google\'s privacy policy, and where to revoke access', () => {
    renderPage();
    expect(screen.getByRole('link', { name: /youtube terms of service/i })).toHaveAttribute('href', 'https://www.youtube.com/t/terms');
    expect(screen.getByRole('link', { name: /google privacy policy/i })).toHaveAttribute('href', 'https://policies.google.com/privacy');
    expect(screen.getByRole('link', { name: /myaccount\.google\.com\/permissions/i })).toBeInTheDocument();
  });
});
