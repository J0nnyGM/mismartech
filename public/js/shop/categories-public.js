import { db, collection, query, orderBy, where, onSnapshot } from "../firebase-init.js";

const mainGrid = document.getElementById('categories-grid');
const subGrid = document.getElementById('subcategories-grid');
const mainView = document.getElementById('main-view');
const subPanel = document.getElementById('subcategories-panel');
const currentCatNameEl = document.getElementById('current-cat-name');
const btnViewAllSub = document.getElementById('btn-view-all-sub'); 

// Estado en memoria
let categoriesData = [];

// Claves de almacenamiento optimizadas para mismartech
const STORAGE_KEY = 'smartech_categories_smart';
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
            
            // Si el panel dinámico está abierto, lo mantenemos sincronizado con el contenido fresco
            if (subPanel && !subPanel.classList.contains('hidden') && currentCatNameEl.textContent) {
                const currentCatIndex = categoriesData.findIndex(c => c.name === currentCatNameEl.textContent);
                if (currentCatIndex !== -1) {
                    window.showSubcategories(currentCatIndex); // Repinta el panel inline
                } else {
                    // Si se eliminó la categoría que estaba viendo, cerramos el panel
                    window.closeSubcategories();
                }
            }
        }
    }, (error) => {
        console.error("Error en SmartSync Realtime Categories:", error);
    });
}

// ==========================================================================
// RENDERIZADO (UI) - Diseño Renovado y Premium de mismartech
// ==========================================================================

function renderMainGrid() {
    mainGrid.innerHTML = "";

    // Volver a inyectar el panel de subcategorías como elemento oculto para que no se pierda al limpiar
    if (subPanel) {
        mainGrid.appendChild(subPanel);
    }

    if (categoriesData.length === 0) {
        mainGrid.innerHTML = `<p class="col-span-full text-center text-gray-400 font-bold py-10">Sin categorías disponibles por el momento.</p>`;
        return;
    }

    categoriesData.forEach((cat, index) => {
        const imageSrc = cat.image || 'https://placehold.co/400x300';
        const subCount = cat.subcategories ? cat.subcategories.length : 0;

        const card = document.createElement('div');
        card.id = `cat-card-${index}`;
        card.onclick = () => showSubcategories(index);
        
        // Estilos premium: Elevación translate, escala interna de imagen, y sombras difuminadas con brillo de marca naranja
        card.className = "group relative bg-white rounded-[2.5rem] border border-slate-100 overflow-hidden shadow-[0_4px_25px_rgba(0,0,0,0.02)] hover:shadow-[0_20px_50px_rgba(240,90,40,0.15)] hover:border-brand-orange/30 transition-all duration-500 hover:-translate-y-2.5 cursor-pointer h-80 flex flex-col";

        card.innerHTML = `
            <div class="absolute inset-0 bg-slate-100 overflow-hidden">
                <img src="${imageSrc}" alt="${cat.name}" class="w-full h-full object-cover scale-[1.01] group-hover:scale-110 transition duration-700 ease-out opacity-90 group-hover:opacity-100">
                
                <!-- Gradiente por defecto: Oscuro elegante -->
                <div class="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent opacity-85 group-hover:opacity-0 transition-all duration-500 z-10"></div>
                
                <!-- Gradiente en hover: Resplandor naranja de marca mismartech -->
                <div class="absolute inset-0 bg-gradient-to-t from-brand-orange/80 via-black/45 to-transparent opacity-0 group-hover:opacity-100 transition-all duration-500 z-10"></div>
            </div>
            
            <div class="relative z-20 mt-auto p-6 flex flex-col gap-2">
                <div class="w-8 h-1 bg-brand-orange rounded-full mb-1 w-0 group-hover:w-10 transition-all duration-500 ease-out"></div>
                <h3 class="text-white font-black text-2xl uppercase tracking-tight leading-none mb-1 drop-shadow-md group-hover:text-white transition-colors">
                    ${cat.name}
                </h3>
                
                <!-- Badge de subcategorías premium estilo píldora de cristal -->
                <div class="flex items-center">
                    <span class="bg-white/10 backdrop-blur-md border border-white/20 text-white text-[9px] font-black uppercase tracking-widest px-3 py-1 rounded-full flex items-center gap-1.5 shadow-sm group-hover:bg-brand-black group-hover:border-transparent transition-all duration-300">
                        ${subCount} Subcategorías <i class="fa-solid fa-arrow-right text-[8px] transform group-hover:translate-x-1 transition-transform duration-300"></i>
                    </span>
                </div>
            </div>
        `;
        mainGrid.appendChild(card);
    });
}

