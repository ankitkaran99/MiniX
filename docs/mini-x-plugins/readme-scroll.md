---
product: Mini-X Scroll
summary: Infinite scroll and reverse scroll for Mini-X with edge-triggered loading and scroll position preservation.
badges: ["Infinite scroll","Reverse scroll","Scroll preservation","Async hooks"]
highlights: ["Bottom feeds and top chat-style lists","Threshold-triggered loading without sentinel nodes","Stable scroll position while new items arrive"]
metrics: ["Directions::Top and bottom","Loading::Async aware","Edges::Threshold triggers","Scroll::Preserved offsets"]
sidebar: Everything here focuses on using x-scroll safely in feed and chat interfaces, especially around async loading and scroll stability.
---
{% raw %}

# Mini-X Scroll - documentation

> **Product:** Mini-X Scroll
> **Summary:** Infinite scroll and reverse scroll for Mini-X with edge-triggered loading and scroll position preservation.
> **Focus:** `Infinite scroll` | `Reverse scroll` | `Scroll preservation` | `Async hooks`
>
> **Key Highlights:**
> - Bottom feeds and top chat-style lists
> - Threshold-triggered loading without sentinel nodes
> - Stable scroll position while new items arrive
> **Metrics & Scope:**
> - **Directions:** Top and bottom
> - **Loading:** Async aware
> - **Edges:** Threshold triggers
> - **Scroll:** Preserved offsets

---

# MiniX Scroll Plugin

A lightweight infinite scroll directive for MiniX with proper scroll preservation, edge-triggered loading, and support for both normal and reverse (chat-style) lists.

* * *

## ✨ Features

*   🔥 Bottom infinite scroll (feeds, lists)
*   💬 Top reverse scroll (chat apps)
*   🧠 Scroll position preservation (no jump)
*   ⚡ Edge-triggered (no infinite loop spam)
*   🪶 requestAnimationFrame optimized
*   🔄 Works with async + callback style loading

* * *

## 📦 Installation

```
<script src="../../src/MiniX.js"></script>
<script src="../../src/mini-x-plugins/plugin-scroll.js"></script>

<script>
MiniX.createApp(App)
  .use(MiniXScrollPlugin)
  .mount('#app');
</script>
```

* * *

## 🚀 Basic Usage

```
<div
  style="height:300px; overflow-y:auto;"
  x-scroll="loadMore"
  x-scroll-dir="bottom"
  x-scroll-threshold="20"
>
  <div x-for="item in items" :key="item">
    {{ item }}
  </div>
</div>
```

* * *

## ⚙️ Attributes

| Attribute | Description |
| --- | --- |
| `x-scroll` | Function or expression to execute when threshold is reached |
| `x-scroll-dir` | `bottom` (default) or `top` |
| `x-scroll-threshold` | Distance in px from edge before triggering (default: 10) |
| `x-scroll-initial` | Triggers once on mount if already near boundary |

* * *

## 🧠 How It Works

*   Listens to scroll events on the element
*   Checks distance from top or bottom
*   Triggers only when entering threshold zone
*   Prevents duplicate calls during loading

* * *

## 📍 Scroll Preservation (Important)

When new items are appended, the plugin preserves the previous scroll position.

Without this, scroll would "stick to bottom" and keep firing endlessly.

**Handled internally:**

```
prevHeight = el.scrollHeight
prevTop = el.scrollTop

// after DOM update
el.scrollTop = prevTop
```

* * *

## 💬 Reverse Scroll (Chat Style)

```
<div
  style="height:300px; overflow-y:auto;"
  x-scroll="loadOlder"
  x-scroll-dir="top"
>
  <div x-for="msg in messages" :key="msg.id">
    {{ msg.text }}
  </div>
</div>
```

For top loading, scroll position is adjusted automatically to prevent jump.

* * *

## ⏳ Async Handling

### ✅ Promise-based (auto)

```
async loadMore() {
  const data = await fetchData()
  this.items.push(...data)
}
```

### ⚠️ Callback / setTimeout style

You MUST call `ctx.done()`

```
loadMore(el, ctx) {
  setTimeout(() => {
    this.items.push(...newData)
    ctx.done()
  }, 1000)
}
```

* * *

## ⚠️ Common Mistakes

| Issue | Cause |
| --- | --- |
| Scroll stuck at bottom | Async not handled correctly (missing `ctx.done()`) |
| Items appear in wrong order | MiniX `x-for` diff bug (not plugin issue) |
| Scroll jumps | Container being re-rendered instead of updated |

* * *

## 🧪 Recommended Pattern

```
loadMore(el, ctx) {
  if (this.loading) return;

  this.loading = true;

  fetch('/api/data?page=' + this.page)
    .then(res => res.json())
    .then(data => {
      this.items.push(...data);
      this.page++;
    })
    .finally(() => {
      this.loading = false;
      ctx.done();
    });
}
```

* * *

## 💡 Notes

*   Container must have `overflow-y: auto`
*   Do NOT replace container element during render
*   Only update children (`x-for`)
*   Always use a loading guard in your method

* * *

## 📌 Summary

*   No sentinels needed
*   No manual scroll math needed
*   Works like Vue infinite scroll
*   Supports chat-style reverse loading
*   Stable, predictable behavior
{% endraw %}