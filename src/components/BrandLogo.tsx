import { cn } from '../lib/utils';

type BrandLogoTone = 'light' | 'dark';
type BrandLogoSize = 'sm' | 'md' | 'lg';

type BrandLogoProps = {
  className?: string;
  tone?: BrandLogoTone;
  size?: BrandLogoSize;
  showTagline?: boolean;
  hideText?: boolean;
};

const sizeMap: Record<BrandLogoSize, { badge: string; icon: string; title: string; tagline: string }> = {
  sm: {
    badge: 'h-9 w-9 rounded-[12px]',
    icon: 'h-5 w-5',
    title: 'text-[13px]',
    tagline: 'text-[8px]',
  },
  md: {
    badge: 'h-11 w-11 rounded-[14px]',
    icon: 'h-6 w-6',
    title: 'text-[15px]',
    tagline: 'text-[9px]',
  },
  lg: {
    badge: 'h-12 w-12 rounded-[16px]',
    icon: 'h-7 w-7',
    title: 'text-[18px]',
    tagline: 'text-[10px]',
  },
};

const toneMap: Record<BrandLogoTone, { badge: string; title: string; tagline: string }> = {
  light: {
    badge: 'border border-[#d9e3ee] bg-white shadow-[0_10px_20px_rgba(15,23,42,0.08)]',
    title: 'text-[#1bb9e8]',
    tagline: 'text-[#7b8ea3]',
  },
  dark: {
    badge: 'border border-white/12 bg-white/10 shadow-[0_10px_20px_rgba(0,0,0,0.18)]',
    title: 'text-white',
    tagline: 'text-white/62',
  },
};

export const BrandLogo = ({
  className,
  tone = 'light',
  size = 'md',
  showTagline = false,
  hideText = false,
}: BrandLogoProps) => {
  const visual = sizeMap[size];
  const toneStyles = toneMap[tone];

  return (
    <div className={cn('flex items-center gap-3', className)}>
      <div className={cn('flex shrink-0 items-center justify-center overflow-hidden', visual.badge, toneStyles.badge)}>
        <img
          src="/favicon.svg"
          alt="VARONENGLISH"
          className={cn('block object-contain', visual.icon)}
          draggable="false"
        />
      </div>
      {!hideText && (
        <div className="min-w-0 leading-none">
          <p className={cn('font-serif font-black tracking-[0.03em]', visual.title, toneStyles.title)}>VARONENGLISH</p>
          {showTagline && (
            <p className={cn('mt-1 font-sans font-semibold uppercase tracking-[0.26em]', visual.tagline, toneStyles.tagline)}>
              FOR COMPETITIVE EXAMS
            </p>
          )}
        </div>
      )}
    </div>
  );
};
