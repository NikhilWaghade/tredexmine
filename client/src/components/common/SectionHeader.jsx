import { cn } from '../../utils';

export function SectionHeader({
  badge,
  title,
  description,
  align = 'center',
  className = '',
}) {
  const alignClass = {
    center: 'text-center mx-auto items-center',
    left: 'text-left items-start',
    right: 'text-right items-end',
  }[align];

  return (
    <div className={cn('flex flex-col max-w-3xl mb-12 sm:mb-16', alignClass, className)}>
      {badge && (
        <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider text-purple-300 bg-[#7A56D6]/20 border border-[#7A56D6]/40 mb-4 backdrop-blur-sm">
          {badge}
        </span>
      )}
      {title && (
        <h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-white mb-4">
          {title}
        </h2>
      )}
      {description && (
        <p className="text-base sm:text-lg text-gray-300 max-w-2xl leading-relaxed">
          {description}
        </p>
      )}
    </div>
  );
}

export default SectionHeader;
