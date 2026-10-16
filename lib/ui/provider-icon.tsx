import type { ProviderIconPreference } from '../providers/provider-icon-model';
import type { ProviderPresetId } from './provider-presets';
import './provider-icon.css';

type ProviderIconProps = {
  presetId: ProviderPresetId;
  icon?: ProviderIconPreference;
  size?: number;
  className?: string;
};

/** Decorative vendor identity; the adjacent service name supplies its label. */
export function ProviderIcon({
  presetId,
  icon,
  size = 24,
  className,
}: ProviderIconProps) {
  const iconClass = ['provider-icon', className].filter(Boolean).join(' ');
  const iconId = icon?.type === 'provider' ? icon.providerId : presetId;
  if (icon?.type !== 'image' && iconId === 'custom') {
    return (
      <svg
        className={iconClass}
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M8 3v4m8-4v4M5 7h14v4a7 7 0 0 1-14 0V7m7 11v3" />
      </svg>
    );
  }
  if (icon?.type !== 'image' && iconId === 'local-gateway') {
    return (
      <svg
        className={iconClass}
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <rect x="3" y="14" width="18" height="6" rx="1.5" />
        <path d="M7 17h.01M11 17h.01M12 14V9m0 0-4-4m4 4 4-4m-4 4V3" />
      </svg>
    );
  }
  if (icon?.type !== 'image' && iconId === 'built-in') {
    return (
      <svg
        className={iconClass}
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <rect x="3" y="4" width="18" height="12" rx="2" />
        <path d="M8 20h8M12 16v4M7.5 8h4M9.5 8v1m-1.8 3c1.4-.6 2.6-1.8 3.1-3.5m-1.6 3.5c-.7-.3-1.3-.8-1.7-1.4M13 13l2-5 2 5m-3.3-1.6h2.6" />
      </svg>
    );
  }
  return (
    <img
      className={iconClass}
      data-provider={icon?.type === 'image' ? 'image' : iconId}
      src={icon?.type === 'image' ? icon.dataUrl : `/providers/${iconId}.svg`}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
}
