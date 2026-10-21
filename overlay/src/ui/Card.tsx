import type { ComponentChildren } from 'preact';
import { useId } from 'preact/hooks';

interface CardProps {
  /** Heading text; also the region's accessible name. */
  title: string;
  /** Right-aligned link in the heading, to another screen of this UI. */
  more?: { href: string; label: string };
  span?: 4 | 6 | 8 | 12;
  class?: string;
  children: ComponentChildren;
}

export function Card({ title, more, span, class: cls, children }: CardProps) {
  const id = useId();
  return (
    <section class={['card', span ? `span-${span}` : '', cls ?? ''].join(' ').trim()} aria-labelledby={id}>
      <h2>
        <span id={id}>{title}</span>
        {more && <a class="more" href={more.href}>{more.label}</a>}
      </h2>
      {children}
    </section>
  );
}
