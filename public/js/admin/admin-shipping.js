import { db, doc, getDoc, setDoc, collection, getDocs } from '../firebase-init.js';
import { loadAdminSidebar } from './admin-ui.js';

loadAdminSidebar();

// ESTADO GLOBAL
let shippingGroups = []; 
let activeGroupId = null;
let excludedProducts = [];
let allProductsCache = null;

// ELEMENTOS DOM
const groupsContainer = document.getElementById('groups-container');
const cityModal = document.getElementById('city-modal');
const deptSelect = document.getElementById('modal-dept-select');
const citySelect = document.getElementById('modal-city-select');
const searchExcludedInput = document.getElementById('search-excluded-input');
const searchExcludedResults = document.getElementById('search-excluded-results');

// --- UTILIDADES MONEDA ---
const formatCurrency = (value) => {
    if (value === "" || value === null || value === undefined) return "";
    return "$ " + Number(value).toLocaleString("es-CO");
};

const parseCurrency = (value) => {
    return Number(value.replace(/[^0-9]/g, '')) || 0;
};

// Aplicar listeners a inputs estáticos
document.querySelectorAll('.currency-input').forEach(input => {
    input.addEventListener('input', (e) => {
        const val = parseCurrency(e.target.value);
        e.target.value = formatCurrency(val);
    });
    input.addEventListener('focus', (e) => e.target.select()); // Seleccionar todo al hacer clic
});


/**
 * --- 1. CARGA INICIAL ---
 */
async function init() {
    try {
        const configSnap = await getDoc(doc(db, "config", "shipping"));
        if (configSnap.exists()) {
            const data = configSnap.data();
            
            // Cargar valores y formatear
            document.getElementById('free-threshold').value = formatCurrency(data.freeThreshold || 0);
            document.getElementById('default-price').value = formatCurrency(data.defaultPrice || 0);
            document.getElementById('cutoff-time').value = data.cutoffTime || "14:00"; 
            
            shippingGroups = data.groups || [];
            excludedProducts = data.excludedProducts || [];

            const bulkyMode = data.bulkyShippingMode || 'flete_al_cobro';
            setBulkyModeUI(bulkyMode);

            if ((!excludedProducts || excludedProducts.length === 0) && data.excludedProductIds && data.excludedProductIds.length > 0) {
                const cache = await getAllProductsCache();
                excludedProducts = cache.filter(p => data.excludedProductIds.includes(p.id));
            }
        } else {
            setBulkyModeUI('flete_al_cobro');
        }
        renderGroups();
        renderExcludedProducts();
        loadDepartments();
        setupExcludedSearch();
        setupBulkyModeListeners();
    } catch (e) { console.error("Error inicializando:", e); }
}

function setBulkyModeUI(mode) {
    const radioCobro = document.getElementById('mode-flete-al-cobro');
    const radioFija = document.getElementById('mode-tarifa-fija');
    const cardCobro = document.getElementById('card-mode-cobro');
    const cardFija = document.getElementById('card-mode-fija');

    if (mode === 'tarifa_fija') {
        if (radioFija) radioFija.checked = true;
        if (cardFija) {
            cardFija.classList.add('border-brand-orange', 'bg-orange-50/20');
            cardFija.classList.remove('border-gray-100');
        }
        if (cardCobro) {
            cardCobro.classList.remove('border-brand-orange', 'bg-orange-50/20');
            cardCobro.classList.add('border-gray-100');
        }
    } else {
        if (radioCobro) radioCobro.checked = true;
        if (cardCobro) {
            cardCobro.classList.add('border-brand-orange', 'bg-orange-50/20');
            cardCobro.classList.remove('border-gray-100');
        }
        if (cardFija) {
            cardFija.classList.remove('border-brand-orange', 'bg-orange-50/20');
            cardFija.classList.add('border-gray-100');
        }
    }
}

