"use client";

import { Component, createRef, type ReactNode, type RefObject } from "react";

// Closes the gap smoothly when a list changes (michael-motion, "Departures"): after an item leaves
// or arrives, the siblings that moved slide from where they were on screen to where they are now,
// transform only (FLIP), on the smooth spring. A class component because getSnapshotBeforeUpdate
// is the one moment React gives us right before it changes the DOM. Reduced motion: they just move.
//
//   <FlipList flipKey={visible.map((c) => c.id).join()} className="flex flex-col">{items}</FlipList>

type Props = { flipKey: string; className?: string; children: ReactNode };
type Tops = Map<Element, number> | null;

const running = new WeakMap<Element, Animation>();

function token(name: string, fallback: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

// Browsers may hand the token back as "430ms" or "0.43s".
function ms(value: string) {
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n)) return 430;
  return value.endsWith("ms") ? n : value.endsWith("s") ? n * 1000 : n;
}

// Where each item is on screen, mid slide included, so an interrupted slide carries on from there.
// On screen, not in the list: when the page gets shorter and the browser scrolls, an item that did
// not move on screen should not slide.
function tops(list: HTMLElement) {
  const map = new Map<Element, number>();
  for (const child of Array.from(list.children)) map.set(child, child.getBoundingClientRect().top);
  return map;
}

export class FlipList extends Component<Props> {
  private ref: RefObject<HTMLUListElement | null> = createRef();

  getSnapshotBeforeUpdate(prev: Props): Tops {
    if (prev.flipKey === this.props.flipKey || !this.ref.current) return null;
    return tops(this.ref.current);
  }

  componentDidUpdate(_prev: Props, _state: unknown, was: Tops) {
    const list = this.ref.current;
    if (!list || !was || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // Stop slides still running so the new layout is measured clean; the new slide starts from the
    // point on screen the old one had reached.
    for (const child of Array.from(list.children)) running.get(child)?.cancel();
    const duration = ms(token("--m-dur-smooth", "430ms"));
    for (const [child, top] of tops(list)) {
      const from = was.get(child);
      const delta = from === undefined ? 0 : from - top;
      if (Math.abs(delta) < 1) continue;
      const frames = [{ transform: `translateY(${delta}px)` }, { transform: "none" }];
      let slide: Animation;
      try {
        slide = child.animate(frames, { duration, easing: token("--m-spring-smooth", "ease-out") });
      } catch {
        slide = child.animate(frames, { duration, easing: "ease-out" });
      }
      running.set(child, slide);
    }
  }

  render() {
    return (
      <ul ref={this.ref} className={this.props.className}>
        {this.props.children}
      </ul>
    );
  }
}
