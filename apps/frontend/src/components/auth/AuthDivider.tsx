export function AuthDivider() {
  return (
    <div className="relative flex items-center gap-3 py-1">
      <div className="flex-1 h-px bg-border" />
      <span className="text-xs text-muted-foreground font-medium">or continue with</span>
      <div className="flex-1 h-px bg-border" />
    </div>
  );
}
