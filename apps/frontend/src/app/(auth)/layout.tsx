import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: { default: 'Sign in', template: '%s | WorkflowPlatform' },
};

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh flex">
      {/* ── Left brand panel (hidden on mobile) ── */}
      <div className="hidden lg:flex lg:w-[480px] xl:w-[540px] flex-col justify-between bg-[oklch(0.20_0.06_264)] p-12 relative overflow-hidden shrink-0">
        {/* Background grid */}
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage: `linear-gradient(oklch(1 0 0 / 1) 1px, transparent 1px),
                              linear-gradient(90deg, oklch(1 0 0 / 1) 1px, transparent 1px)`,
            backgroundSize: '40px 40px',
          }}
        />
        {/* Glow blobs */}
        <div className="absolute top-[-80px] left-[-80px] w-[400px] h-[400px] rounded-full bg-[oklch(0.55_0.22_264)] opacity-[0.12] blur-[80px] pointer-events-none" />
        <div className="absolute bottom-[-60px] right-[-60px] w-[300px] h-[300px] rounded-full bg-[oklch(0.65_0.18_200)] opacity-[0.10] blur-[60px] pointer-events-none" />

        {/* Logo */}
        <div className="relative z-10">
          <Link href="/" className="inline-flex items-center gap-2.5 group">
            <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center border border-white/10 group-hover:bg-white/15 transition-colors">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <span className="text-white font-semibold text-lg tracking-tight">WorkflowPlatform</span>
          </Link>
        </div>

        {/* Center testimonial */}
        <div className="relative z-10 space-y-8">
          <blockquote className="space-y-4">
            <p className="text-white/90 text-xl leading-relaxed font-light">
              "Shipping features in hours instead of weeks. The authentication system just works — secure, fast, beautiful."
            </p>
            <footer className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-400 to-indigo-600 flex items-center justify-center text-white text-sm font-semibold shrink-0">
                S
              </div>
              <div>
                <p className="text-white text-sm font-medium">Sarah Chen</p>
                <p className="text-white/50 text-xs">CTO at Acme Corp</p>
              </div>
            </footer>
          </blockquote>

          {/* Feature pills */}
          <div className="flex flex-wrap gap-2">
            {['JWT + Refresh tokens', 'OAuth 2.0', 'MFA / TOTP', 'Rate limiting', 'Audit logs'].map((f) => (
              <span key={f} className="px-3 py-1 rounded-full bg-white/8 border border-white/10 text-white/70 text-xs">
                {f}
              </span>
            ))}
          </div>
        </div>

        {/* Bottom stats */}
        <div className="relative z-10 grid grid-cols-3 gap-4 pt-8 border-t border-white/10">
          {[
            { value: '99.9%', label: 'Uptime SLA' },
            { value: '<5ms', label: 'Auth latency' },
            { value: 'SOC 2', label: 'Compliant' },
          ].map(({ value, label }) => (
            <div key={label}>
              <p className="text-white font-semibold text-lg">{value}</p>
              <p className="text-white/40 text-xs mt-0.5">{label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Right form panel ── */}
      <div className="flex-1 flex flex-col">
        {/* Mobile logo */}
        <div className="flex lg:hidden items-center justify-between px-6 py-5 border-b border-border">
          <Link href="/" className="inline-flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <span className="font-semibold text-foreground">WorkflowPlatform</span>
          </Link>
        </div>

        {/* Form area */}
        <div className="flex-1 flex items-center justify-center p-6 sm:p-10">
          <div className="w-full max-w-[420px] animate-in fade-in slide-in-from-bottom-4 duration-500">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
