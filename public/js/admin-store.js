// public/js/admin-store.js
import { db, collection, query, where, onSnapshot } from './firebase-init.js';

const normalizeText = (str) => str ? str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") : "";

// ==========================================================================
// 🧬 CLASE MAESTRA: Delta Sync 3.0 (Zero Index Required)
// ==========================================================================
class StoreModule {
    constructor(config) {
        this.name = config.name;
        this.collectionName = config.collection;
        this.storageKey = `pixeltech_core_${config.name}`;
        this.dateField = config.dateField || 'createdAt';
        this.queryConstraints = config.queryConstraints || [];
        this.clientSideFilter = config.clientSideFilter || null;
        this.searchFields = config.searchFields || [];
        this.mapLightweight = config.lightweight || ((data) => data); 

        this.listeners = [];
        this.runtimeMap = {};
        this.lastSyncTime = 0;
        this.unsubscribeFirebase = null;

        this.loadFromCache();
    }

    loadFromCache() {
        const cached = localStorage.getItem(this.storageKey);
        if (cached) {
            try {
                const parsed = JSON.parse(cached);
                this.runtimeMap = parsed.map || {};
                this.lastSyncTime = parsed.lastSync || 0;
            } catch (e) { localStorage.removeItem(this.storageKey); }
        }
    }

    subscribe(callback) {
        this.listeners.push(callback);
        
        // Entregar datos cacheados inmediatamente (Pantallas rápidas)
        if (Object.keys(this.runtimeMap).length > 0 || this.lastSyncTime > 0) {
            callback(this.getSortedArray());
        }

        if (!this.unsubscribeFirebase) {
            this.connectFirebase();
        }

        return () => {
            this.listeners = this.listeners.filter(cb => cb !== callback);
        };
    }

    connectFirebase(forceFullSync = false) {
        if (this.unsubscribeFirebase) this.unsubscribeFirebase();

        const colRef = collection(db, this.collectionName);
        let q;

        if (this.lastSyncTime === 0 || forceFullSync) {
            // CARGA INICIAL: Usamos los filtros directos en Firebase (Sin índices complejos)
            // para evitar descargar miles de datos que no nos interesan.
            if (forceFullSync) this.runtimeMap = {}; 
            q = query(colRef, ...this.queryConstraints);
            console.log(`☁️ [Store: ${this.name}] Descarga inicial limpia.`);
        } else {
            // DELTA SYNC: Le pedimos a Firebase CUALQUIER cosa que haya cambiado.
            // No usamos queryConstraints aquí para no romper Firebase con falta de índices compuestos.
            const serverDate = new Date(this.lastSyncTime);
            q = query(colRef, where("updatedAt", ">", serverDate));
            console.log(`🔄 [Store: ${this.name}] Buscando deltas desde:`, serverDate.toLocaleString());
        }

        this.unsubscribeFirebase = onSnapshot(q, (snapshot) => {
            // Si no hay nada, notificar a la UI para apagar las rueditas de carga (Spinners)
            if (snapshot.empty && !forceFullSync) {
                if (this.lastSyncTime === 0) {
                    this.lastSyncTime = Date.now();
                    this.notifyAll(); 
                }
                return;
            }

            let hasChanges = false;
            let maxTimestampSeen = this.lastSyncTime;

            snapshot.docChanges().forEach(change => {
                const data = change.doc.data();
                const id = change.doc.id;

                // Detectar la hora del servidor (Cura contra el desajuste de hora en PC)
                let docTime = 0;
                if (data.updatedAt) docTime = data.updatedAt.toDate ? data.updatedAt.toDate().getTime() : new Date(data.updatedAt).getTime();
                else if (data[this.dateField]) docTime = data[this.dateField].toDate ? data[this.dateField].toDate().getTime() : new Date(data[this.dateField]).getTime();
                
                if (docTime > maxTimestampSeen) maxTimestampSeen = docTime;

                if (!data.updatedAt && data[this.dateField]) data.updatedAt = data[this.dateField];

                if (this.searchFields.length > 0) {
                    const searchParts = this.searchFields.map(field => field.split('.').reduce((o, i) => o ? o[i] : '', data) || '');
                    data.searchStr = normalizeText(searchParts.join(' '));
                }

                if (change.type === 'added' || change.type === 'modified') {
                    // 🔥 MAGIA DE RAM: Si un pedido pasó de PENDIENTE a PAGADO, el filtro
                    // local detectará que ya no pertenece aquí y lo borrará sin consultar a la BD.
                    if (this.clientSideFilter && !this.clientSideFilter(data)) {
                        if (this.runtimeMap[id]) {
                            delete this.runtimeMap[id];
                            hasChanges = true;
                        }
                    } else {
                        data.dateObj = data[this.dateField]?.toDate ? data[this.dateField].toDate() : new Date(data[this.dateField] || Date.now());
                        this.runtimeMap[id] = { id, ...data };
                        hasChanges = true;
                    }
                } else if (change.type === 'removed') {
                    if (this.runtimeMap[id]) {
                        delete this.runtimeMap[id];
                        hasChanges = true;
                    }
                }
            });

            // Actualizar vista y disco si hubo novedades
            if (hasChanges || forceFullSync || this.lastSyncTime === 0) {
                this.lastSyncTime = maxTimestampSeen || Date.now();
                this.saveToCache();
                this.notifyAll();
            }
        }, e => {
            console.error(`Error Store (${this.name}):`, e);
            // Notificar a la UI en caso de error para que no se quede cargando infinito
            this.notifyAll();
        });
    }

