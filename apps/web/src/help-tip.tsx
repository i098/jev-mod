import { useEffect, useId, useRef, type ReactNode } from 'react';
import { CircleHelp } from 'lucide-react';

export function HelpTip({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const tip = useRef<HTMLSpanElement>(null);
  const close = () => { if (tip.current?.matches(':popover-open')) tip.current.hidePopover(); };
  function position() {
    if (!trigger.current || !tip.current) return;
    const anchor = trigger.current.getBoundingClientRect();
    if (anchor.bottom < 0 || anchor.top > innerHeight) { close(); return; }
    const width = Math.min(304, innerWidth - 32);
    const above = anchor.top > innerHeight / 2;
    Object.assign(tip.current.style, { width: `${width}px`,
      left: `${Math.max(16, Math.min(anchor.left, innerWidth - width - 16))}px` });
    const height = tip.current.getBoundingClientRect().height;
    tip.current.style.top = `${Math.max(16, Math.min(above ? anchor.top - height : anchor.bottom, innerHeight - height - 16))}px`;
  }
  function open() {
    if (!trigger.current || !tip.current) return;
    if (!tip.current.matches(':popover-open')) tip.current.showPopover({ source: trigger.current });
    position();
  }
  useEffect(() => {
    const update = () => { if (tip.current?.matches(':popover-open')) position(); };
    window.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    return () => { window.removeEventListener('scroll', update); window.removeEventListener('resize', update); };
  }, []);
  return <span className="help-tip" onMouseEnter={open} onMouseLeave={event => {
    if (!event.currentTarget.contains(document.activeElement)) close();
  }} onBlur={event => { if (!event.currentTarget.matches(':hover')) close(); }}>
    <button ref={trigger} className="btn btn-ghost btn-xs help-trigger" type="button" aria-label={label} aria-describedby={id}
      onFocus={open} onClick={open} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); close(); } }}>
      <CircleHelp size={16} aria-hidden="true" />
    </button>
    <span ref={tip} id={id} popover="auto" role="tooltip" className="help-popover">{children}</span>
  </span>;
}
