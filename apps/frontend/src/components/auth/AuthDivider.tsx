import { Separator } from '@/components/ui/separator';

export function AuthDivider() {
  return (
    <div className="relative">
      <div className="absolute inset-0 flex items-center">
        <Separator />
      </div>
      <div className="relative flex justify-center text-xs uppercase">
        <span className="bg-background px-3 text-muted-foreground font-medium tracking-wide">
          or
        </span>
      </div>
    </div>
  );
}