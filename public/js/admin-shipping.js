import { db, doc, getDoc, setDoc } from './firebase-init.js';
import { loadAdminSidebar } from './admin-ui.js';

loadAdminSidebar();

// ESTADO GLOBAL
let shippingGroups = []; 
let activeGroupId = null;

// ELEMENTOS DOM
const groupsContainer = document.getElementById('groups-container');
const cityModal = document.getElementById('city-modal');
const deptSelect = document.getElementById('modal-dept-select');
const citySelect = document.getElementById('modal-city-select');

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
        }
        renderGroups();
        loadDepartments();
    } catch (e) { console.error("Error inicializando:", e); }
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
                        <button onclick="window.openAddCity('${group.id}')" class="h-8 px-4 rounded-lg border-2 border-dashed border-gray-300 text-gray-400 text-[9px] font-black hover:border-brand-cyan hover:text-brand-cyan transition">
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
 * --- 4. GUARDAR EN FIRESTORE ---
 */
document.getElementById('btn-save-config').onclick = async () => {
    const btn = document.getElementById('btn-save-config');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Guardando...';

    // LIMPIAR VALORES ANTES DE GUARDAR
    const freeThresholdRaw = parseCurrency(document.getElementById('free-threshold').value);
    const defaultPriceRaw = parseCurrency(document.getElementById('default-price').value);

    const config = {
        freeThreshold: freeThresholdRaw,
        defaultPrice: defaultPriceRaw,
        cutoffTime: document.getElementById('cutoff-time').value, 
        groups: shippingGroups, // Ya tienen el precio limpio por updateGroupPrice
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