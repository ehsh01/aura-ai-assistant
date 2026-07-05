type Props = {
  size?: number;
  className?: string;
};

/** Recall neural-brain mark — transparent PNG, no box background. */
export function RecallLogo({ size = 40, className = "" }: Props) {
  return (
    <img
      src="/recall-logo-128.png"
      srcSet="/recall-logo-64.png 1x, /recall-logo-256.png 2x"
      alt="Recall"
      width={size}
      height={size}
      className={`object-contain flex-shrink-0 ${className}`}
      draggable={false}
    />
  );
}
