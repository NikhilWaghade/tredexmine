import { cn } from '../../utils';

export function Card({
  children,
  className = '',
  hoverEffect = true,
  glow = false,
  ...props
}) {
  return (
    <div
      className={cn(
        'rounded-2xl bg-white/[0.03] backdrop-blur-md border border-purple-900/30 p-6 sm:p-8 transition-all duration-300',
        hoverEffect && 'hover:border-[#7A56D6]/50 hover:bg-white/[0.05] hover:shadow-xl hover:shadow-[#7A56D6]/10 hover:-translate-y-1',
        glow && 'shadow-lg shadow-[#7A56D6]/20 border-[#7A56D6]/40',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export default Card;
