import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';

interface UnauthedOnlyProps {
  redirect: string;
  children: ReactNode;
}

function hasToken(): boolean {
  const t = localStorage.getItem('BF_TOKEN');
  return Boolean(t && t !== 'null' && t !== 'undefined');
}

export function UnauthedOnly({ redirect, children }: UnauthedOnlyProps) {
  if (hasToken()) return <Navigate to={redirect} replace />;
  return <>{children}</>;
}
