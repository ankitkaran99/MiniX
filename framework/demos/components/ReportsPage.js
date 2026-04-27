// ReportsPage.js – lazy component definition
class ReportsPage {
  data() {
    return {
      period: 'month',
      data: null,
      loading: false
    };
  }

  methods = {
    async loadReport() {
      this.loading = true;
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 600));
      if (this.period === 'month') {
        this.data = { revenue: 12450, users: 342 };
      } else {
        this.data = { revenue: 38720, users: 980 };
      }
      this.loading = false;
    }
  };

  mounted() {
    this.loadReport();
  }

  view = `
      <div>
        <h2>📊 Reports Dashboard</h2>
        <div class="card">
          <label>Period</label>
          <select x-model="period" @change="loadReport">
            <option value="month">This month</option>
            <option value="quarter">This quarter</option>
          </select>

          <div x-show="loading" style="margin-top: 12px;">Loading report...</div>
          <div x-show="!loading && data" style="margin-top: 12px;">
            <p>Revenue: <strong>INR {{ data.revenue }}</strong></p>
            <p>Active users: <strong>{{ data.users }}</strong></p>
          </div>
        </div>
      </div>
    `;
}

// Register the component globally (required for lazy loading)
if (typeof MiniX_Component !== 'undefined') {
  MiniX_Component.register('ReportsPage', ReportsPage);
}