    saveToCache() {
        const sortedArray = this.getSortedArray();
        const lightMap = {};
        
        const limitDate = new Date();
        limitDate.setMonth(limitDate.getMonth() - 3);

        sortedArray.forEach(item => {
            if (['products', 'clients', 'accounts'].includes(this.name) || !item.dateObj || item.dateObj >= limitDate) {
                lightMap[item.id] = this.mapLightweight(item);
            }
        });

        localStorage.setItem(this.storageKey, JSON.stringify({ map: lightMap, lastSync: this.lastSyncTime }));
    }

    getSortedArray() {
        return Object.values(this.runtimeMap).sort((a, b) => {
            const dateA = a[this.dateField]?.seconds || (a.dateObj ? a.dateObj.getTime() : 0);
            const dateB = b[this.dateField]?.seconds || (b.dateObj ? b.dateObj.getTime() : 0);
            return dateB - dateA;
        });
    }

    notifyAll() {
        const data = this.getSortedArray();
        this.listeners.forEach(cb => cb(data));
    }

    forceSync() {
        console.log(`[Store] Limpieza y Sincronización Forzada en: ${this.name}`);
        this.connectFirebase(true);
    }
}

// ==========================================================================
// 🏭 INSTANCIACIÓN DE MÓDULOS (Configuración Inteligente)
// ==========================================================================

