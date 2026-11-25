interface BrandLogoProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZE_CLASSES: Record<NonNullable<BrandLogoProps['size']>, string> = {
  sm: 'h-9 w-9',
  md: 'h-14 w-14',
  lg: 'h-24 w-24',
};

/**
 * Circular emblem for El Timón Restaurante (crops the square PNG cleanly to its circular badge).
 */
export function BrandLogo({ size = 'md', className = '' }: BrandLogoProps) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full overflow-hidden bg-white ring-1 ring-[#0F2A36]/15 shadow-sm ${SIZE_CLASSES[size]} ${className}`}
    >
      <img
        src="/logo-el-timon.png"
        alt="Logo El Timón Restaurante"
        className="h-full w-full object-cover scale-[1.15] select-none"
        draggable={false}
      />
    </span>
  );
}
