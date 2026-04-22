import { db, collection, query, orderBy, where, onSnapshot } from "./firebase-init.js";

const mainGrid = document.getElementById('categories-grid');
const subGrid = document.getElementById('subcategories-grid');
const mainView = document.getElementById('main-view');
const subView = document.getElementById('sub-view');
const currentCatNameEl = document.getElementById('current-cat-name');
const btnViewAllSub = document.getElementById('btn-view-all-sub'); 

// Estado en memoria
let categoriesData = [];

// Claves de almacenamiento
const STORAGE_KEY = 'pixeltech_categories_smart';
let isListening = false; // Evita múltiples conexiones simultáneas

// ==========================================================================
// 🧠 SMART REAL-TIME CACHE (Máxima Eficiencia con onSnapshot)
// ==========================================================================
function loadCategories() {
    // 1. CARGA INICIAL (Instantánea desde Memoria)
    const cachedRaw = localStorage.getItem(STORAGE_KEY);
    let lastSyncTime = 0;

    if (cachedRaw) {
        try {
            const parsed = JSON.parse(cachedRaw);
            
            // Validación de la nueva estructura de caché
            const isCacheValid = parsed.map && parsed.lastSync;
            
            if (!isCacheValid) {
                console.warn("⚠️ Caché de categorías antiguo o corrupto. Limpiando...");
                categoriesData = [];
                lastSyncTime = 0;
                localStorage.removeItem(STORAGE_KEY);
            } else {
                categoriesData = Object.values(parsed.map || {});
                lastSyncTime = parsed.lastSync || 0;

                if (categoriesData.length > 0) {
                    console.log(`⚡ [Categories] Cargadas ${categoriesData.length} categorías de caché instantáneo.`);
                    renderMainGrid();
                }
            }
        } catch (e) {
            console.warn("Caché corrupto, reiniciando...");
            categoriesData = [];
            lastSyncTime = 0;
        }
    }

    // 2. INICIAR ESCUCHA EN TIEMPO REAL (Solo Deltas)
    listenForUpdates(lastSyncTime);
}

function listenForUpdates(lastSyncTime) {
    if (isListening) return;
    isListening = true;

    const colRef = collection(db, "categories");
    let q;

    // CASO 1: Primera vez (Descarga Todo)
    if (lastSyncTime === 0 || categoriesData.length === 0) {
        console.log("☁️ [Categories] Descarga completa inicial y activando tiempo real...");
        q = query(colRef); 
    } 
    // CASO 2: Actualización Incremental (Solo cambios)
    else {
        console.log("🔄 [Categories] Escuchando actualizaciones en la nube desde:", new Date(lastSyncTime).toLocaleString());
        q = query(colRef, where("updatedAt", ">", new Date(lastSyncTime)));
    }

    onSnapshot(q, (snapshot) => {
        if (snapshot.empty) {
            if (lastSyncTime !== 0) console.log("✅ [Categories] Caché 100% sincronizado.");
            return; 
        }

        let hasChanges = false;
        
        // Transformamos categoriesData a Diccionario para fusiones O(1)
        let runtimeMap = {};
        categoriesData.forEach(c => runtimeMap[c.id] = c);

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
            console.log(`🔥 [Categories] Tiempo real: Procesando ${snapshot.docChanges().length} modificaciones.`);
            
            // Volver a convertir en Array y Ordenar
            categoriesData = Object.values(runtimeMap);
            categoriesData.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

            // Guardar Estado Inteligente
            const stateToSave = {
                map: runtimeMap,
                lastSync: Date.now()
            };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(stateToSave));

            // Re-renderizamos la vista principal con los datos frescos
            renderMainGrid();
            
            // Si el usuario está viendo una subcategoría, actualizamos esa vista también si la categoría actual cambió
            if (!subView.classList.contains('hidden') && currentCatNameEl.textContent) {
                const currentCatIndex = categoriesData.findIndex(c => c.name === currentCatNameEl.textContent);
                if (currentCatIndex !== -1) {
                    window.showSubcategories(currentCatIndex); // Repinta la subcategoría en caliente
                } else {
                    // Si la categoría que estaba viendo fue borrada, lo regresamos al inicio
                    window.showMainCategories();
                }
            }
        }
    }, (error) => {
        console.error("Error en SmartSync Realtime Categories:", error);
    });
}

// ==========================================================================
// RENDERIZADO (UI) - Sin cambios en lógica visual
// ==========================================================================

