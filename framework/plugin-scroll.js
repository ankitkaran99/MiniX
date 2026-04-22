(function (global) {
  'use strict';

const MiniXScrollPlugin = (() => {
  const STATE_KEY = '__minixScrollState';

  function toNumber(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function isPromiseLike(value) {
    return value && (typeof value === 'object' || typeof value === 'function') && typeof value.then === 'function';
  }

  function getDirection(el) {
    return (el.getAttribute('x-scroll-dir') || 'bottom').toLowerCase();
  }

  function getThreshold(el) {
    return toNumber(el.getAttribute('x-scroll-threshold'), 10);
  }

  function getMetrics(el) {
    return {
      top: el.scrollTop,
      left: el.scrollLeft,
      height: el.clientHeight,
      width: el.clientWidth,
      scrollHeight: el.scrollHeight,
      scrollWidth: el.scrollWidth,
    };
  }

  function reachedBoundary(el, direction, threshold) {
    const m = getMetrics(el);

    switch (direction) {
      case 'top':
        return m.top <= threshold;
      case 'left':
        return m.left <= threshold;
      case 'right':
        return (m.scrollWidth - (m.left + m.width)) <= threshold;
      case 'bottom':
      default:
        return (m.scrollHeight - (m.top + m.height)) <= threshold;
    }
  }

  function capturePosition(el, direction) {
    return {
      direction,
      top: el.scrollTop,
      left: el.scrollLeft,
      scrollHeight: el.scrollHeight,
      scrollWidth: el.scrollWidth,
    };
  }

  function restorePosition(el, snapshot) {
    if (!snapshot) return;

    switch (snapshot.direction) {
      case 'top': {
        const delta = el.scrollHeight - snapshot.scrollHeight;
        el.scrollTop = snapshot.top + delta;
        break;
      }
      case 'left': {
        const delta = el.scrollWidth - snapshot.scrollWidth;
        el.scrollLeft = snapshot.left + delta;
        break;
      }
      case 'right': {
        const delta = el.scrollWidth - snapshot.scrollWidth;
        el.scrollLeft = snapshot.left + delta;
        break;
      }
      case 'bottom':
      default: {
        // restore exact pre-load scrollTop
        el.scrollTop = snapshot.top;
        break;
      }
    }
  }

  function afterDomPaint(fn) {
    const raf = global.requestAnimationFrame || ((cb) => setTimeout(cb, 0));
    queueMicrotask(() => {
      raf(() => {
        raf(fn);
      });
    });
  }

  const plugin = {
    name: 'minix-scroll',
    version: '16.0.0',

    install(app) {
      const compiler = app?.options?.compiler ?? app?.compiler ?? null;
      if (!compiler) return;

      compiler.directive('x-scroll', ({ el, component }) => {
        const instance = component?.instance;
        const methodName = el.getAttribute('x-scroll');

        if (!instance || !methodName) {
          console.warn('[x-scroll] Missing component instance or method name.');
          return;
        }

        const handler = instance[methodName];
        if (typeof handler !== 'function') {
          console.warn(`[x-scroll] Method '${methodName}' not found on component instance.`);
          return;
        }

        if (el[STATE_KEY]?.destroy) {
          el[STATE_KEY].destroy();
        }

        let locked = false;
        let ticking = false;
        let destroyed = false;
        let wasInside = reachedBoundary(el, getDirection(el), getThreshold(el));
        let hasTriggeredInitial = false;
        let runToken = 0;

        const release = () => {
          locked = false;
        };

        const finalizeRun = (token, snapshot) => {
          if (destroyed || token !== runToken) {
            release();
            return;
          }

          afterDomPaint(() => {
            if (!destroyed && token === runToken) {
              restorePosition(el, snapshot);
            }
            release();
          });
        };

        const maybeRun = (reason = 'scroll') => {
          if (destroyed || locked) return;

          const direction = getDirection(el);
          const threshold = getThreshold(el);
          const isInside = reachedBoundary(el, direction, threshold);
          const allowInitial = el.hasAttribute('x-scroll-initial');

          if (reason === 'initial' && !allowInitial) {
            wasInside = isInside;
            return;
          }

          if (!isInside) {
            wasInside = false;
            return;
          }

          if (reason === 'initial' && hasTriggeredInitial) {
            return;
          }

          const snapshot = capturePosition(el, direction);
          const token = ++runToken;
          let settled = false;

          const ctx = {
            direction,
            threshold,
            reason,
            scrollTop: snapshot.top,
            scrollLeft: snapshot.left,
            scrollHeight: snapshot.scrollHeight,
            scrollWidth: snapshot.scrollWidth,
            done() {
              if (settled) return;
              settled = true;
              finalizeRun(token, snapshot);
            }
          };

          locked = true;
          wasInside = true;
          if (reason === 'initial') {
            hasTriggeredInitial = true;
          }

          let result;
          try {
            result = handler.call(instance, el, ctx);
          } catch (error) {
            release();
            throw error;
          }

          if (isPromiseLike(result)) {
            Promise.resolve(result).then(() => {
              if (settled) return;
              settled = true;
              finalizeRun(token, snapshot);
            }, (error) => {
              release();
              throw error;
            });
            return;
          }

          // Sync handlers: finish on next paint.
          // Async setTimeout-style handlers should call ctx.done().
          if (!settled) {
            settled = true;
            finalizeRun(token, snapshot);
          }
        };

        const onScroll = () => {
          if (destroyed || ticking) return;
          ticking = true;
          const raf = global.requestAnimationFrame || ((fn) => setTimeout(fn, 0));
          raf(() => {
            ticking = false;
            maybeRun('scroll');
          });
        };

        const destroy = () => {
          destroyed = true;
          el.removeEventListener('scroll', onScroll);
          if (el[STATE_KEY]?.destroy === destroy) {
            delete el[STATE_KEY];
          }
        };

        el.addEventListener('scroll', onScroll, { passive: true });
        el[STATE_KEY] = { destroy };

        afterDomPaint(() => {
          if (!destroyed) {
            maybeRun('initial');
          }
        });

        return destroy;
      });
    }
  };

  return plugin;
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = MiniXScrollPlugin;
}
if (global) {
  global.MiniXScrollPlugin = MiniXScrollPlugin;
}
})(typeof window !== 'undefined' ? window : globalThis);