function setupBulkyModeListeners() {
    const radioCobro = document.getElementById('mode-flete-al-cobro');
    const radioFija = document.getElementById('mode-tarifa-fija');

    if (radioCobro) {
        radioCobro.addEventListener('change', () => {
            if (radioCobro.checked) setBulkyModeUI('flete_al_cobro');
        });
    }
    if (radioFija) {
        radioFija.addEventListener('change', () => {
            if (radioFija.checked) setBulkyModeUI('tarifa_fija');
        });
    }
}

/**
 * --- 2. GESTIÓN DE GRUPOS ---
 */
document.getElementById('btn-add-group').onclick = () => {
    shippingGroups.push({ id: Date.now().toString(), price: 0, cities: [] });
    renderGroups();
};

function renderGroups() {
    groupsContainer.innerHTML = shippingGroups.length === 0 ? 
        `<p class="text-center text-gray-300 py-10 uppercase text-[10px] font-black">No hay grupos de tarifa especial.</p>` : "";

    shippingGroups.forEach((group) => {
        const div = document.createElement('div');
        div.className = "p-8 border-2 border-gray-100 rounded-[2rem] bg-slate-50 space-y-6 relative group";
        
        // Input dinámico de precio con formato
        const priceInputHtml = `
            <div class="admin-input-group">
                <label>Precio del Envío (COP)</label>
                <input type="text" 
                       class="currency-input-group" 
                       value="${formatCurrency(group.price)}" 
                       data-id="${group.id}" 
                       placeholder="$ 0">
            </div>`;

        div.innerHTML = `
            <button onclick="window.removeGroup('${group.id}')" class="absolute top-6 right-6 text-gray-300 hover:text-red-500 transition">
                <i class="fa-solid fa-trash-can"></i>
            </button>

            <div class="grid grid-cols-1 md:grid-cols-3 gap-6 items-center">
                ${priceInputHtml}
                <div class="md:col-span-2">
                    <label class="block text-[9px] font-black text-gray-400 uppercase tracking-widest mb-3">Ciudades vinculadas a esta tarifa</label>
                    <div class="flex flex-wrap gap-2">
                        ${group.cities.map(city => `
                            <span class="city-badge bg-white border border-gray-200">
                                ${city}
                                <i class="fa-solid fa-xmark cursor-pointer hover:text-red-500" onclick="window.removeCityFromGroup('${group.id}', '${city}')"></i>
                            </span>
                        `).join('')}
                        <button onclick="window.openAddCity('${group.id}')" class="h-8 px-4 rounded-lg border-2 border-dashed border-gray-300 text-gray-400 text-[9px] font-black hover:border-brand-orange hover:text-brand-orange transition">
                            + AÑADIR CIUDAD
                        </button>
                    </div>
                </div>
            </div>
        `;
        groupsContainer.appendChild(div);

        // Agregar listener al input recién creado
        const input = div.querySelector('.currency-input-group');
        input.addEventListener('input', (e) => {
            const val = parseCurrency(e.target.value);
            e.target.value = formatCurrency(val);
            window.updateGroupPrice(group.id, val); // Guardar el número limpio
        });
        input.addEventListener('focus', (e) => e.target.select());
    });
}

window.updateGroupPrice = (id, priceRaw) => {
    const group = shippingGroups.find(g => g.id === id);
    if(group) group.price = Number(priceRaw);
};

window.removeGroup = (id) => {
    if(confirm("¿Eliminar este grupo de tarifas?")) {
        shippingGroups = shippingGroups.filter(g => g.id !== id);
        renderGroups();
    }
};

window.removeCityFromGroup = (groupId, cityName) => {
    const group = shippingGroups.find(g => g.id === groupId);
    if(group) {
        group.cities = group.cities.filter(c => c !== cityName);
        renderGroups();
    }
};

/**
 * --- 3. MODAL Y API COLOMBIA ---
 */