window.showSubcategories = (index) => {
    const cat = categoriesData[index];
    const subcategories = cat.subcategories || [];

    if (subcategories.length === 0) {
        window.location.href = `/shop/catalog.html?category=${encodeURIComponent(cat.name)}`;
        return;
    }

    const cardEl = document.getElementById(`cat-card-${index}`);
    const isActive = cardEl.classList.contains('active-card');

    // SI YA ESTABA ACTIVA: Hacemos toggle colapsándola suavemente
    if (isActive) {
        window.closeSubcategories();
        return;
    }

    // 1. Resetear selección anterior de todas las tarjetas
    document.querySelectorAll('[id^="cat-card-"]').forEach(el => el.classList.remove('active-card'));
    
    // 2. Mover el panel de subcategorías justo detrás de la tarjeta presionada en el DOM
    if (cardEl && subPanel) {
        cardEl.after(subPanel);
    }

    // 3. Iluminar la nueva tarjeta activa
    cardEl.classList.add('active-card');

    // 4. Configurar el enlace del botón "Ver Todo"
    if (btnViewAllSub) {
        btnViewAllSub.href = `/shop/catalog.html?category=${encodeURIComponent(cat.name)}`;
    }

    // 5. Renderizar los datos de las subcategorías
    currentCatNameEl.textContent = cat.name;
    subGrid.innerHTML = "";

    subcategories.forEach(sub => {
        const subName = typeof sub === 'string' ? sub : sub.name;
        const subImg = typeof sub === 'object' ? sub.image : 'https://placehold.co/300';

        const card = document.createElement('a');
        card.href = `/shop/catalog.html?category=${encodeURIComponent(cat.name)}&subcategory=${encodeURIComponent(subName)}`;
        
        // Estilo premium en tarjetas de subcategorías con hover sincronizado
        card.className = "group relative bg-white rounded-[2rem] border border-slate-100 overflow-hidden shadow-[0_4px_15px_rgba(0,0,0,0.01)] hover:shadow-[0_15px_35px_rgba(240,90,40,0.12)] hover:border-brand-orange/20 transition-all duration-500 hover:-translate-y-1.5 cursor-pointer h-60 flex flex-col animate-in fade-in duration-300";

        card.innerHTML = `
            <div class="absolute inset-0 bg-slate-100 overflow-hidden">
                <img src="${subImg}" alt="${subName}" class="w-full h-full object-cover scale-[1.01] group-hover:scale-110 transition duration-700 ease-out opacity-90 group-hover:opacity-100">
                
                <!-- Gradientes -->
                <div class="absolute inset-0 bg-gradient-to-t from-black/80 via-black/25 to-transparent opacity-85 group-hover:opacity-0 transition-all duration-500 z-10"></div>
                <div class="absolute inset-0 bg-gradient-to-t from-brand-orange/80 via-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-all duration-500 z-10"></div>
            </div>
            
            <div class="relative z-20 mt-auto p-4 text-center w-full flex flex-col items-center">
                <div class="w-6 h-0.5 bg-white rounded-full mb-2 group-hover:w-8 transition-all duration-500 ease-out group-hover:bg-brand-orange"></div>
                <h4 class="text-white font-black text-sm uppercase tracking-tight leading-tight group-hover:text-white transition drop-shadow-md">${subName}</h4>
                <span class="mt-2 bg-white/10 backdrop-blur-sm border border-white/20 text-white text-[7px] font-black uppercase tracking-widest px-2.5 py-0.5 rounded-full opacity-0 group-hover:opacity-100 transform translate-y-1 group-hover:translate-y-0 transition duration-300 flex items-center gap-1 shadow-sm">
                    Explorar <i class="fa-solid fa-chevron-right text-[6px]"></i>
                </span>
            </div>
        `;
        subGrid.appendChild(card);
    });

    // 6. Desplegar el panel inline
    subPanel.classList.remove('hidden');
    
    // 7. Scroll suave y sutil al panel expansible
    subPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
};

window.closeSubcategories = () => {
    if (subPanel) {
        subPanel.classList.add('hidden');
    }
    document.querySelectorAll('[id^="cat-card-"]').forEach(el => el.classList.remove('active-card'));
};

// Mantener alias por compatibilidad
window.showMainCategories = () => {
    window.closeSubcategories();
};

document.addEventListener('DOMContentLoaded', loadCategories);