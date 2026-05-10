class CustomerLayout {
  view = `
      <section style="border: 1px solid #3b82f6; border-radius: 24px; overflow: hidden; background: #0f172a;">
        <header style="padding: 16px 20px; background: rgba(59, 130, 246, 0.16); color: #bfdbfe;">
          <strong>Customer Area</strong>
        </header>
        <div style="padding: 22px;">
          <template x-yield></template>
        </div>
      </section>
    `;
}

if (typeof MiniX_Component !== 'undefined') {
  MiniX_Component.registerLayout('CustomerLayout', CustomerLayout);
}
