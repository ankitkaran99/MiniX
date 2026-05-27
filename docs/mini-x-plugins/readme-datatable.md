---
product: Mini-X DataTable
summary: Bridge DataTables with Mini-X cell components while letting DataTables keep control of the table DOM.
badges: ["DataTables","Cell mounts","Lifecycle bridge","x-ignore"]
highlights: ["Mount Mini-X components inside table cells","Clean redraw and destroy handling","Safe integration with x-ignore table regions"]
metrics: ["Bridge::Lifecycle sync","Cells::Component renderers","Redraw::Cleanup aware","Tables::DOM ownership"]
sidebar: Everything here focuses on mounting Mini-X components into DataTables cells, refreshing them across redraws, and avoiding DOM ownership conflicts.
---

# MiniX DataTable Plugin - README

> **Product:** Mini-X DataTable
> **Summary:** Bridge DataTables with Mini-X cell components while letting DataTables keep control of the table DOM.
> **Focus:** `DataTables` | `Cell mounts` | `Lifecycle bridge` | `x-ignore`
>
> **Key Highlights:**
> - Mount Mini-X components inside table cells
> - Clean redraw and destroy handling
> - Safe integration with x-ignore table regions
> **Metrics & Scope:**
> - **Bridge:** Lifecycle sync
> - **Cells:** Component renderers
> - **Redraw:** Cleanup aware
> - **Tables:** DOM ownership

---

MiniX

DataTables

Plugin

# MiniX DataTable Plugin

HTML README for the instance-based MiniX plugin that mounts MiniX components inside DataTables cells, while keeping the table area under `x-ignore` so the main app does not try to compile it.

The plugin owns the DataTable lifecycle. It listens to DataTables redraw events and mounts or destroys MiniX cell components as rows appear and disappear.

## What this plugin does

### Cell renderer helper

Use `app.$dtCell(Component, options)` inside a DataTables column definition.

### Lifecycle bridge

Use `app.$dataTable.attach(dt)` after DataTable init so MiniX can mount per-cell components.

### x-ignore friendly

The main MiniX app ignores the table. The plugin handles everything inside the DataTable region.

### Safe redraw cleanup

Components are unmounted on redraw and destroy, so row ghosts do not pile up in memory.

## Requirements

*   `mini-x.js`
*   `plugin-datatable.js`
*   jQuery
*   DataTables

```
<script src="https://code.jquery.com/jquery-3.7.1.min.js"></script>
<script src="https://cdn.datatables.net/1.13.8/js/jquery.dataTables.min.js"></script>
<script src="../../src/MiniX.js"></script>
<script src="../../src/mini-x-plugins/plugin-datatable.js"></script>
```

## Basic usage

### 1) Mark the table with x-ignore

```
<div id="app">
  <table id="usersTable" x-ignore class="display" style="width:100%">
    <thead>
      <tr>
        <th>ID</th>
        <th>Name</th>
        <th>Status</th>
        <th>Actions</th>
      </tr>
    </thead>
    <tbody></tbody>
  </table>
</div>
```

> [!NOTE]
> **Why x-ignore?** Because DataTables owns the table DOM. The main MiniX app should not try to compile it. The plugin will handle component creation inside the table after DataTable has initialized.

### 2) Create the MiniX app and install the plugin

```
class App {}

const app = MiniX.createApp(App);
app.use(MiniXDataTablePlugin);
app.mount('#app');
```

### 3) Define cell components

Inside DataTable-mounted components, prefer directives like `x-text`, `x-bind`, and `x-on` over raw moustache interpolation when possible.

```
class StatusBadge {
  data(props) {
    return {
      row: props.row
    };
  }

  computed = {
    badgeClass() {
      return this.row && this.row.status === 'active' ? 'active' : 'inactive';
    }
  };

  view = `
    <span class="badge" x-bind:class="badgeClass" x-text="row.status"></span>
  `;
}

class RowActions {
  data(props) {
    return {
      row: props.row
    };
  }

  methods = {
    edit() {
      alert('Edit row #' + this.row.id);
    },
    remove() {
      alert('Delete row #' + this.row.id);
    }
  };

  view = `
    <div class="btn-group">
      <button class="btn" x-on:click="edit">Edit</button>
      <button class="btn" x-on:click="remove">Delete</button>
    </div>
  `;
}
```

### 4) Use app.$dtCell in DataTables columns

```
const dt = $('#usersTable').DataTable({
  data: users,
  pageLength: 5,
  columns: [
    { data: 'id' },
    { data: 'name' },
    {
      data: 'status',
      render: app.$dtCell(StatusBadge, {
        className: 'd-inline-block',
        props(rowData) {
          return { row: rowData };
        }
      })
    },
    {
      data: null,
      orderable: false,
      searchable: false,
      render: app.$dtCell(RowActions, {
        className: 'd-inline-block',
        props(rowData) {
          return { row: rowData };
        }
      })
    }
  ]
});
```

### 5) Attach the DataTable bridge

```
app.$dataTable.attach(dt, {
  debug: false,
  onMounted(instance, ctx) {
    console.log('mounted row', ctx.rowData);
  },
  onBeforeUnmount(instance, ctx) {
    console.log('before unmount row', ctx.rowData);
  }
});
```

## Available API

