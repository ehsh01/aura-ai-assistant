type Props = {
  size?: number;
  className?: string;
  rounded?: "lg" | "xl" | "2xl" | "full" | "none";
};

const roundedClass = {
  lg: "rounded-lg",
  xl: "rounded-xl",
  "2xl": "rounded-2xl",
  full: "rounded-full",
  none: "",
} as const;

/** Recall neural-brain mark — used in sidebar, login, and headers. */
export function RecallLogo({ size = 32, className = "", rounded = "xl" }: Props) {
  return (
    <img
      src="/recall-logo-48.png"
      srcSet="/recall-logo-48.png 1x, /recall-logo-128.png 2x"
      alt="Recall"
      width={size}
      height={size}
      className={`${roundedClass[rounded]} object-cover flex-shrink-0 ${className}`}
      draggable={false}
    />
  );
}