function renderMainGrid() {
    mainGrid.innerHTML = "";

    if (categoriesData.length === 0) {
        mainGrid.innerHTML = `<p class="col-span-full text-center text-gray-400">Sin departamentos disponibles.</p>`;
        return;
    }

    categoriesData.forEach((cat, index) => {
        const imageSrc = cat.image || 'https://placehold.co/400x300';
        const subCount = cat.subcategories ? cat.subcategories.length : 0;

        const card = document.createElement('div');
        card.onclick = () => showSubcategories(index);
        
        card.className = "group relative bg-white rounded-[2rem] border border-gray-100 overflow-hidden shadow-sm hover:shadow-2xl hover:shadow-brand-cyan/20 hover:border-brand-cyan/50 transition-all duration-500 hover:-translate-y-2 cursor-pointer h-72 flex flex-col";

        card.innerHTML = `
            <div class="absolute inset-0 bg-gray-100 overflow-hidden">
                <img src="${imageSrc}" alt="${cat.name}" class="w-full h-full object-cover group-hover:scale-110 transition duration-700 ease-out opacity-90 group-hover:opacity-100">
                <div class="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-60 group-hover:opacity-80 transition-opacity"></div>
            </div>
            
            <div class="relative z-10 mt-auto p-6">
                <div class="w-8 h-1 bg-brand-cyan mb-3 w-0 group-hover:w-8 transition-all duration-300 ease-out"></div>
                <h3 class="text-white font-black text-2xl uppercase tracking-tighter leading-none mb-1 drop-shadow-md group-hover:text-brand-cyan transition-colors">
                    ${cat.name}
                </h3>
                <p class="text-gray-300 text-[10px] font-bold uppercase tracking-widest opacity-80 group-hover:opacity-100 transition flex items-center gap-2 transform translate-y-2 group-hover:translate-y-0 duration-300">
                    ${subCount} Colecciones <i class="fa-solid fa-arrow-right"></i>
                </p>
            </div>
        `;
        mainGrid.appendChild(card);
    });
}

window.showSubcategories = (index) => {
    const cat = categoriesData[index];
    const subcategories = cat.subcategories || [];

    if (btnViewAllSub) {
        btnViewAllSub.href = `/shop/catalog.html?category=${encodeURIComponent(cat.name)}`;
    }

    if (subcategories.length === 0) {
        window.location.href = `/shop/catalog.html?category=${encodeURIComponent(cat.name)}`;
        return;
    }

    currentCatNameEl.textContent = cat.name;
    subGrid.innerHTML = "";

    subcategories.forEach(sub => {
        const subName = typeof sub === 'string' ? sub : sub.name;
        const subImg = typeof sub === 'object' ? sub.image : 'https://placehold.co/300';

        const card = document.createElement('a');
        card.href = `/shop/catalog.html?category=${encodeURIComponent(cat.name)}&subcategory=${encodeURIComponent(subName)}`;
        
        card.className = "group relative bg-white rounded-[2rem] border border-gray-100 overflow-hidden shadow-sm hover:shadow-2xl hover:shadow-brand-cyan/20 hover:border-brand-cyan/50 transition-all duration-500 hover:-translate-y-2 cursor-pointer h-72 flex flex-col";

        card.innerHTML = `
            <div class="absolute inset-0 bg-gray-100 overflow-hidden">
                <img src="${subImg}" class="w-full h-full object-cover group-hover:scale-110 transition duration-700 ease-out opacity-90 group-hover:opacity-100">
                <div class="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent opacity-50 group-hover:opacity-70 transition-colors"></div>
            </div>
            
            <div class="relative z-10 mt-auto p-6 text-center w-full">
                <div class="w-8 h-1 bg-white mx-auto mb-3 w-0 group-hover:w-8 transition-all duration-300 ease-out"></div>
                <h4 class="text-white font-black text-xl uppercase tracking-tight leading-none group-hover:text-brand-cyan transition text-shadow-md">${subName}</h4>
                <span class="mt-2 inline-block text-[8px] font-bold text-gray-300 uppercase tracking-widest opacity-0 group-hover:opacity-100 transform translate-y-2 group-hover:translate-y-0 transition duration-300">Explorar</span>
            </div>
        `;
        subGrid.appendChild(card);
    });

    mainView.classList.add('hidden');
    subView.classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
};

window.showMainCategories = () => {
    subView.classList.add('hidden');
    mainView.classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
};

document.addEventListener('DOMContentLoaded', loadCategories);