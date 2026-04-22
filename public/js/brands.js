import { db, collection, query, orderBy, where, onSnapshot } from "./firebase-init.js";

const grid = document.getElementById('brands-grid');

// Variables de estado
let brandsData = [];
const STORAGE_KEY = 'pixeltech_brands_smart';
let isListening = false; // Evita abrir múltiples canales de WebSockets

// ==========================================================================
// 🧠 SMART REAL-TIME CACHE (Máxima Eficiencia con onSnapshot)
// ==========================================================================
function loadBrands() {
    // 1. CARGA INICIAL (Instantánea desde Memoria)
    const cachedRaw = localStorage.getItem(STORAGE_KEY);
    let lastSyncTime = 0;

    if (cachedRaw) {
        try {
            const parsed = JSON.parse(cachedRaw);
            
            // Validación de integridad
            const isCacheValid = parsed.map && parsed.lastSync;
            
            if (!isCacheValid) {
                console.warn("⚠️ Caché antigua o corrupta. Limpiando...");
                brandsData = [];
                lastSyncTime = 0; 
                localStorage.removeItem(STORAGE_KEY);
            } else {
                // El caché ahora se guarda como un objeto { map: {...}, lastSync: 12345 }
                brandsData = Object.values(parsed.map || {});
                lastSyncTime = parsed.lastSync || 0;

                if (brandsData.length > 0) {
                    console.log(`⚡ [Brands] Cargadas ${brandsData.length} marcas de caché instantáneo.`);
                    renderGrid(); 
                }
            }
        } catch (e) {
            brandsData = [];
            lastSyncTime = 0;
        }
    }

    // 2. INICIAR ESCUCHA EN TIEMPO REAL (Solo por los deltas/cambios)
    listenForUpdates(lastSyncTime);
}

function listenForUpdates(lastSyncTime) {
    if (isListening) return;
    isListening = true;

    const colRef = collection(db, "brands");
    let q;

    if (lastSyncTime === 0 || brandsData.length === 0) {
        console.log("☁️ [Brands] Descarga completa inicial y activando tiempo real...");
        q = query(colRef); 
    } else {
        console.log("🔄 [Brands] Escuchando actualizaciones en la nube desde:", new Date(lastSyncTime).toLocaleString());
        q = query(colRef, where("updatedAt", ">", new Date(lastSyncTime)));
    }

    onSnapshot(q, (snapshot) => {
        if (snapshot.empty) {
            if (lastSyncTime !== 0) console.log("✅ [Brands] Caché 100% sincronizado.");
            return;
        }

        let hasChanges = false;
        
        // Transformamos brandsData (Array) en un Diccionario para fusiones ultrarrápidas O(1)
        let runtimeMap = {};
        brandsData.forEach(b => runtimeMap[b.id] = b);

        snapshot.docChanges().forEach(change => {
            const data = change.doc.data();
            const id = change.doc.id;

            if (change.type === 'added' || change.type === 'modified') {
                runtimeMap[id] = { id, ...data };
                hasChanges = true;
            } else if (change.type === 'removed') {
                if (runtimeMap[id]) {
                    delete runtimeMap[id];
                    hasChanges = true;
                }
            }
        });

        if (hasChanges) {
            console.log(`🔥 [Brands] Tiempo real: Procesando ${snapshot.docChanges().length} modificaciones.`);
            
            // Volver a convertir en Array y Ordenar
            brandsData = Object.values(runtimeMap);
            brandsData.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

            // Guardar Estado Inteligente
            const stateToSave = {
                map: runtimeMap,
                lastSync: Date.now()
            };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(stateToSave));
            
            // Re-renderizar la grilla visualmente
            renderGrid();
        }

    }, (error) => {
        console.error("Error en SmartSync Realtime Brands:", error);
    });
}

// ==========================================================================
// RENDERIZADO (UI)
// ==========================================================================
function renderGrid() {
    grid.innerHTML = ""; 

    if (brandsData.length === 0) {
        grid.innerHTML = `<p class="col-span-full text-center text-gray-400 font-bold uppercase py-10">No hay marcas registradas.</p>`;
        return;
    }

    brandsData.forEach((brand) => {
        const imageSrc = brand.image || 'https://placehold.co/400x300?text=' + encodeURIComponent(brand.name || 'Marca');
        
        const card = document.createElement('a');
        card.href = `/shop/search.html?brand=${encodeURIComponent(brand.name)}`;
        
        card.className = "group relative bg-white rounded-[2rem] border border-gray-100 overflow-hidden shadow-sm hover:shadow-2xl hover:border-brand-cyan/30 transition-all duration-300 hover:-translate-y-2 cursor-pointer h-56 flex flex-col";

        card.innerHTML = `
            <div class="absolute inset-0 bg-gray-50 flex items-center justify-center p-8 group-hover:bg-white transition duration-500">
                <img src="${imageSrc}" alt="${brand.name}" class="max-w-full max-h-full object-contain group-hover:scale-110 transition duration-500">
            </div>

            <div class="relative z-10 mt-auto p-4 w-full bg-white/90 backdrop-blur-sm border-t border-gray-50 flex justify-between items-center translate-y-full group-hover:translate-y-0 transition-transform duration-300">
                <h3 class="text-brand-black font-black text-xs uppercase tracking-wider">
                    ${brand.name}
                </h3>
                <i class="fa-solid fa-arrow-right text-[10px] text-brand-cyan"></i>
            </div>
            
            <div class="absolute top-4 right-4 z-10 opacity-0 group-hover:opacity-100 transition duration-300">
                <span class="bg-brand-black text-white text-[8px] font-bold px-2 py-1 rounded-md uppercase tracking-widest">Ver Productos</span>
            </div>
        `;

        grid.appendChild(card);
    });
}

document.addEventListener('DOMContentLoaded', loadBrands);