async function loadDepartments() {
    try {
        const res = await fetch('https://api-colombia.com/api/v1/Department');
        const depts = await res.json();
        deptSelect.innerHTML = '<option value="">Seleccione Departamento...</option>';
        depts.forEach(d => {
            deptSelect.innerHTML += `<option value="${d.id}">${d.name}</option>`;
        });
    } catch (e) { console.error("Error API:", e); }
}

deptSelect.onchange = async (e) => {
    if(!e.target.value) return;
    citySelect.disabled = true;
    citySelect.innerHTML = '<option>Cargando ciudades...</option>';
    
    try {
        const res = await fetch(`https://api-colombia.com/api/v1/Department/${e.target.value}/cities`);
        const cities = await res.json();
        citySelect.innerHTML = '<option value="">Seleccione Ciudad...</option>';
        cities.forEach(c => {
            citySelect.innerHTML += `<option value="${c.name}">${c.name}</option>`;
        });
        citySelect.disabled = false;
    } catch (e) { console.error(e); }
};

window.openAddCity = (groupId) => {
    activeGroupId = groupId;
    cityModal.classList.remove('hidden');
};

document.getElementById('btn-close-modal').onclick = () => cityModal.classList.add('hidden');

document.getElementById('btn-confirm-city').onclick = () => {
    const cityName = citySelect.value;
    if(!cityName) return;

    const group = shippingGroups.find(g => g.id === activeGroupId);
    if(group && !group.cities.includes(cityName)) {
        group.cities.push(cityName);
        renderGroups();
        cityModal.classList.add('hidden');
        citySelect.value = "";
    } else {
        alert("La ciudad ya está en este grupo o no es válida.");
    }
};

/**
 * --- 4. GESTIÓN DE PRODUCTOS EXCLUIDOS DE ENVÍO GRATIS ---
 */
async function getAllProductsCache() {
    if (allProductsCache) return allProductsCache;
    try {
        const snap = await getDocs(collection(db, "products"));
        allProductsCache = [];
        snap.forEach(d => {
            const p = d.data();
            if (p.status === 'active' || p.status === undefined) {
                allProductsCache.push({
                    id: d.id,
                    name: p.name || 'Producto sin nombre',
                    price: p.price || 0,
                    image: p.mainImage || p.image || '',
                    sku: p.sku || ''
                });
            }
        });
        return allProductsCache;
    } catch (e) {
        console.error("Error cargando productos:", e);
        return [];
    }
}

function renderExcludedProducts() {
    const container = document.getElementById('excluded-products-container');
    if (!container) return;

    if (!excludedProducts || excludedProducts.length === 0) {
        container.innerHTML = `
            <div class="col-span-full p-8 text-center border-2 border-dashed border-gray-100 rounded-[2rem]">
                <p class="text-gray-300 font-black uppercase text-[10px] tracking-widest">No hay productos excluidos configurados</p>
            </div>`;
        return;
    }

    container.innerHTML = excludedProducts.map(p => `
        <div class="flex items-center gap-3 p-4 bg-slate-50 border border-gray-100 rounded-2xl relative group hover:border-brand-orange/30 transition shadow-sm">
            <img src="${p.image || 'https://placehold.co/60'}" class="w-12 h-12 object-contain rounded-xl bg-white p-1 border border-gray-100">
            <div class="flex-grow min-w-0">
                <p class="text-xs font-black text-brand-black uppercase truncate" title="${p.name}">${p.name}</p>
                <p class="text-[9px] text-brand-orange font-bold">${formatCurrency(p.price)}</p>
            </div>
            <button onclick="window.removeExcludedProduct('${p.id}')" class="text-gray-300 hover:text-red-500 transition p-2" title="Eliminar de Excluidos">
                <i class="fa-solid fa-trash-can text-sm"></i>
            </button>
        </div>
    `).join('');
}

window.removeExcludedProduct = (productId) => {
    excludedProducts = excludedProducts.filter(p => p.id !== productId);
    renderExcludedProducts();
};