| API | Purpose |
| --- | --- |
| `app.$dtCell(Component, options)` | Returns a DataTables render function that creates a MiniX mount placeholder for that cell. |
| `app.$dataTable.attach(dt, options)` | Starts listening to DataTables events and mounts MiniX components inside visible rows. |
| `app.$dataTable.detach(dt)` | Unmounts all active cell components and removes DataTables event listeners. |
| `app.$dataTable.refresh(dt)` | Forces unmount and remount of components in the current table state. |
| `app.$dataTable.defaults` | Default plugin options. |

## Cell renderer options

```
app.$dtCell(ComponentClass, {
  tag: 'div',
  className: 'd-inline-block',
  attrs: {
    'data-mode': 'compact'
  },
  html: '',
  mountOn: 'display',
  props(rowData, rowNode, dtApi, mountEl, meta) {
    return { row: rowData };
  }
});
```

| Option | Meaning |
| --- | --- |
| `tag` | Placeholder element tag. Default is `div`. |
| `className` | Extra classes added to the placeholder mount element. |
| `attrs` | Extra HTML attributes added to the placeholder mount element. |
| `html` | Optional HTML placed inside the placeholder before MiniX compiles it. |
| `mountOn` | Usually `display`. Non-display render types return normal cell data instead. |
| `props` | Function or object used to generate component props for that row. |

## Bridge options

```
app.$dataTable.attach(dt, {
  debug: false,
  visibleRowsOnly: true,
  includeChildRows: true,
  clearWhenNoRow: true,
  onMounted(instance, ctx) {},
  onBeforeUnmount(instance, ctx) {},
  props(entry, rowData, rowNode, dtApi, mountEl, meta) {
    return {
      row: rowData,
      rowIndex: meta.row,
      colIndex: meta.col,
      cellData: meta.cellData,
      dt: dtApi,
      mountEl: mountEl
    };
  }
});
```

| Option | Meaning |
| --- | --- |
| `debug` | Logs mount and unmount activity to the console. |
| `visibleRowsOnly` | Mount only for current page rows. Usually this is what you want. |
| `includeChildRows` | Also scan responsive child rows if DataTables creates them. |
| `clearWhenNoRow` | Clears placeholder HTML if row data is missing. |
| `props` | Global prop builder used before per-cell `options.props` is merged in. |
| `onMounted` | Called after a MiniX cell component is mounted. |
| `onBeforeUnmount` | Called right before a MiniX cell component is destroyed. |

## Lifecycle behavior

*   On `attach()`, the plugin immediately scans current DataTable rows and mounts cell components.
*   On `preDraw.dt`, it unmounts all active cell components.
*   On `draw.dt`, it mounts components again for the newly drawn rows.
*   On `column-visibility.dt` and `responsive-display.dt`, it refreshes mounts.
*   On `destroy.dt`, it cleans up everything.

Components are created only when row data is truthy. If a row does not exist, the plugin skips initialization.

## Recommended component style

### Prefer directives

```
view = `
  <span x-text="row.status"></span>
`;
```

### Avoid reserved prop names

Do not use these names in custom plugin props if you can avoid it:

```
el, $el, root, parent, props, $props, _props
```

Better names:

```
mountEl, row, dt, rowIndex, colIndex, cellData
```

## Complete example

```
<table id="usersTable" x-ignore class="display"></table>

<script>
class App {}

class StatusBadge {
  data(props) {
    return { row: props.row };
  }

  computed = {
    badgeClass() {
      return this.row.status === 'active' ? 'active' : 'inactive';
    }
  };

  view = `
    <span class="badge" x-bind:class="badgeClass" x-text="row.status"></span>
  `;
}

class RowActions {
  data(props) {
    return { row: props.row };
  }

  methods = {
    edit() {
      console.log('edit', this.row.id);
    },
    remove() {
      console.log('remove', this.row.id);
    }
  };

  view = `
    <div class="btn-group">
      <button class="btn" x-on:click="edit">Edit</button>
      <button class="btn" x-on:click="remove">Delete</button>
    </div>
  `;
}

const app = MiniX.createApp(App);
app.use(MiniXDataTablePlugin);
app.mount('#app');

const dt = $('#usersTable').DataTable({
  data: users,
  columns: [
    { data: 'id' },
    { data: 'name' },
    {
      data: 'status',
      render: app.$dtCell(StatusBadge, {
        props(rowData) {
          return { row: rowData };
        }
      })
    },
    {
      data: null,
      render: app.$dtCell(RowActions, {
        props(rowData) {
          return { row: rowData };
        }
      })
    }
  ]
});

app.$dataTable.attach(dt);
</script>
```

## Troubleshooting

### Cell is blank

*   Make sure the table has `x-ignore`.
*   Make sure you called `app.$dataTable.attach(dt)` after DataTable init.
*   Prefer `x-text` and `x-bind` over raw `{{ }}` interpolation.

### Buttons work but text interpolation does not

That usually means directives are being compiled but raw moustache interpolation is not being processed in that mount path. Switch text/class interpolation to directives.

### Getter-only property errors

Do not pass reserved prop names like `el`. Use `mountEl` instead.

### Components mount before data exists

The plugin should skip initialization unless `rowData` and `props.row` are both truthy.

MiniX DataTable Plugin README