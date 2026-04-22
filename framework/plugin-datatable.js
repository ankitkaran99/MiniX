/*!
 * MiniX DataTable Plugin (instance-based, x-ignore friendly)
 *
 * Usage:
 *
 *   class App {}
 *   const app = MiniX.createApp(App);
 *   app.use(MiniXDataTablePlugin);
 *   app.mount('#app');
 *
 *   const dt = $('#usersTable').DataTable({
 *     columns: [
 *       { data: 'id' },
 *       { data: 'name' },
 *       { data: null, render: app.$dtCell(RowActions) }
 *     ]
 *   });
 *
 *   app.$dataTable.attach(dt);
 */

(function (global, factory) {
    if (typeof module === 'object' && typeof module.exports === 'object') {
        module.exports = factory(global, global.jQuery);
    } else {
        global.MiniXDataTablePlugin = factory(global, global.jQuery);
    }
})(typeof window !== 'undefined' ? window : globalThis, function (window, $) {
    'use strict';

    const STORE_KEY = '__mx_dt_store__';
    const INSTANCE_KEY = '__mx_dt_instance__';
    const META_KEY = '__mx_dt_meta__';

    const RESERVED_INSTANCE_KEYS = new Set([
        'el',
        '$el',
        'root',
        'parent',
        'props',
        '$props',
        '_props',
        'dt',
        'mountEl'
    ]);

    function escapeAttr(value) {
        return String(value)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }

    function encodeCellData(value) {
        if (value == null) return '';
        try {
            return JSON.stringify(value);
        } catch (e) {
            return JSON.stringify(String(value));
        }
    }

    function readCellData(mountEl) {
        const raw = mountEl.getAttribute('data-minix-dt-cell-data');
        if (raw == null || raw === '') return null;
        try {
            return JSON.parse(raw);
        } catch (e) {
            return raw;
        }
    }

    function resolveJQuery() {
        return $ || window.jQuery || window.$ || null;
    }

    function safeUnmount(instance) {
        if (!instance) return;
        if (typeof instance.unmount === 'function') return instance.unmount();
        if (typeof instance.destroy === 'function') return instance.destroy();
        if (typeof instance.$destroy === 'function') return instance.$destroy();
    }

    function ensurePluginState(app) {
        if (!app.__dtPlugin) {
            app.__dtPlugin = {
                uid: 1,
                cells: new Map()
            };
        }
        return app.__dtPlugin;
    }

    function getStore(tableNode) {
        if (!tableNode[STORE_KEY]) {
            tableNode[STORE_KEY] = {
                active: false,
                handlers: null,
                options: null
            };
        }
        return tableNode[STORE_KEY];
    }

    function clearStore(tableNode) {
        try {
            delete tableNode[STORE_KEY];
        } catch (e) {
            tableNode[STORE_KEY] = null;
        }
    }

    function getMountedInstance(el) {
        return el[INSTANCE_KEY] || null;
    }

    function setMountedInstance(el, instance) {
        el[INSTANCE_KEY] = instance;
    }

    function clearMountedInstance(el) {
        try {
            delete el[INSTANCE_KEY];
        } catch (e) {
            el[INSTANCE_KEY] = null;
        }
    }

    function getMeta(el) {
        return el[META_KEY] || null;
    }

    function setMeta(el, meta) {
        el[META_KEY] = meta;
    }

    function clearMeta(el) {
        try {
            delete el[META_KEY];
        } catch (e) {
            el[META_KEY] = null;
        }
    }

    const plugin = {
        name: 'DataTable',

   install(app) {
       if (!app) {
           throw new Error('MiniXDataTablePlugin.install requires app instance.');
       }
       $ = resolveJQuery();
       if (!$ || !$.fn || !$.fn.dataTable) {
           throw new Error('MiniXDataTablePlugin requires jQuery and DataTables.');
       }

       const state = ensurePluginState(app);

       const defaults = {
           mountSelector: '[data-minix-dt-cell]',
   debug: false,
   visibleRowsOnly: true,
   includeChildRows: true,
   clearWhenNoRow: true,

   props(entry, rowData, rowNode, dtApi, mountEl, meta) {
       return {
           row: rowData,
   rowIndex: meta.row,
   colIndex: meta.col,
   cellData: meta.cellData,
   dt: dtApi,
   mountEl: mountEl
       };
   },

   onMounted(instance, ctx) {},
   onBeforeUnmount(instance, ctx) {}
       };

       function log(options, ...args) {
           if (!options || !options.debug) return;
           console.log('[MiniX.DataTable]', ...args);
       }

       function getEntryFromElement(mountEl) {
           const id = mountEl.getAttribute('data-minix-dt-id');
           if (!id) return null;
           return state.cells.get(id) || null;
       }

       function makeCellRenderer(ComponentClass, options = {}) {
           if (!ComponentClass) {
               throw new Error('app.$dtCell(ComponentClass) requires a component.');
           }

           const id = 'mxdt_' + state.uid++;

           state.cells.set(id, {
               id,
               ComponentClass,
               options: {
                   tag: options.tag || 'div',
                   className: options.className || '',
                   attrs: options.attrs || {},
                   props: options.props || null,
                   html: options.html || '',
                   mountOn: options.mountOn || 'display'
               }
           });

           return function render(cellData, type, rowData, meta) {
               const entry = state.cells.get(id);
               if (!entry) return '';

               const mountOn = entry.options.mountOn || 'display';
               if (mountOn === 'display' && type !== 'display') {
                   return cellData == null ? '' : cellData;
               }

               const tag = entry.options.tag || 'div';
               const className = entry.options.className
               ? ' ' + escapeAttr(entry.options.className)
               : '';

               const attrString = Object.entries(entry.options.attrs || {})
               .map(([key, value]) => ` ${escapeAttr(key)}="${escapeAttr(String(value))}"`)
               .join('');

               let innerHtml = '';
               if (typeof entry.options.html === 'function') {
                   innerHtml = entry.options.html(cellData, type, rowData, meta) || '';
               } else {
                   innerHtml = entry.options.html || '';
               }

               return `<${tag}
               class="minix-dt-cell${className}"
               data-minix-dt-cell="1"
               data-minix-dt-id="${escapeAttr(id)}"
               data-minix-dt-row="${escapeAttr(meta && meta.row != null ? meta.row : '')}"
               data-minix-dt-col="${escapeAttr(meta && meta.col != null ? meta.col : '')}"
               data-minix-dt-cell-data="${escapeAttr(encodeCellData(cellData))}"
               ${attrString}
               >${innerHtml}</${tag}>`;
           };
       }

       function resolveProps(entry, rowData, rowNode, dtApi, mountEl, meta, mergedOptions) {
           let baseProps = mergedOptions.props(entry, rowData, rowNode, dtApi, mountEl, meta);

           if (!baseProps || typeof baseProps !== 'object') {
               baseProps = {};
           }

           const entryProps = entry.options.props;

           if (typeof entryProps === 'function') {
               const next = entryProps(rowData, rowNode, dtApi, mountEl, meta);
               if (next && typeof next === 'object') {
                   baseProps = Object.assign({}, baseProps, next);
               }
           } else if (entryProps && typeof entryProps === 'object') {
               baseProps = Object.assign({}, baseProps, entryProps);
           }

           if (typeof baseProps.row === 'undefined') {
               baseProps.row = rowData;
           }

           return baseProps;
       }

       function getComponentTemplate(ComponentClass) {
           let template = '';

           try {
               const probe = new ComponentClass();
               if (typeof probe.template === 'string') {
                   template = probe.template;
               }
           } catch (e) {}

           return template;
       }

       function createChildComponent(ComponentClass, props, mountEl) {
           const template = getComponentTemplate(ComponentClass);

           // Seed host DOM before mount because MiniX may read root.innerHTML as source template
           if (template) {
               mountEl.innerHTML = template;
           }

           const childApp = window.MiniX.createApp(ComponentClass, { props });

           if (!childApp || typeof childApp.mount !== 'function') {
               throw new Error('MiniX.createApp(Component, { props }) must return object with mount(el).');
           }

           // Important: mark as child mount so MiniX does not treat it as standalone root app
           childApp.parent = app;

           // Defensive template seeding for MiniX internal mount path
           childApp._initialTemplate = template || mountEl.innerHTML || '';
           childApp._initialTemplateCaptured = true;

           try {
               childApp.props = props;
               childApp._props = props;

               if (childApp.instance) {
                   childApp.instance.props = props;
                   childApp.instance.$props = props;
               }
           } catch (e) {}

           const mounted = childApp.mount(mountEl);
           const instance = mounted || childApp;

           try {
               if (instance && typeof instance === 'object') {
                   if (typeof instance.props === 'undefined') {
                       instance.props = props;
                   }

                   Object.keys(props || {}).forEach((key) => {
                       if (RESERVED_INSTANCE_KEYS.has(key)) return;

                       try {
                           if (typeof instance[key] === 'undefined') {
                               instance[key] = props[key];
                           }
                       } catch (e) {}
                   });
               }
           } catch (e) {}

           return instance;
       }

       function mountOne(dtApi, rowNode, mountEl, mergedOptions) {
           if (!mountEl || getMountedInstance(mountEl)) return;

           const entry = getEntryFromElement(mountEl);
           if (!entry || !entry.ComponentClass) return;

           let rowData = null;
           try {
               rowData = dtApi.row(rowNode).data();
           } catch (e) {}

           // Absolutely no component init until row data exists
           if (!rowData) {
               if (mergedOptions.clearWhenNoRow) {
                   mountEl.innerHTML = '';
               }
               return;
           }

           const meta = {
               row: mountEl.getAttribute('data-minix-dt-row'),
   col: mountEl.getAttribute('data-minix-dt-col'),
   cellData: readCellData(mountEl)
           };

           const props = resolveProps(entry, rowData, rowNode, dtApi, mountEl, meta, mergedOptions);

           // Still no init if resolved props does not contain row
           if (!props || !props.row) {
               if (mergedOptions.clearWhenNoRow) {
                   mountEl.innerHTML = '';
               }
               return;
           }

           try {
               const instance = createChildComponent(entry.ComponentClass, props, mountEl);

               setMountedInstance(mountEl, instance);
               setMeta(mountEl, {
                   entry,
                   rowData,
                   rowNode,
                   dtApi,
                   props
               });

               mergedOptions.onMounted(instance, {
                   mountEl,
                   rowNode,
                   rowData,
                   props,
                   entry,
                   dt: dtApi
               });

               log(
                   mergedOptions,
                   'mounted',
                   entry.ComponentClass.name || 'AnonymousComponent',
                   props.row
               );
           } catch (err) {
               console.error('[MiniX.DataTable] mount failed', err, mountEl);
           }
       }

       function unmountOne(mountEl, mergedOptions) {
           if (!mountEl) return;

           const instance = getMountedInstance(mountEl);
           const meta = getMeta(mountEl);

           if (!instance) {
               clearMeta(mountEl);
               return;
           }

           try {
               mergedOptions.onBeforeUnmount(instance, Object.assign({ mountEl }, meta || {}));
           } catch (err) {
               console.error('[MiniX.DataTable] onBeforeUnmount failed', err);
           }

           try {
               safeUnmount(instance);
           } catch (err) {
               console.error('[MiniX.DataTable] unmount failed', err, mountEl);
           }

           clearMountedInstance(mountEl);
           clearMeta(mountEl);
       }

       function getRows(dtApi, mergedOptions) {
           const rowsApi = mergedOptions.visibleRowsOnly
           ? dtApi.rows({ page: 'current' })
           : dtApi.rows();

           return rowsApi.nodes().toArray();
       }

       function mountRow(dtApi, rowNode, mergedOptions) {
           if (!rowNode || rowNode.nodeType !== 1) return;
           const mounts = rowNode.querySelectorAll(mergedOptions.mountSelector);
           mounts.forEach((el) => mountOne(dtApi, rowNode, el, mergedOptions));
       }

       function mountAll(dtApi, mergedOptions) {
           const rows = getRows(dtApi, mergedOptions);
           rows.forEach((rowNode) => mountRow(dtApi, rowNode, mergedOptions));

           if (mergedOptions.includeChildRows) {
               const container = dtApi.table().container();
               const childRows = container.querySelectorAll('tr.child');
               childRows.forEach((rowNode) => mountRow(dtApi, rowNode, mergedOptions));
           }
       }

       function unmountAll(dtApi, mergedOptions) {
           const container = dtApi.table().container();
           const mounts = container.querySelectorAll(mergedOptions.mountSelector);
           mounts.forEach((el) => unmountOne(el, mergedOptions));
       }

       function bind(dtApi, mergedOptions) {
           const tableNode = dtApi.table().node();
           const $table = $(tableNode);
           const store = getStore(tableNode);

           const handlers = {
               preDraw() {
                   unmountAll(dtApi, mergedOptions);
               },
               draw() {
                   mountAll(dtApi, mergedOptions);
               },
               columnVisibility() {
                   unmountAll(dtApi, mergedOptions);
                   mountAll(dtApi, mergedOptions);
               },
               responsiveDisplay() {
                   unmountAll(dtApi, mergedOptions);
                   mountAll(dtApi, mergedOptions);
               },
               destroy() {
                   unmountAll(dtApi, mergedOptions);
                   unbind(dtApi);
                   clearStore(tableNode);
               }
           };

           const ns = {
               preDraw: 'preDraw.dt.minixdt',
               draw: 'draw.dt.minixdt',
               columnVisibility: 'column-visibility.dt.minixdt',
               responsiveDisplay: 'responsive-display.dt.minixdt',
               destroy: 'destroy.dt.minixdt'
           };

           $table.on(ns.preDraw, handlers.preDraw);
           $table.on(ns.draw, handlers.draw);
           $table.on(ns.columnVisibility, handlers.columnVisibility);
           $table.on(ns.responsiveDisplay, handlers.responsiveDisplay);
           $table.on(ns.destroy, handlers.destroy);

           store.handlers = { ns, handlers };
       }

       function unbind(dtApi) {
           const tableNode = dtApi.table().node();
           const $table = $(tableNode);
           const store = getStore(tableNode);

           if (!store.handlers || !store.handlers.ns) return;

           Object.values(store.handlers.ns).forEach((evt) => $table.off(evt));
           store.handlers = null;
       }

       function attach(dtApi, options = {}) {
           if (!dtApi || typeof dtApi.table !== 'function') {
               throw new Error('app.$dataTable.attach(dtApi) expects an initialized DataTables API instance.');
           }

           const tableNode = dtApi.table().node();
           const store = getStore(tableNode);

           if (store.active) {
               unmountAll(dtApi, store.options || defaults);
               unbind(dtApi);
           }

           const mergedOptions = Object.assign({}, defaults, options);

           store.active = true;
           store.options = mergedOptions;

           bind(dtApi, mergedOptions);

           // DataTable already owns the x-ignore DOM at this point
           mountAll(dtApi, mergedOptions);

           return api(dtApi);
       }

       function detach(dtApi) {
           const tableNode = dtApi.table().node();
           const store = getStore(tableNode);
           const mergedOptions = store.options || defaults;

           unmountAll(dtApi, mergedOptions);
           unbind(dtApi);

           store.active = false;
           store.options = null;

           return api(dtApi);
       }

       function refresh(dtApi) {
           const tableNode = dtApi.table().node();
           const store = getStore(tableNode);
           const mergedOptions = store.options || defaults;

           unmountAll(dtApi, mergedOptions);
           mountAll(dtApi, mergedOptions);

           return api(dtApi);
       }

       function api(dtApi) {
           return {
               attach(options) {
                   return attach(dtApi, options);
               },
               detach() {
                   return detach(dtApi);
               },
               refresh() {
                   return refresh(dtApi);
               },
               mountAll() {
                   const store = getStore(dtApi.table().node());
                   return mountAll(dtApi, store.options || defaults);
               },
               unmountAll() {
                   const store = getStore(dtApi.table().node());
                   return unmountAll(dtApi, store.options || defaults);
               }
           };
       }

       app.$dtCell = makeCellRenderer;

       app.$dataTable = {
           attach,
           detach,
           refresh,
           defaults,
           api
       };
   }
    };

    return plugin;
});