function setupExcludedSearch() {
    if (!searchExcludedInput || !searchExcludedResults) return;

    searchExcludedInput.addEventListener('input', async (e) => {
        const query = e.target.value.trim().toLowerCase();
        if (query.length < 2) {
            searchExcludedResults.classList.add('hidden');
            searchExcludedResults.innerHTML = '';
            return;
        }

        const products = await getAllProductsCache();
        const filtered = products.filter(p => 
            p.name.toLowerCase().includes(query) || (p.sku && p.sku.toLowerCase().includes(query))
        ).slice(0, 10);

        if (filtered.length === 0) {
            searchExcludedResults.innerHTML = `<div class="p-3 text-xs text-gray-400 text-center font-bold">No se encontraron productos</div>`;
        } else {
            searchExcludedResults.innerHTML = filtered.map(p => {
                const isAlreadyAdded = excludedProducts.some(ep => ep.id === p.id);
                return `
                    <div class="flex items-center justify-between p-3 hover:bg-slate-50 rounded-xl cursor-pointer transition border-b border-gray-50 last:border-0 ${isAlreadyAdded ? 'opacity-50 pointer-events-none' : ''}"
                         onclick="window.addExcludedProduct('${p.id}')">
                        <div class="flex items-center gap-3 min-w-0">
                            <img src="${p.image || 'https://placehold.co/40'}" class="w-9 h-9 object-contain rounded-lg border border-gray-100">
                            <div class="truncate">
                                <p class="text-xs font-black text-brand-black truncate">${p.name}</p>
                                <p class="text-[9px] text-gray-400 font-bold">${formatCurrency(p.price)}</p>
                            </div>
                        </div>
                        <span class="text-[9px] font-black uppercase px-3 py-1 rounded-lg ${isAlreadyAdded ? 'bg-gray-100 text-gray-400' : 'bg-brand-orange text-brand-black'}">
                            ${isAlreadyAdded ? 'Agregado' : '+ Agregar'}
                        </span>
                    </div>
                `;
            }).join('');
        }
        searchExcludedResults.classList.remove('hidden');
    });

    document.addEventListener('click', (e) => {
        if (!searchExcludedInput.contains(e.target) && !searchExcludedResults.contains(e.target)) {
            searchExcludedResults.classList.add('hidden');
        }
    });
}

window.addExcludedProduct = async (productId) => {
    const products = await getAllProductsCache();
    const target = products.find(p => p.id === productId);
    if (target && !excludedProducts.some(ep => ep.id === productId)) {
        excludedProducts.push(target);
        renderExcludedProducts();
    }
    searchExcludedInput.value = '';
    searchExcludedResults.classList.add('hidden');
};

/**
 * --- 5. GUARDAR EN FIRESTORE ---
 */
document.getElementById('btn-save-config').onclick = async () => {
    const btn = document.getElementById('btn-save-config');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Guardando...';

    // LIMPIAR VALORES ANTES DE GUARDAR
    const freeThresholdRaw = parseCurrency(document.getElementById('free-threshold').value);
    const defaultPriceRaw = parseCurrency(document.getElementById('default-price').value);
    const excludedProductIds = excludedProducts.map(p => p.id);
    const selectedMode = document.querySelector('input[name="bulky-shipping-mode"]:checked')?.value || 'flete_al_cobro';

    const config = {
        freeThreshold: freeThresholdRaw,
        defaultPrice: defaultPriceRaw,
        cutoffTime: document.getElementById('cutoff-time').value, 
        groups: shippingGroups, // Ya tienen el precio limpio por updateGroupPrice
        excludedProducts: excludedProducts,
        excludedProductIds: excludedProductIds,
        bulkyShippingMode: selectedMode,
        updatedAt: new Date()
    };

    try {
        await setDoc(doc(db, "config", "shipping"), config);
        alert("✅ Configuración de logística actualizada.");
        init(); // Recargar para asegurar formateo
    } catch (e) {
        alert("Error al guardar: " + e.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = 'Guardar Cambios';
    }
};

init();