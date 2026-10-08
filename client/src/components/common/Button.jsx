import { Link } from 'react-router-dom';
import { cn } from '../../utils';

const variantClasses = {
  primary:
    'bg-[#7A56D6] hover:bg-[#6842c5] text-white shadow-lg shadow-[#7A56D6]/30 border border-[#7A56D6]/50 hover:shadow-[#7A56D6]/50',
  secondary:
    'bg-white/10 hover:bg-white/15 text-white border border-white/10 hover:border-white/20 backdrop-blur-sm',
  outline:
    'bg-transparent hover:bg-[#7A56D6]/10 text-purple-200 border border-[#7A56D6]/60 hover:border-[#7A56D6]',
  ghost:
    'bg-transparent hover:bg-white/5 text-gray-300 hover:text-white',
};

const sizeClasses = {
  sm: 'px-3 py-1.5 text-xs font-medium rounded-lg',
  md: 'px-5 py-2.5 text-sm font-medium rounded-xl',
  lg: 'px-6 py-3.5 text-base font-semibold rounded-xl',
};

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  className = '',
  to,
  href,
  type = 'button',
  disabled = false,
  ...props
}) {
  const combinedClasses = cn(
    'inline-flex items-center justify-center font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-[#7A56D6]/50 focus:ring-offset-2 focus:ring-offset-black disabled:opacity-50 disabled:pointer-events-none active:scale-[0.98]',
    variantClasses[variant] || variantClasses.primary,
    sizeClasses[size] || sizeClasses.md,
    className
  );

  if (to) {
    return (
      <Link to={to} className={combinedClasses} {...props}>
        {children}
      </Link>
    );
  }

  if (href) {
    return (
      <a href={href} className={combinedClasses} {...props}>
        {children}
      </a>
    );
  }

  return (
    <button type={type} disabled={disabled} className={combinedClasses} {...props}>
      {children}
    </button>
  );
}

export default Button;
