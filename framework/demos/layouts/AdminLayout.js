class AdminLayout {
  view = `
      <section style="border: 1px solid #334155; border-radius: 24px; overflow: hidden; background: #111827;">
        <header style="padding: 18px 22px; background: linear-gradient(135deg, #0f766e, #155e75); color: white;">
          <div style="font-size: 0.78rem; letter-spacing: 0.14em; text-transform: uppercase; opacity: 0.85;">Lazy Layout</div>
          <div style="font-size: 1.15rem; font-weight: 700;">Admin Workspace</div>
        </header>
        <div style="padding: 22px;">
          <div x-router-view></div>
        </div>
      </section>
    `;
}

if (typeof MiniX_Component !== 'undefined') {
  MiniX_Component.register('AdminLayout', AdminLayout);
}
