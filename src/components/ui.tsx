import type { ReactNode } from 'react';
import clsx from 'clsx';

// ─────────────────────────────────────────────────────────────────────────────

export function Panel({
  title,
  right,
  children,
  className,
  bodyClass,
  dense,
}: {
  title?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClass?: string;
  dense?: boolean;
}) {
  return (
    <div className={clsx('panel flex min-h-0 flex-col overflow-hidden', className)}>
      {title && (
        <div className="flex shrink-0 items-center justify-between border-b border-line px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="label">{title}</span>
          </div>
          {right}
        </div>
      )}
      <div className={clsx('min-h-0 flex-1', dense ? '' : 'p-3', bodyClass)}>{children}</div>
    </div>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-1.5 flex items-center justify-between">
      <span className="label">{children}</span>
      {right}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export function Stat({
  label,
  value,
  unit,
  tone = 'default',
  hint,
}: {
  label: string;
  value: string | number;
  unit?: string;
  tone?: 'default' | 'ok' | 'warn' | 'danger' | 'nav' | 'analysis';
  hint?: string;
}) {
  const color =
    tone === 'ok' ? 'text-ok'
      : tone === 'warn' ? 'text-warn'
        : tone === 'danger' ? 'text-danger'
          : tone === 'nav' ? 'text-nav'
            : tone === 'analysis' ? 'text-analysis'
              : 'text-txt';
  return (
    <div className="min-w-0">
      <div className="label truncate">{label}</div>
      <div className="mt-0.5 flex items-baseline gap-1">
        <span className={clsx('mono text-[15px] leading-none font-medium', color)}>{value}</span>
        {unit && <span className="mono text-[9px] text-txt3">{unit}</span>}
      </div>
      {hint && <div className="mt-0.5 truncate text-3xs text-txt3">{hint}</div>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export function Bar({
  value,
  max = 100,
  tone = 'nav',
  height = 3,
}: {
  value: number;
  max?: number;
  tone?: 'nav' | 'ok' | 'warn' | 'danger' | 'analysis' | 'steel';
  height?: number;
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const bg =
    tone === 'ok' ? 'bg-ok'
      : tone === 'warn' ? 'bg-warn'
        : tone === 'danger' ? 'bg-danger'
          : tone === 'analysis' ? 'bg-analysis'
            : tone === 'steel' ? 'bg-steel'
              : 'bg-nav';
  return (
    <div className="w-full overflow-hidden rounded-full bg-line2" style={{ height }}>
      <div className={clsx('h-full rounded-full transition-[width] duration-300', bg)} style={{ width: `${pct}%` }} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export function Sparkline({
  data,
  color = '#38BDF8',
  height = 26,
  width = 120,
  fill = true,
}: {
  data: number[];
  color?: string;
  height?: number;
  width?: number;
  fill?: boolean;
}) {
  if (!data.length) return <div style={{ height, width }} />;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const span = max - min || 1;
  const n = data.length;
  const pts = data.map((d, i) => {
    const x = (i / Math.max(1, n - 1)) * width;
    const y = height - ((d - min) / span) * (height - 2) - 1;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg width={width} height={height} className="overflow-visible">
      {fill && (
        <polygon points={`0,${height} ${pts.join(' ')} ${width},${height}`} fill={color} opacity={0.11} />
      )}
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth={1.2} strokeLinejoin="round" />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export type Tone = 'default' | 'nav' | 'ok' | 'warn' | 'danger' | 'analysis' | 'steel';

const TONE_CLASS: Record<Tone, string> = {
  default: 'border-line2 text-txt2 bg-raised/40',
  nav: 'border-nav/[0.35] text-nav bg-nav/10',
  ok: 'border-ok/[0.35] text-ok bg-ok/10',
  warn: 'border-warn/[0.35] text-warn bg-warn/10',
  danger: 'border-danger/[0.35] text-danger bg-danger/10',
  analysis: 'border-analysis/[0.35] text-analysis bg-analysis/10',
  steel: 'border-steel/[0.35] text-txt2 bg-steel/10',
};

export function Chip({
  children,
  tone = 'default',
  className,
  title,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
  title?: string;
}) {
  return <span className={clsx('chip', TONE_CLASS[tone], className)} title={title}>{children}</span>;
}

export function Dot({ tone = 'default', pulse }: { tone?: Tone; pulse?: boolean }) {
  const bg =
    tone === 'ok' ? 'bg-ok'
      : tone === 'warn' ? 'bg-warn'
        : tone === 'danger' ? 'bg-danger'
          : tone === 'nav' ? 'bg-nav'
            : tone === 'analysis' ? 'bg-analysis'
              : tone === 'steel' ? 'bg-steel'
                : 'bg-txt3';
  return <span className={clsx('inline-block h-1.5 w-1.5 rounded-full', bg, pulse && 'animate-pulseDot')} />;
}

// ─────────────────────────────────────────────────────────────────────────────

export function KV({
  k,
  v,
  tone = 'default',
  mono = true,
}: {
  k: string;
  v: ReactNode;
  tone?: Tone;
  mono?: boolean;
}) {
  const color =
    tone === 'ok' ? 'text-ok'
      : tone === 'warn' ? 'text-warn'
        : tone === 'danger' ? 'text-danger'
          : tone === 'nav' ? 'text-nav'
            : tone === 'analysis' ? 'text-analysis'
              : 'text-txt';
  return (
    <div className="flex items-baseline justify-between gap-3 py-[3px]">
      <span className="shrink-0 text-3xs font-semibold uppercase tracking-[0.12em] text-txt3">{k}</span>
      <span className={clsx('truncate text-right text-[11px]', mono && 'mono', color)}>{v}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = 'sm',
}: {
  options: { id: T; label: string; title?: string }[];
  value: T;
  onChange: (v: T) => void;
  size?: 'xs' | 'sm';
}) {
  return (
    <div className="inline-flex overflow-hidden rounded border border-line2">
      {options.map((o) => (
        <button
          key={o.id}
          title={o.title}
          onClick={() => onChange(o.id)}
          className={clsx(
            'border-r border-line2 px-2 font-semibold uppercase tracking-[0.1em] transition-colors last:border-r-0',
            size === 'xs' ? 'py-[3px] text-3xs' : 'py-1 text-2xs',
            value === o.id ? 'bg-nav/[0.16] text-nav' : 'bg-raised/40 text-txt3 hover:bg-raised hover:text-txt2',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-6 text-center text-[11px] text-txt3">{children}</div>
  );
}

export function Divider({ label }: { label?: string }) {
  if (!label) return <div className="my-2 border-t border-line/70" />;
  return (
    <div className="my-2 flex items-center gap-2">
      <span className="label whitespace-nowrap">{label}</span>
      <div className="h-px flex-1 bg-line/70" />
    </div>
  );
}
