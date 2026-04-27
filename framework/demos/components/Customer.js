// Customer.js – lazy component definition
class Customer {
  data() {
    return {
      name: '',
      email: '',
      plan: 'Basic'
    };
  }

  view = `
      <div>
        <h2>👤 Customer Details</h2>
        <div class="card">
          <label>Name</label>
          <input x-model="name" placeholder="Enter name">

          <label>Email</label>
          <input x-model="email" placeholder="Enter email">

          <label>Plan</label>
          <select x-model="plan">
            <option>Basic</option>
            <option>Pro</option>
            <option>Enterprise</option>
          </select>

          <p style="margin-top: 12px;">
            Hello, <strong>{{ name || 'Guest' }}</strong>! Your plan is <strong>{{ plan }}</strong>.
          </p>
        </div>
      </div>
    `;
}

// Register the component globally (required for lazy loading)
if (typeof MiniX_Component !== 'undefined') {
  MiniX_Component.register('Customer', Customer);
}