const modules = {
    products: new StoreModule({
        name: 'products',
        collection: 'products',
        dateField: 'createdAt',
        searchFields: ['name', 'brand', 'sku', 'category'],
        lightweight: (p) => ({ id: p.id, name: p.name, price: p.price, originalPrice: p.originalPrice || 0, stock: p.stock || 0, status: p.status, sku: p.sku || '', category: p.category || '', brand: p.brand || '', mainImage: p.mainImage || p.image || (p.images ? p.images[0] : ''), combinations: p.combinations || [], capacities: p.capacities || [], promoEndsAt: p.promoEndsAt || null, searchStr: p.searchStr, createdAt: p.createdAt, updatedAt: p.updatedAt })
    }),
    
    clients: new StoreModule({
        name: 'clients',
        collection: 'users',
        dateField: 'createdAt',
        searchFields: ['name', 'userName', 'phone', 'document', 'email'],
        lightweight: (c) => ({ id: c.id, name: c.name, userName: c.userName || '', phone: c.phone || '', email: c.email || '', document: c.document || '', source: c.source || 'WEB', role: c.role || 'client', adminNotes: c.adminNotes || '', address: c.address || '', dept: c.dept || '', city: c.city || '', addresses: c.addresses || [], searchStr: c.searchStr, createdAt: c.createdAt, updatedAt: c.updatedAt })
    }),

    receivables: new StoreModule({
        name: 'receivables',
        collection: 'orders',
        dateField: 'createdAt',
        queryConstraints: [where("paymentStatus", "in", ["PENDING", "PARTIAL"])],
        clientSideFilter: (o) => ['PENDING', 'PARTIAL'].includes(o.paymentStatus) && !['CANCELADO', 'RECHAZADO'].includes(o.status),
        lightweight: (o) => ({ id: o.id, userId: o.userId, userName: o.userName, billingInfo: o.billingInfo, shippingData: o.shippingData, total: o.total, amountPaid: o.amountPaid, paymentStatus: o.paymentStatus, status: o.status, createdAt: o.createdAt, updatedAt: o.updatedAt })
    }),

    payables: new StoreModule({
        name: 'payables',
        collection: 'payables',
        dateField: 'createdAt',
        queryConstraints: [where("status", "==", "PENDING")],
        clientSideFilter: (p) => p.status === 'PENDING',
        lightweight: (p) => ({ id: p.id, provider: p.provider, description: p.description, total: p.total, amountPaid: p.amountPaid, balance: p.balance, dueDate: p.dueDate, status: p.status, createdAt: p.createdAt, updatedAt: p.updatedAt })
    }),

    expenses: new StoreModule({
        name: 'expenses',
        collection: 'expenses',
        dateField: 'date', 
        queryConstraints: [where("type", "==", "EXPENSE")],
        clientSideFilter: (e) => e.type === 'EXPENSE',
        lightweight: (e) => ({ id: e.id, description: e.description, amount: e.amount, type: e.type, category: e.category, paymentMethod: e.paymentMethod, date: e.date, createdAt: e.createdAt, supplierName: e.supplierName, updatedAt: e.updatedAt })
    }),

    purchases: new StoreModule({
        name: 'purchases',
        collection: 'purchases',
        dateField: 'createdAt',
        lightweight: (p) => ({ id: p.id, supplierName: p.supplierName, totalCost: p.totalCost, createdBy: p.createdBy, createdAt: p.createdAt, items: p.items, hasIVA: p.hasIVA, updatedAt: p.updatedAt })
    }),

    warranties: new StoreModule({
        name: 'warranties',
        collection: 'warranties',
        dateField: 'createdAt',
        lightweight: (w) => ({ id: w.id, status: w.status, orderId: w.orderId, userName: w.userName, userEmail: w.userEmail, productName: w.productName, productImage: w.productImage, snProvided: w.snProvided, reason: w.reason, createdAt: w.createdAt, updatedAt: w.updatedAt })
    }),

    rma: new StoreModule({
        name: 'rma',
        collection: 'warranty_inventory',
        dateField: 'entryDate',
        lightweight: (w) => ({ id: w.id, productName: w.productName, sn: w.sn, status: w.status, notes: w.notes, exitDestination: w.exitDestination, exitNotes: w.exitNotes, entryDate: w.entryDate, updatedAt: w.updatedAt })
    }),

    invoices: new StoreModule({
        name: 'invoices',
        collection: 'orders',
        dateField: 'createdAt',
        queryConstraints: [where("requiresInvoice", "==", true)],
        clientSideFilter: (i) => i.requiresInvoice === true,
        lightweight: (i) => ({ id: i.id, billingStatus: i.billingStatus, billingInfo: i.billingInfo, billingData: i.billingData, userName: i.userName, clientDoc: i.clientDoc, total: i.total, invoiceUrl: i.invoiceUrl, invoiceNumber: i.invoiceNumber, createdAt: i.createdAt, updatedAt: i.updatedAt })
    }),

    accounts: new StoreModule({
        name: 'accounts',
        collection: 'accounts',
        dateField: 'createdAt', 
        lightweight: (a) => ({ id: a.id, name: a.name, type: a.type, balance: a.balance, isExempt: a.isExempt, updatedAt: a.updatedAt })
    })
};

// ==========================================================================
// 🚀 EXPORTACIÓN FINAL (API PÚBLICA)
// ==========================================================================

export const AdminStore = {
    subscribeToProducts: (cb) => modules.products.subscribe(cb),
    subscribeToClients: (cb) => modules.clients.subscribe(cb),
    subscribeToReceivables: (cb) => modules.receivables.subscribe(cb),
    subscribeToPayables: (cb) => modules.payables.subscribe(cb),
    subscribeToExpenses: (cb) => modules.expenses.subscribe(cb),
    subscribeToPurchases: (cb) => modules.purchases.subscribe(cb),
    subscribeToWarranties: (cb) => modules.warranties.subscribe(cb),
    subscribeToRma: (cb) => modules.rma.subscribe(cb),
    subscribeToInvoices: (cb) => modules.invoices.subscribe(cb),
    subscribeToAccounts: (cb) => modules.accounts.subscribe(cb),

    forceSyncAll() {
        Object.values(modules).forEach(mod => mod.forceSync());
    }
};