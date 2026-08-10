import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container flex h-16 items-center justify-between">
          <h1 className="text-xl font-semibold">WorkflowPlatform</h1>
          <LogoutButton />
        </div>
      </header>
      <main className="container py-8">
        {children}
      </main>
    </div>
  );
}

function LogoutButton() {
  // This needs to be a client component
  return null; // We'll implement this after testing basic flow
}