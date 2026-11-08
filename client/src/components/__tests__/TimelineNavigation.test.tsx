import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { MemoryRouter, Routes, Route, Link } from 'react-router-dom';
import { Layout } from '../Layout';
import { useTimelineEditorNavigation } from '../editor/EditorNavigationContext';

const checkStatus = vi.fn();
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({token:'synthetic',emailVerified:true,isSuperAdmin:false,isLoading:false,checkStatus,logout:vi.fn()}) }));
vi.mock('../CompletionBanner', () => ({CompletionBanner:()=>null}));
vi.mock('../NotificationsBell', () => ({NotificationsBell:()=>null}));
vi.mock('../ReportIssueWidget', () => ({ReportIssueWidget:()=>null}));
vi.mock('../VerifyEmailGate', () => ({VerifyEmailGate:()=>null}));
function Editor() {
  const [active, setActive] = useState(true);
  useTimelineEditorNavigation(active);
  return <><button onClick={()=>setActive(!active)}>Switch mode</button><Link to="/app">Leave editor</Link></>;
}
function mount(path='/app/timeline') {
  return render(<MemoryRouter initialEntries={[path]}><Routes><Route element={<Layout/>}><Route path="/app/timeline" element={<Editor/>}/><Route path="/app" element={<p>Home page</p>}/></Route></Routes></MemoryRouter>);
}
afterEach(cleanup);
describe('Timeline-only global navigation registration', () => {
  it('hides global bar and removes wrapper bottom reserve in editor mode', () => {
    mount(); expect(screen.getByRole('navigation',{name:'App navigation',hidden:true}).className).toContain('hidden');
    expect(document.querySelector('.animate-bffade')?.className).toContain('pb-0');
    expect(screen.getByRole('button',{name:'Home and app navigation'})).toBeTruthy();
  });
  it('restores bottom bar and reserve on Classic and can reenter editor', () => {
    mount(); fireEvent.click(screen.getByText('Switch mode'));
    expect(screen.getByRole('navigation',{name:'App navigation'}).className).toContain('lg:hidden');
    expect(document.querySelector('.animate-bffade')?.className).toContain('pb-[calc(88px');
    expect(screen.queryByRole('button',{name:'Home and app navigation'})).toBeNull();
    fireEvent.click(screen.getByText('Switch mode')); expect(screen.getByRole('button',{name:'Home and app navigation'})).toBeTruthy();
  });
  it('cleans registration on route leave without body leakage', () => {
    mount(); fireEvent.click(screen.getByText('Leave editor'));
    expect(screen.getByText('Home page')).toBeTruthy();
    expect(screen.getByRole('navigation',{name:'App navigation'}).className).toContain('lg:hidden');
    expect(screen.queryByRole('button',{name:'Home and app navigation'})).toBeNull();
    expect(document.body.style.overflow).toBe('');
  });
  it('does not change other routes', () => {
    mount('/app'); expect(screen.getByRole('navigation',{name:'App navigation'}).className).toContain('lg:hidden');
    expect(screen.queryByRole('button',{name:'Home and app navigation'})).toBeNull();
  });
  it('reuses real permission-filtered global destinations', () => {
    mount(); const dialog = screen.getByRole('dialog',{hidden:true});
    const links=[...dialog.querySelectorAll('a')];
    for(const path of ['/app','/app/create','/app/studio','/app/jobs','/app/settings','/app/help']) expect(links.some(a=>a.getAttribute('href')===path)).toBe(true);
    expect(links.some(a=>a.getAttribute('href')==='/app/admin')).toBe(false);
    expect(links.some(a=>a.getAttribute('href')==='/app/scene-script')).toBe(false);
  });
});
