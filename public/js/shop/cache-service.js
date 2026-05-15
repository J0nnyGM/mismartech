import { db, collection, query, where, orderBy, onSnapshot } from "../firebase-init.js";

// Memorias RAM (Ultrarrápidas)
let productsMap = {};
let categoriesCache = [];
let brandsCache = [];

export const SmartCache = {
    isListening: false,

    async init() {
        // 1. Intentar cargar todo desde el Disco Duro (LocalStorage) para pintar la pantalla en milisegundos
        try {
            const pData = localStorage.getItem('mismartech_master_catalog');
            if (pData) productsMap = JSON.parse(pData).map || {};
            
            const cData = localStorage.getItem('mismartech_categories');
            if (cData) categoriesCache = JSON.parse(cData) || [];

            const bData = localStorage.getItem('mismartech_brands');
            if (bData) brandsCache = JSON.parse(bData) || [];
            
            console.log(`📂 Caché local cargado: ${Object.keys(productsMap).length} Productos, ${categoriesCache.length} Categorías, ${brandsCache.length} Marcas.`);
        } catch (e) {
            console.warn("⚠️ Error leyendo caché local, se descargará fresco de la nube.");
        }

        // 2. Iniciar la escucha silenciosa en segundo plano
        if ('requestIdleCallback' in window) {
            requestIdleCallback(() => this.startListeners());
        } else {
            setTimeout(() => this.startListeners(), 1000);
        }
        
        return true;
    },

    startListeners() {
        if (this.isListening) return;
        this.isListening = true;
        console.log("📡 Conectando radares en tiempo real con Firebase...");

        // 🟢 RADAR 1: PRODUCTOS
        const qProducts = query(collection(db, "products"), where("status", "==", "active"));
        onSnapshot(qProducts, (snapshot) => {
            let hasChanges = false;
            // Solo procesamos lo que cambió para no saturar el celular del cliente
            snapshot.docChanges().forEach(change => {
                const data = change.doc.data();
                const id = change.doc.id;
                if (change.type === 'added' || change.type === 'modified') {
                    productsMap[id] = { id, ...data };
                    hasChanges = true;
                } else if (change.type === 'removed') {
                    delete productsMap[id];
                    hasChanges = true;
                }
            });
            if (hasChanges) {
                localStorage.setItem('mismartech_master_catalog', JSON.stringify({ map: productsMap, lastSync: Date.now() }));
                window.dispatchEvent(new Event('catalogUpdated')); // Avisar a la tienda
            }
        });

        // 🟢 RADAR 2: CATEGORÍAS
        const qCategories = query(collection(db, "categories"), orderBy("name", "asc"));
        onSnapshot(qCategories, (snapshot) => {
            const cats = [];
            snapshot.forEach(doc => cats.push({ id: doc.id, ...doc.data() }));
            
            // Verificamos si realmente hubo cambios comparando longitudes o datos crudos
            if(JSON.stringify(cats) !== JSON.stringify(categoriesCache)) {
                categoriesCache = cats;
                localStorage.setItem('mismartech_categories', JSON.stringify(categoriesCache));
                window.dispatchEvent(new Event('categoriesUpdated')); // Avisar a la tienda
            }
        });

        // 🟢 RADAR 3: MARCAS
        const qBrands = query(collection(db, "brands"), orderBy("name", "asc"));
        onSnapshot(qBrands, (snapshot) => {
            const brs = [];
            snapshot.forEach(doc => brs.push(doc.data()));
            
            if(JSON.stringify(brs) !== JSON.stringify(brandsCache)) {
                brandsCache = brs;
                localStorage.setItem('mismartech_brands', JSON.stringify(brandsCache));
                window.dispatchEvent(new Event('brandsUpdated')); // Avisar a la tienda
            }
        });
    },

    // --- PUERTAS DE ACCESO PARA APP.JS ---
    getAllProducts() { return Object.values(productsMap); },
    getProduct(id) { return productsMap[id]; },
    getCategories() { return categoriesCache; },
    getBrands() { return brandsCache; }
};