# DondeAI Premium Animation Patterns Reference

## Spring Physics Cheat Sheet

All DondeAI animations MUST use spring physics. CSS ease-in-out is banned.

### Spring Configs by Context

| Context | Stiffness | Damping | Use Case |
|---------|-----------|---------|----------|
| Snappy | 500 | 30 | Buttons, toggles, chips, quick feedback |
| Smooth | 300 | 25 | Cards, panels, modals, score reveal |
| Gentle | 200 | 20 | Page transitions, theme switches |
| Bouncy | 400 | 15 | Notifications, celebrations, achievements |
| Sluggish | 150 | 18 | Background parallax, ambient particles |

### Entrance Animations

**Card Reveal (restaurant recommendation):**
```css
/* CSS fallback */
.card-enter {
  opacity: 0;
  transform: translateY(16px);
  transition: opacity 0.3s, transform 0.3s cubic-bezier(0.22, 1, 0.36, 1);
}
.card-enter-active {
  opacity: 1;
  transform: translateY(0);
}
```

```javascript
// Preferred: JS spring
const cardEntrance = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { type: "spring", stiffness: 300, damping: 25 }
};
```

**CRITICAL:** Entrance y-offset must be 12-24px. Never 50px+. Large values feel janky.

**Staggered Children (list of results):**
```javascript
const container = {
  animate: { transition: { staggerChildren: 0.08, delayChildren: 0.1 } }
};
const item = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  transition: { type: "spring", stiffness: 400, damping: 28 }
};
```

### Exit Animations

Always wrap exit animations. Content that just disappears feels broken.

```javascript
// Wrap lists in AnimatePresence
<AnimatePresence mode="popLayout">
  {items.map(item => (
    <motion.div
      key={item.id}
      exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.15 } }}
      layout
    />
  ))}
</AnimatePresence>
```

### Donde Score Animation

The orbiting dot score reveal should feel like a premium moment:

```javascript
// Phase 1: Circle draws (0.8s)
// Phase 2: Score counts up from 0 (0.6s, spring)
// Phase 3: Orbiting dot starts (continuous)
// Phase 4: Label fades in (0.3s, spring)

const scoreReveal = {
  circle: { 
    pathLength: [0, 1], 
    transition: { duration: 0.8, ease: [0.65, 0, 0.35, 1] } 
  },
  number: {
    // Count from 0 to final score
    transition: { type: "spring", stiffness: 100, damping: 15, mass: 0.5 }
  },
  orbit: {
    rotate: [0, 360],
    transition: { duration: 3, repeat: Infinity, ease: "linear" }
  }
};
```

### Cultural Theme Transitions

When switching between themes (e.g., Masala → Hanami):

```javascript
// 1. Current theme particles fade out (0.3s)
// 2. Background color morphs (0.5s, spring gentle)
// 3. New theme particles assemble (0.6s)
// 4. Audio chime plays at step 3

const themeTransition = {
  particlesOut: { opacity: 0, scale: 0.8, transition: { duration: 0.3 } },
  backgroundMorph: { 
    backgroundColor: newTheme.bg, 
    transition: { type: "spring", stiffness: 200, damping: 20 } 
  },
  particlesIn: {
    opacity: [0, 1],
    scale: [0.5, 1],
    transition: { 
      type: "spring", stiffness: 300, damping: 25,
      staggerChildren: 0.003 // Tiny stagger for 200+ particles
    }
  }
};
```

### Button Press States

Premium buttons have tactile feedback:

```javascript
const buttonVariants = {
  idle: { scale: 1 },
  pressed: { scale: 0.97 }, // Subtle! Not 0.9
  hover: { scale: 1.02 },
  transition: { type: "spring", stiffness: 500, damping: 30 }
};
```

### Skeleton Loading

Use gradient shimmer on transform (not background-position) for 60fps:

```css
.skeleton {
  background: var(--donde-skeleton-base);
  border-radius: var(--donde-radius-md);
  overflow: hidden;
  position: relative;
}

.skeleton::after {
  content: '';
  position: absolute;
  inset: 0;
  transform: translateX(-100%);
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(255,255,255,0.15) 50%,
    transparent 100%
  );
  animation: shimmer 2s infinite;
}

@keyframes shimmer {
  100% { transform: translateX(100%); }
}
```

### Performance Rules

1. **Only animate `transform` and `opacity`** — these are GPU-composited
2. **Never animate:** width, height, top, left, margin, padding, border
3. **Use `will-change: transform`** on elements about to animate (remove after)
4. **Particle budget:** max 200 simultaneous particles on mobile
5. **requestAnimationFrame** for custom JS animations, never setInterval
6. **Measure with Performance tab:** target <16ms per frame (60fps)
7. **Reduce motion:** respect `prefers-reduced-motion: reduce`

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

## Haptic Feedback Patterns (Mobile Native)

| Action | Haptic Type | When |
|--------|-------------|------|
| Button tap | impactLight | On press down |
| Toggle switch | impactMedium | On state change |
| Score reveal | notificationSuccess | When number lands |
| Theme switch | selection | On each theme card tap |
| Pull-to-refresh | impactHeavy | At refresh threshold |
| Error | notificationError | On validation failure |
| Swipe dismiss | impactLight | At dismiss threshold |

Never fire haptics on scroll or continuous gestures — it feels like a broken phone.
