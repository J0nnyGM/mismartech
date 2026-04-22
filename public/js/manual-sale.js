import { db, collection, doc, runTransaction, addDoc, setDoc, getDocs, query, orderBy } from './firebase-init.js';
import { adjustStock } from './inventory-core.js';
import { AdminStore } from './admin-store.js'; // 🔥 IMPORTAMOS EL CEREBRO CENTRAL

// --- HTML DEL MODAL (PLANTILLA INTEGRADA - SIN SUB-MODALES) ---
const MODAL_HTML = `
<div id="manual-modal" class="fixed inset-0 z-[80] hidden flex items-center justify-center p-4 sm:p-6">
    <div class="absolute inset-0 bg-slate-900/70 backdrop-blur-sm" id="btn-close-overlay"></div>
    <div class="relative bg-white w-full max-w-5xl rounded-[2.5rem] shadow-2xl flex flex-col max-h-[95vh] overflow-hidden">
        
        <div class="px-8 py-6 border-b border-gray-100 flex justify-between items-center bg-slate-50/80 shrink-0">
            <div>
                <h3 class="text-2xl font-black tracking-tighter uppercase text-brand-black leading-none">Nueva <span class="text-brand-cyan">Venta Directa</span></h3>
                <p class="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-1">Módulo de facturación manual</p>
            </div>
            <button class="w-10 h-10 rounded-full bg-white border border-gray-200 text-gray-400 hover:bg-brand-red hover:border-brand-red hover:text-white transition-colors flex items-center justify-center shadow-sm" id="btn-close-x"><i class="fa-solid fa-xmark"></i></button>
        </div>
        
        <div class="p-8 overflow-y-auto space-y-8 custom-scroll bg-white flex-1">
            
            <div class="grid grid-cols-1 gap-4">
                
                <div id="m-search-section" class="relative group">
                    <label class="text-[9px] font-black uppercase text-gray-400 tracking-widest mb-2 block ml-1">Buscar Cliente Registrado *</label>
                    <div class="relative">
                        <i class="fa-solid fa-user absolute left-4 top-1/2 -translate-y-1/2 text-gray-300"></i>
                        <input type="text" id="m-cust-search" autocomplete="off" placeholder="Buscar por nombre, teléfono o cédula..." class="w-full bg-slate-50 border border-gray-100 py-4 pl-11 pr-4 rounded-2xl text-sm font-bold outline-none focus:border-brand-cyan focus:bg-white transition-colors text-brand-black shadow-sm">
                    </div>
                    <div id="m-cust-results" class="absolute z-50 w-full mt-2 bg-white border border-gray-100 rounded-2xl shadow-xl hidden max-h-56 overflow-y-auto p-2 custom-scroll"></div>
                </div>

                <div id="m-selected-client-section" class="hidden bg-slate-50 p-5 rounded-[2rem] border border-gray-100 flex justify-between items-center animate-in fade-in slide-in-from-top-2">
                    <div>
                        <p class="text-[9px] font-black text-emerald-500 uppercase tracking-widest mb-1"><i class="fa-solid fa-check-circle mr-1"></i> Cliente Vinculado</p>
                        <p id="m-sel-cname" class="text-lg font-black text-brand-black uppercase"></p>
                        <p id="m-sel-cphone" class="text-xs font-bold text-gray-500"></p>
                    </div>
                    <button id="btn-clear-client" class="w-10 h-10 bg-white border border-gray-200 text-gray-400 hover:text-red-500 hover:border-red-200 rounded-full flex items-center justify-center transition shadow-sm shrink-0" title="Cambiar Cliente"><i class="fa-solid fa-rotate-right"></i></button>
                </div>

                <div id="m-new-client-section" class="hidden bg-cyan-50/30 p-6 rounded-[2rem] border border-cyan-100 relative animate-in fade-in slide-in-from-top-2 shadow-sm">
                    <button id="btn-cancel-new-client" class="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:bg-white hover:text-red-500 transition shadow-sm border border-transparent hover:border-gray-200" title="Cancelar"><i class="fa-solid fa-xmark"></i></button>
                    
                    <div class="mb-5">
                        <span class="bg-brand-cyan text-brand-black px-3 py-1 rounded-md text-[9px] font-black uppercase tracking-widest shadow-sm">Registrar Nuevo Cliente</span>
                    </div>
                    
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
                        <div class="md:col-span-2">
                            <label class="text-[9px] font-black text-gray-500 uppercase tracking-widest mb-1 block ml-1">Nombre Completo *</label>
                            <input type="text" id="m-nc-name" placeholder="Ej: Juan Pérez" class="w-full bg-white border border-cyan-100 p-3.5 rounded-xl text-sm font-bold outline-none focus:border-brand-cyan shadow-sm">
                        </div>
                        <div>
                            <label class="text-[9px] font-black text-gray-500 uppercase tracking-widest mb-1 block ml-1">Teléfono / WhatsApp *</label>
                            <input type="text" id="m-nc-phone" placeholder="Ej: 3001234567" class="w-full bg-white border border-cyan-100 p-3.5 rounded-xl text-sm font-bold outline-none focus:border-brand-cyan shadow-sm">
                        </div>
                        <div>
                            <label class="text-[9px] font-black text-gray-500 uppercase tracking-widest mb-1 block ml-1">Cédula / NIT</label>
                            <input type="text" id="m-nc-doc" placeholder="Opcional" class="w-full bg-white border border-cyan-100 p-3.5 rounded-xl text-sm font-bold outline-none focus:border-brand-cyan shadow-sm">
                        </div>
                        <div class="md:col-span-2">
                            <label class="text-[9px] font-black text-gray-500 uppercase tracking-widest mb-1 block ml-1">Email</label>
                            <input type="email" id="m-nc-email" placeholder="cliente@correo.com" class="w-full bg-white border border-cyan-100 p-3.5 rounded-xl text-sm font-bold outline-none focus:border-brand-cyan shadow-sm">
                        </div>
                    </div>
                </div>
            </div>

            <div class="bg-slate-50 p-6 rounded-[2rem] border border-gray-100 space-y-5 relative">
                <div class="absolute -top-3 left-6 bg-brand-cyan text-brand-black px-3 py-1 rounded-md text-[9px] font-black uppercase tracking-widest shadow-sm">
                    Datos de Entrega
                </div>
                
                <div class="grid grid-cols-1 gap-4 pt-2">
                    <select id="m-shipping-mode" class="w-full bg-white border border-gray-200 p-4 rounded-2xl text-xs font-bold outline-none focus:border-brand-cyan appearance-none cursor-pointer text-brand-black shadow-sm">
                        <option value="pickup">📍 Recogida en Local / Contraentrega</option>
                        <option value="new" selected>🚚 Nueva Dirección Nacional</option>
                        <option value="saved" disabled id="opt-saved-addr">🏠 Dirección Guardada (Seleccione Cliente)</option>
                    </select>
                </div>

                <div id="container-saved-addr" class="hidden animate-in fade-in slide-in-from-top-2">
                    <select id="m-saved-addr-select" class="w-full bg-white border border-gray-200 p-4 rounded-2xl text-xs font-bold outline-none focus:border-brand-cyan appearance-none cursor-pointer text-brand-black shadow-sm">
                        <option value="">Seleccione...</option>
                    </select>
                </div>

                <div id="container-new-addr" class="animate-in fade-in slide-in-from-top-2 space-y-4">
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label class="text-[9px] font-black uppercase text-gray-400 tracking-widest mb-2 block ml-1">Departamento</label>
                            <select id="m-dept-manual" class="w-full bg-white border border-gray-200 p-4 rounded-2xl text-xs font-bold outline-none focus:border-brand-cyan appearance-none cursor-pointer text-brand-black shadow-sm"><option value="">Seleccionar...</option></select>
                        </div>
                        <div>
                            <label class="text-[9px] font-black uppercase text-gray-400 tracking-widest mb-2 block ml-1">Ciudad</label>
                            <select id="m-city-manual" class="w-full bg-white border border-gray-200 p-4 rounded-2xl text-xs font-bold outline-none focus:border-brand-cyan appearance-none cursor-pointer text-brand-black shadow-sm" disabled><option value="">Seleccione Depto primero</option></select>
                        </div>
                    </div>
                    <div>
                        <label class="text-[9px] font-black uppercase text-gray-400 tracking-widest mb-2 block ml-1">Dirección Exacta</label>
                        <input type="text" id="m-address-manual" placeholder="Ej: Calle 123 # 45 - 67, Barrio..." class="w-full bg-white border border-gray-200 p-4 rounded-2xl text-sm font-bold outline-none focus:border-brand-cyan text-brand-black shadow-sm">
                    </div>
                </div>
            </div>

            <div class="space-y-4">
                <div class="flex justify-between items-end border-b border-gray-100 pb-3">
                    <div>
                        <h4 class="text-xs font-black text-brand-black uppercase tracking-widest">Productos</h4>
                        <p class="text-[9px] text-gray-400 font-bold uppercase mt-0.5">Añade los items a vender</p>
                    </div>
                    <button id="btn-add-item-row" class="text-brand-cyan hover:text-white hover:bg-brand-cyan bg-cyan-50 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-colors flex items-center gap-2 border border-brand-cyan/20">
                        <i class="fa-solid fa-circle-plus text-sm"></i> Añadir Línea
                    </button>
                </div>
                <div id="manual-items-container" class="space-y-3"></div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4">
                <div>
                    <label class="text-[9px] font-black uppercase text-gray-400 tracking-widest mb-2 block ml-1">Método de Pago</label>
                    <div class="relative">
                        <select id="m-payment-account" class="w-full bg-slate-50 border border-gray-200 p-4 rounded-2xl text-sm font-bold outline-none focus:border-green-500 transition-all appearance-none cursor-pointer text-brand-black shadow-sm">
                            <option value="credit">⏳ Cartera (Pendiente por Cobrar)</option>
                        </select>
                        <i class="fa-solid fa-chevron-down absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"></i>
                    </div>
                </div>
                
                <div class="bg-brand-cyan/5 border border-brand-cyan/20 p-4 rounded-2xl flex items-center justify-between shadow-sm mt-[22px]">
                    <div class="flex items-center gap-3">
                        <div class="w-10 h-10 rounded-full bg-white text-brand-cyan flex items-center justify-center text-sm shadow-sm border border-brand-cyan/20">
                            <i class="fa-solid fa-file-invoice"></i>
                        </div>
                        <p class="text-[10px] font-black uppercase tracking-widest text-brand-black">¿Factura Electrónica?</p>
                    </div>
                    <label class="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" id="m-requires-invoice" class="sr-only peer">
                        <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-cyan"></div>
                    </label>
                </div>
            </div>
        </div>
        
        <div class="p-6 md:p-8 border-t border-gray-100 bg-white grid grid-cols-1 md:grid-cols-12 gap-6 items-center shrink-0 rounded-b-[2.5rem]">
             <div class="md:col-span-4">
                <label class="text-[9px] font-black uppercase text-gray-400 tracking-widest mb-2 block ml-1">Costo de Envío Extra</label>
                <div class="relative">
                    <i class="fa-solid fa-truck-fast absolute left-4 top-1/2 -translate-y-1/2 text-gray-300"></i>
                    <input type="text" id="m-shipping-cost" value="$ 0" class="currency-input w-full bg-slate-50 border border-gray-100 py-4 pl-11 pr-4 rounded-2xl text-sm font-black outline-none focus:border-brand-cyan text-brand-black transition-colors shadow-inner">
                </div>
            </div>
            
            <div class="md:col-span-4 text-center md:text-right flex flex-col justify-center">
                <p class="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1">Total de la Venta</p>
                <h4 id="manual-total-display" class="text-4xl md:text-5xl font-black text-brand-black tracking-tighter leading-none">$ 0</h4>
            </div>
            
            <div class="md:col-span-4 h-full">
                <button id="btn-save-manual" class="w-full h-full min-h-[60px] bg-brand-black text-white font-black px-6 py-4 rounded-2xl shadow-xl shadow-brand-black/20 uppercase text-xs tracking-widest hover:bg-brand-cyan hover:text-brand-black hover:shadow-brand-cyan/30 transition-all duration-300 transform active:scale-95 flex items-center justify-center gap-3">
                    <i class="fa-solid fa-check-double text-lg"></i> <span class="mt-0.5">Generar Venta</span>
                </button>
            </div>
        </div>
    </div>
</div>
`;

// --- VARIABLES GLOBALES DEL MÓDULO ---
let manualProductsCache = []; 
let manualClientsCache = [];

// Estado del Cliente
let isCreatingNewClient = false;
let selectedUserId = null;
let selectedUserName = "";
let selectedUserPhone = "";
let currentUserAddresses = [];

let onSuccessCallback = null;

// --- UTILIDADES ---
const formatCurrency = (num) => '$ ' + num.toLocaleString('es-CO');
const parseCurrency = (str) => Number(str.replace(/[^0-9-]/g, '')) || 0;
const normalizeText = (str) => str ? str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") : "";

function setupCurrencyInput(input) {
    input.addEventListener('input', (e) => {
        const val = parseCurrency(e.target.value);
        e.target.value = formatCurrency(val);
        calculateManualTotal();
    });
    input.addEventListener('focus', (e) => e.target.select());
}

// ==========================================================================
// 🔥 CONEXIÓN AL STORE CENTRAL
// ==========================================================================
AdminStore.subscribeToProducts((products) => {
    manualProductsCache = products;
    // Si el modal está abierto, actualizamos en vivo el stock de las filas
    const modal = document.getElementById('manual-modal');
    if (modal && !modal.classList.contains('hidden')) {
        document.querySelectorAll('.item-row-container').forEach(row => {
            const pId = row.querySelector('.p-id').value;
            if (pId) {
                const updatedProd = manualProductsCache.find(p => p.id === pId);
                if (updatedProd) updateRowStock(row, updatedProd);
            }
        });
    }
});

AdminStore.subscribeToClients((clients) => {
    manualClientsCache = clients;
    // Si el usuario estaba buscando un cliente justo cuando se sincronizó, refresca la búsqueda
    const searchInput = document.getElementById('m-cust-search');
    if (searchInput && searchInput.value.trim().length >= 2 && !isCreatingNewClient && !selectedUserId) {
        searchInput.dispatchEvent(new Event('input'));
    }
});


// --- INICIALIZAR ---
export function initManualSale(onSuccess) {
    if (!document.getElementById('manual-modal')) {
        document.body.insertAdjacentHTML('beforeend', MODAL_HTML);
        setupEventListeners();
    }
    onSuccessCallback = onSuccess;
}

// --- OPEN MODAL ---
export async function openManualSaleModal() {
    const modal = document.getElementById('manual-modal');
    const container = document.getElementById('manual-items-container');
    
    // Resetear Estado de Cliente
    isCreatingNewClient = false;
    selectedUserId = null;
    selectedUserName = "";
    selectedUserPhone = "";
    currentUserAddresses = [];
    
    // Resetear UI
    document.getElementById('m-search-section').classList.remove('hidden');
    document.getElementById('m-selected-client-section').classList.add('hidden');
    document.getElementById('m-new-client-section').classList.add('hidden');
    
    document.getElementById('m-cust-search').value = "";
    document.getElementById('m-nc-name').value = "";
    document.getElementById('m-nc-phone').value = "";
    document.getElementById('m-nc-doc').value = "";
    document.getElementById('m-nc-email').value = "";

    document.getElementById('manual-total-display').textContent = "$ 0";
    document.getElementById('m-shipping-cost').value = "$ 0";
    document.getElementById('m-dept-manual').value = "";
    document.getElementById('m-city-manual').value = "";
    document.getElementById('m-address-manual').value = "";
    container.innerHTML = "";

    // 🔥 Ya no llamamos a loadCaches() porque AdminStore lo maneja en segundo plano
    await Promise.all([
        loadPaymentAccounts(), 
        loadManualDepartments()
    ]);
    
    addManualItemRow();
    setupCurrencyInput(document.getElementById('m-shipping-cost'));

    modal.classList.remove('hidden');
}

function setupEventListeners() {
    document.getElementById('btn-close-x').onclick = () => document.getElementById('manual-modal').classList.add('hidden');
    document.getElementById('btn-close-overlay').onclick = () => document.getElementById('manual-modal').classList.add('hidden');
    document.getElementById('btn-add-item-row').onclick = addManualItemRow;
    document.getElementById('btn-save-manual').onclick = saveOrder;

    setupCustomerSearch();

    const shipSelect = document.getElementById('m-shipping-mode');
    shipSelect.onchange = (e) => {
        const val = e.target.value;
        document.getElementById('container-saved-addr').classList.toggle('hidden', val !== 'saved');
        document.getElementById('container-new-addr').classList.toggle('hidden', val !== 'new');
    };

    const mDept = document.getElementById('m-dept-manual');
    const mCity = document.getElementById('m-city-manual');
    mDept.onchange = async (e) => {
        if(!e.target.value) return;
        mCity.disabled = true; mCity.innerHTML = '<option>Cargando...</option>';
        try {
            const res = await fetch(`https://api-colombia.com/api/v1/Department/${e.target.value}/cities`);
            const cities = await res.json();
            cities.sort((a,b)=>a.name.localeCompare(b.name));
            mCity.innerHTML = '<option value="">Ciudad...</option>';
            cities.forEach(c => mCity.innerHTML += `<option value="${c.name}">${c.name}</option>`);
            mCity.disabled = false;
        } catch(e) { console.error(e); }
    };
}

// --- LÓGICA FILAS Y PRODUCTOS ---
function addManualItemRow() {
    const div = document.createElement('div');
    div.className = "item-row-container relative focus-within:z-[60] bg-slate-50/50 p-4 rounded-2xl border border-gray-100 shadow-sm animate-in fade-in slide-in-from-top-2";
    div.innerHTML = `
        <div class="grid grid-cols-1 md:grid-cols-12 gap-3 items-start relative focus-within:z-[60]">
            <div class="md:col-span-4 relative focus-within:z-[70]">
                <label class="text-[8px] font-black text-gray-400 uppercase tracking-widest mb-2 block ml-1">Producto</label>
                <div class="relative">
                    <input type="text" autocomplete="off" placeholder="Buscar por nombre o SKU..." class="p-search w-full bg-white border border-gray-200 rounded-xl py-3 px-4 text-xs font-bold outline-none focus:border-brand-cyan text-brand-black pr-8 shadow-sm relative z-10">
                    <i class="fa-solid fa-magnifying-glass absolute right-3 top-1/2 -translate-y-1/2 text-gray-300 text-xs pointer-events-none z-20"></i>
                </div>
                <div class="p-results absolute top-full left-0 z-[100] w-full mt-2 bg-white border border-gray-200 rounded-xl shadow-2xl hidden max-h-56 overflow-y-auto custom-scroll"></div>
            </div>
            
            <div class="md:col-span-3 flex gap-2 p-variants-container"></div>
            
             <div class="md:col-span-3">
                <label class="text-[8px] font-black text-gray-400 uppercase tracking-widest mb-2 block text-center">Precio Unitario</label>
                <input type="text" class="p-price-display currency-input w-full bg-white border border-gray-200 rounded-xl py-3 px-2 text-xs font-bold text-center outline-none focus:border-brand-cyan text-brand-black shadow-sm">
            </div>
            
            <div class="md:col-span-2 flex items-start gap-2">
                <div class="w-full relative pb-4">
                    <label class="text-[8px] font-black text-gray-400 uppercase tracking-widest mb-2 block text-center">Cant.</label>
                    <input type="number" value="1" min="1" class="p-qty w-full bg-white border border-gray-200 rounded-xl py-3 px-1 text-sm font-black text-center outline-none focus:border-brand-cyan text-brand-black shadow-sm">
                    <p class="text-[8px] font-black text-center mt-1 stock-display text-gray-400 absolute bottom-0 left-0 w-full">---</p>
                </div>
                <div class="pt-[22px] shrink-0">
                    <button class="w-11 h-11 rounded-xl bg-white border border-gray-200 text-gray-400 hover:bg-brand-red hover:border-brand-red hover:text-white transition-colors flex items-center justify-center btn-remove-row shadow-sm">
                        <i class="fa-solid fa-trash-can text-sm"></i>
                    </button>
                </div>
            </div>
        </div>
        <input type="hidden" class="p-id"><input type="hidden" class="p-img"><input type="hidden" class="p-max-stock">`;
    
    document.getElementById('manual-items-container').appendChild(div);
    
    const priceInput = div.querySelector('.p-price-display');
    setupCurrencyInput(priceInput);
    
    const qtyInput = div.querySelector('.p-qty');
    qtyInput.onchange = () => {
        const max = parseInt(div.querySelector('.p-max-stock').value) || 0;
        const current = parseInt(qtyInput.value) || 1;
        if (current > max) {
            alert(`⚠️ Solo quedan ${max} unidades disponibles de esta variante.`);
            qtyInput.value = max > 0 ? max : 1;
        }
        if (current < 1) qtyInput.value = 1;
        calculateManualTotal();
    };

    div.querySelector('.btn-remove-row').onclick = () => { div.remove(); calculateManualTotal(); };
    setupProductSearch(div);
}

function setupProductSearch(row) {
    const searchInput = row.querySelector('.p-search');
    const resultsDiv = row.querySelector('.p-results');

    searchInput.addEventListener('input', (e) => {
        const term = normalizeText(e.target.value);
        resultsDiv.innerHTML = "";
        
        if (term.length < 2) { 
            resultsDiv.classList.add('hidden'); 
            return; 
        }
        
        const filtered = manualProductsCache.filter(p => {
            const searchStr = p.searchStr || normalizeText(`${p.name} ${p.sku || ''}`);
            return searchStr.includes(term);
        });

        if (filtered.length === 0) {
            resultsDiv.innerHTML = `<div class="p-3 text-[10px] text-gray-400 text-center uppercase font-bold">No encontrado</div>`;
        } else {
            filtered.slice(0, 15).forEach(p => {
                const isOutOfStock = p.stock <= 0;
                const d = document.createElement('div');
                d.className = `p-3 flex items-center justify-between border-b border-gray-50 last:border-0 ${isOutOfStock ? 'bg-gray-50 opacity-60 cursor-not-allowed' : 'hover:bg-cyan-50 cursor-pointer transition'}`;
                
                d.innerHTML = `
                    <div class="flex-1 min-w-0 pr-2">
                        <p class="text-[10px] font-black uppercase text-brand-black line-clamp-1 ${isOutOfStock ? 'line-through text-gray-400' : ''}">${p.name}</p>
                        <p class="text-[9px] font-bold text-gray-400 mt-0.5">SKU: ${p.sku || '--'} | Stock: <span class="${isOutOfStock ? 'text-red-500' : 'text-brand-cyan'}">${p.stock || 0}</span></p>
                    </div>
                    <div class="text-right shrink-0">
                        <p class="text-[10px] font-black text-brand-black">${formatCurrency(p.price)}</p>
                    </div>
                `;

                if (!isOutOfStock) {
                    d.onmousedown = (e) => {
                        e.preventDefault(); 
                        searchInput.value = p.name;
                        row.querySelector('.p-id').value = p.id;
                        row.querySelector('.p-price-display').value = formatCurrency(p.price);
                        row.querySelector('.p-img').value = p.mainImage || p.image || (p.images ? p.images[0] : '');
                        
                        resultsDiv.classList.add('hidden');
                        renderVariants(row, p);
                        calculateManualTotal();
                    };
                } else {
                    d.onmousedown = (e) => {
                        e.preventDefault();
                        alert("Este producto está completamente agotado.");
                    };
                }
                resultsDiv.appendChild(d);
            });
        }
        resultsDiv.classList.remove('hidden');
    });

    document.addEventListener('click', (e) => {
        if (!searchInput.contains(e.target) && !resultsDiv.contains(e.target)) {
            resultsDiv.classList.add('hidden');
        }
    });
}

function updateRowStock(row, product) {
    let currentStock = parseInt(product.stock) || 0;
    
    const colorSel = row.querySelector('.p-color');
    const capSel = row.querySelector('.p-capacity');
    
    const selectedColor = colorSel ? colorSel.value : null;
    const selectedCap = capSel ? capSel.value : null;

    if (product.combinations && product.combinations.length > 0) {
        if (selectedColor || selectedCap) {
            const combo = product.combinations.find(c => {
                const matchColor = selectedColor ? c.color === selectedColor : true;
                const matchCap = selectedCap ? c.capacity === selectedCap : true;
                return matchColor && matchCap;
            });
            
            if (combo) {
                currentStock = parseInt(combo.stock) || 0;
            } else {
                currentStock = 0; 
            }
        }
    }

    row.querySelector('.p-max-stock').value = currentStock;
    
    const display = row.querySelector('.stock-display');
    if (display) {
        if (currentStock > 0) {
            display.innerHTML = `Disp: <span class="text-brand-cyan">${currentStock}</span>`;
        } else {
            display.innerHTML = `<span class="text-red-500">Agotado</span>`;
        }
    }

    const qtyInput = row.querySelector('.p-qty');
    let currentQty = parseInt(qtyInput.value) || 1;
    
    if (currentStock > 0 && currentQty > currentStock) {
        qtyInput.value = currentStock;
        calculateManualTotal();
    }
}

function renderVariants(row, product) {
    const container = row.querySelector('.p-variants-container');
    container.innerHTML = "";
    
    let colors = [];
    if (product.definedColors) colors = product.definedColors;
    else if (product.combinations) colors = product.combinations.map(v => v.color).filter(c => c);
    colors = [...new Set(colors)]; 

    let caps = [];
    if (product.definedCapacities) caps = product.definedCapacities;
    else if (product.capacities) caps = product.capacities.map(c => c.label);
    caps = [...new Set(caps)];

    if (colors.length > 0) {
        const wrap = document.createElement('div'); wrap.className = "flex-1";
        wrap.innerHTML = `<label class="text-[8px] font-black text-gray-400 uppercase tracking-widest mb-2 block text-center">Color</label>`;
        const sel = document.createElement('select'); sel.className = "p-color w-full bg-white border border-gray-200 rounded-xl py-3 px-2 text-xs font-bold outline-none text-brand-black cursor-pointer shadow-sm text-center appearance-none";
        sel.innerHTML = `<option value="">--</option>` + colors.map(c => `<option value="${c}">${c}</option>`).join('');
        sel.onchange = () => updateRowStock(row, product);
        wrap.appendChild(sel); container.appendChild(wrap);
    }
    
    if (caps.length > 0) {
        const wrap = document.createElement('div'); wrap.className = "flex-1";
        wrap.innerHTML = `<label class="text-[8px] font-black text-gray-400 uppercase tracking-widest mb-2 block text-center">Capacidad</label>`;
        const sel = document.createElement('select'); sel.className = "p-capacity w-full bg-white border border-gray-200 rounded-xl py-3 px-2 text-xs font-bold outline-none text-brand-black cursor-pointer shadow-sm text-center appearance-none";
        sel.innerHTML = `<option value="">--</option>` + caps.map(c => {
            let cPrice = product.price;
            if (product.capacities) {
                const capObj = product.capacities.find(x => x.label === c);
                if (capObj && capObj.price) cPrice = capObj.price;
            }
            return `<option value="${c}" data-price="${cPrice}">${c}</option>`;
        }).join('');
        
        sel.onchange = (e) => {
            const opt = e.target.options[e.target.selectedIndex];
            if(opt && opt.dataset.price) {
                row.querySelector('.p-price-display').value = formatCurrency(parseFloat(opt.dataset.price));
            }
            updateRowStock(row, product);
            calculateManualTotal();
        };
        wrap.appendChild(sel); container.appendChild(wrap);
    }

    updateRowStock(row, product);
}

function calculateManualTotal() {
    let subtotal = 0;
    document.querySelectorAll('.item-row-container').forEach(row => {
        const price = parseCurrency(row.querySelector('.p-price-display').value);
        const qty = parseInt(row.querySelector('.p-qty').value) || 0;
        subtotal += price * qty;
    });
    
    const shipping = parseCurrency(document.getElementById('m-shipping-cost').value);
    const total = subtotal + shipping;
    
    document.getElementById('manual-total-display').textContent = formatCurrency(total);
}


// --- LÓGICA DE CLIENTES (INTEGRADA) ---
async function setupCustomerSearch() {
    const search = document.getElementById('m-cust-search');
    const results = document.getElementById('m-cust-results');
    
    // Contenedores
    const searchSection = document.getElementById('m-search-section');
    const selectedSection = document.getElementById('m-selected-client-section');
    const newClientSection = document.getElementById('m-new-client-section');
    
    const modeSelect = document.getElementById('m-shipping-mode');
    const optSaved = document.getElementById('opt-saved-addr');
    const savedSelect = document.getElementById('m-saved-addr-select');

    // 1. EVENTO BUSCAR
    search.addEventListener('input', (e) => {
        const term = normalizeText(e.target.value);
        results.innerHTML = "";
        
        if (term.length < 2) { 
            results.classList.add('hidden'); 
            return; 
        }
        
        const filtered = manualClientsCache.filter(u => {
            const clientNameRaw = u.name || u.userName || "";
            const clientPhoneRaw = u.phone || "";
            const clientDocRaw = u.document || "";
            return normalizeText(clientNameRaw).includes(term) || clientPhoneRaw.includes(term) || clientDocRaw.includes(term);
        });

        if (filtered.length === 0) {
            results.innerHTML = `
                <div class="p-4 text-[10px] text-gray-400 font-bold text-center uppercase border-b border-gray-100">Cliente no encontrado</div>
                <div class="p-2 bg-gray-50 rounded-b-2xl">
                    <button type="button" id="btn-m-inline-create" class="w-full bg-brand-cyan text-brand-black font-black text-[10px] py-3 rounded-xl uppercase tracking-widest hover:bg-cyan-400 transition shadow-sm flex items-center justify-center gap-2">
                        <i class="fa-solid fa-user-plus"></i> Registrar Nuevo Cliente
                    </button>
                </div>
            `;
            
            // ACCIÓN: CREAR NUEVO
            document.getElementById('btn-m-inline-create').onmousedown = (ev) => {
                ev.preventDefault(); 
                isCreatingNewClient = true;
                
                // Mostrar UI de creación
                searchSection.classList.add('hidden');
                newClientSection.classList.remove('hidden');
                
                // Autocompletar lo que el usuario haya escrito
                const rawTerm = search.value.trim();
                if (/^[\d\s\+]+$/.test(rawTerm)) {
                    document.getElementById('m-nc-phone').value = rawTerm.replace(/\s+/g, '');
                    document.getElementById('m-nc-name').focus();
                } else {
                    document.getElementById('m-nc-name').value = rawTerm;
                    document.getElementById('m-nc-phone').focus();
                }
                
                // Reset de Direcciones (Obliga a escribir una nueva)
                optSaved.disabled = true;
                optSaved.textContent = "🏠 Dirección Guardada (Seleccione Cliente)";
                modeSelect.value = 'new';
                modeSelect.dispatchEvent(new Event('change'));
                
                results.classList.add('hidden');
            };

        } else {
            // MOSTRAR RESULTADOS
            filtered.slice(0, 8).forEach(u => {
                const div = document.createElement('div');
                div.className = "p-3 hover:bg-cyan-50 cursor-pointer rounded-xl transition flex justify-between items-center border-b border-gray-50 last:border-0 group";
                
                const displayName = u.name || u.userName || 'Cliente sin nombre';
                
                div.innerHTML = `
                    <div>
                        <span class="block font-black text-xs uppercase text-brand-black">${displayName}</span>
                        <span class="text-[9px] font-bold text-gray-400">${u.phone || 'Sin teléfono'} ${u.document ? ` | Doc: ${u.document}` : ''}</span>
                    </div>
                    <button class="bg-white border border-gray-200 text-brand-cyan w-6 h-6 rounded-full flex items-center justify-center group-hover:bg-brand-cyan group-hover:text-white transition shadow-sm"><i class="fa-solid fa-check text-[10px]"></i></button>
                `;
                
                // ACCIÓN: SELECCIONAR EXISTENTE
                div.onmousedown = (ev) => {
                    ev.preventDefault(); 
                    isCreatingNewClient = false;
                    selectedUserId = u.id;
                    selectedUserName = displayName;
                    selectedUserPhone = u.phone || "";
                    currentUserAddresses = u.addresses || [];
                    
                    // Cambiar UI
                    searchSection.classList.add('hidden');
                    selectedSection.classList.remove('hidden');
                    document.getElementById('m-sel-cname').textContent = selectedUserName;
                    document.getElementById('m-sel-cphone').textContent = selectedUserPhone || "Sin Teléfono";
                    
                    // Cargar direcciones guardadas
                    if (currentUserAddresses.length > 0) {
                        optSaved.disabled = false;
                        optSaved.textContent = `🏠 Usar Guardada (${currentUserAddresses.length})`;
                        savedSelect.innerHTML = '<option value="">Seleccione Dirección...</option>';
                        currentUserAddresses.forEach((a, i) => savedSelect.innerHTML += `<option value="${i}">${a.alias} - ${a.address}</option>`);
                        modeSelect.value = 'saved';
                    } else {
                        optSaved.disabled = true;
                        optSaved.textContent = "🏠 Sin direcciones guardadas";
                        modeSelect.value = 'new';
                    }
                    modeSelect.dispatchEvent(new Event('change'));
                    results.classList.add('hidden');
                };
                results.appendChild(div);
            });
        }
        results.classList.remove('hidden');
    });

    // 2. CANCELAR O LIMPIAR CLIENTE
    const resetClientUI = () => {
        isCreatingNewClient = false;
        selectedUserId = null;
        selectedUserName = "";
        selectedUserPhone = "";
        currentUserAddresses = [];
        
        search.value = "";
        document.getElementById('m-nc-name').value = "";
        document.getElementById('m-nc-phone').value = "";
        document.getElementById('m-nc-doc').value = "";
        document.getElementById('m-nc-email').value = "";
        
        searchSection.classList.remove('hidden');
        selectedSection.classList.add('hidden');
        newClientSection.classList.add('hidden');
        results.classList.add('hidden');
        search.focus();
        
        optSaved.disabled = true;
        optSaved.textContent = "🏠 Dirección Guardada (Seleccione Cliente)";
        modeSelect.value = 'new';
        modeSelect.dispatchEvent(new Event('change'));
    };

    document.getElementById('btn-clear-client').onclick = resetClientUI;
    document.getElementById('btn-cancel-new-client').onclick = resetClientUI;

    document.addEventListener('click', (e) => {
        if (!search.contains(e.target) && !results.contains(e.target)) results.classList.add('hidden');
    });
}


async function loadPaymentAccounts() {
    const sel = document.getElementById('m-payment-account');
    sel.innerHTML = `<option value="credit">⏳ Cartera (Pendiente de Cobro)</option>`;
    try {
        const q = query(collection(db, "accounts"), orderBy("name", "asc"));
        const snap = await getDocs(q);
        snap.forEach(d => sel.innerHTML += `<option value="${d.id}">🏦 PAGO RECIBIDO EN: ${d.data().name}</option>`);
    } catch(e) { console.error(e); }
}

async function loadManualDepartments() {
    const selManual = document.getElementById('m-dept-manual');
    try {
        const res = await fetch('https://api-colombia.com/api/v1/Department');
        const data = await res.json();
        data.sort((a,b) => a.name.localeCompare(b.name));
        let options = '<option value="">Seleccionar Depto...</option>';
        data.forEach(d => options += `<option value="${d.id}">${d.name}</option>`);
        if (selManual) selManual.innerHTML = options;
    } catch(e) { console.error(e); }
}

// --- GUARDAR TRANSACCIÓN Y CREAR CLIENTE SI ES NECESARIO ---
async function saveOrder() {
    const btn = document.getElementById('btn-save-manual');
    
    // 1. VALIDAR ESTADO DEL CLIENTE
    if (!selectedUserId && !isCreatingNewClient) {
        return alert("🚨 Por favor, busca un cliente existente o registra uno nuevo.");
    }

    // 2. VALIDAR PRODUCTOS
    const items = [];
    let hasStockError = false;
    
    document.querySelectorAll('.item-row-container').forEach(row => {
        const id = row.querySelector('.p-id').value;
        const qty = parseInt(row.querySelector('.p-qty').value);
        const maxStock = parseInt(row.querySelector('.p-max-stock').value) || 0;
        
        if(id && qty > 0) {
            if (qty > maxStock) hasStockError = true;
            
            items.push({
                id,
                name: row.querySelector('.p-search').value,
                price: parseCurrency(row.querySelector('.p-price-display').value),
                quantity: qty,
                image: row.querySelector('.p-img').value,
                color: row.querySelector('.p-color')?.value || null,
                capacity: row.querySelector('.p-capacity')?.value || null
            });
        }
    });

    if (hasStockError) return alert("🚨 Uno de los productos excede el stock disponible.");
    if (items.length === 0) return alert("🚨 Debes agregar al menos un producto a la venta.");

    // 3. CAPTURAR DATOS DE ENVÍO
    const shippingMode = document.getElementById('m-shipping-mode').value;
    let shippingData = {};
    let clientDept = ""; 
    let clientCity = ""; 
    let clientAddr = "";
    
    if (shippingMode === 'pickup') {
        shippingData = { address: "📍 Recogida en Local" };
    } else if (shippingMode === 'saved') {
        const idx = document.getElementById('m-saved-addr-select').value;
        if (idx === "") return alert("Seleccione la dirección guardada del cliente");
        const a = currentUserAddresses[idx];
        shippingData = { department: a.dept, city: a.city, address: `${a.address} (${a.alias})` };
    } else {
        const dSelect = document.getElementById('m-dept-manual');
        clientDept = dSelect.options[dSelect.selectedIndex]?.text || "";
        clientCity = document.getElementById('m-city-manual').value || "";
        clientAddr = document.getElementById('m-address-manual').value || "";
        
        shippingData = {
            department: clientDept,
            city: clientCity,
            address: clientAddr
        };
        if(!shippingData.department || !shippingData.address) return alert("Faltan datos de la nueva dirección de entrega.");
    }

    const originalText = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Procesando Venta...';

    try {
        let finalUserId = selectedUserId;
        let custName = selectedUserName;
        let custPhone = selectedUserPhone;

        // 4. SI ESTÁ CREANDO UN CLIENTE NUEVO EN LÍNEA -> GUARDARLO EN FIREBASE PRIMERO
        if (isCreatingNewClient) {
            custName = document.getElementById('m-nc-name').value.trim();
            custPhone = document.getElementById('m-nc-phone').value.trim();
            const docVal = document.getElementById('m-nc-doc').value.trim();
            const emailVal = document.getElementById('m-nc-email').value.trim();

            if (!custName || !custPhone) throw new Error("🚨 El Nombre y Teléfono del nuevo cliente son obligatorios.");

            const newClientData = {
                name: custName,
                phone: custPhone,
                email: emailVal,
                document: docVal,
                source: 'MANUAL',
                role: 'client',
                createdAt: new Date(),
                updatedAt: new Date(),
                dept: clientDept,
                city: clientCity,
                address: clientAddr,
                addresses: clientAddr ? [{ alias: "Principal", address: clientAddr, dept: clientDept, city: clientCity, isDefault: true }] : []
            };

            const docRef = await addDoc(collection(db, "users"), newClientData);
            finalUserId = docRef.id;
        }

        // 5. CÁLCULOS FINALES
        const shippingCost = parseCurrency(document.getElementById('m-shipping-cost').value);
        const subtotal = items.reduce((acc, i) => acc + (i.price * i.quantity), 0);
        const total = subtotal + shippingCost;
        const accountId = document.getElementById('m-payment-account').value;

        if (total <= 0) throw new Error("El total de la venta no puede ser cero.");

        for (const item of items) { 
            await adjustStock(item.id, -(item.quantity), item.color, item.capacity); 
        }

        // 6. LÓGICA FINANCIERA
        let paymentStatus = 'PENDING';
        let paymentMethodName = 'Crédito / Cartera';
        let amountPaid = 0;

        if (accountId !== 'credit') {
             await runTransaction(db, async (t) => {
                 const ref = doc(db, "accounts", accountId);
                 const d = await t.get(ref);
                 if(!d.exists()) throw new Error("La cuenta seleccionada ya no existe.");
                 
                 t.update(ref, { balance: (d.data().balance || 0) + total });
                 paymentMethodName = d.data().name;
             });
             
             await addDoc(collection(db, "expenses"), {
                 amount: total,
                 category: "Ingreso Ventas Manual",
                 description: `Cobro Inmediato - Venta a ${custName || 'Cliente'}`,
                 paymentMethod: paymentMethodName,
                 supplierName: custName || "Cliente Directo",
                 date: new Date(),
                 createdAt: new Date(),
                 type: 'INCOME'
             });

             paymentStatus = 'PAID';
             amountPaid = total;
        }

        // 7. CREAR LA ORDEN
        const orderData = {
            userId: finalUserId, 
            userName: custName, 
            phone: custPhone,
            items, 
            total, 
            subtotal, 
            shippingCost,
            status: 'PENDIENTE', 
            source: 'MANUAL',
            requiresInvoice: document.getElementById('m-requires-invoice').checked,
            paymentStatus, 
            amountPaid,
            paymentAccountId: accountId === 'credit' ? null : accountId, 
            paymentMethodName,
            createdAt: new Date(), 
            updatedAt: new Date(),
            shippingData
        };

        const orderRef = await addDoc(collection(db, "orders"), orderData);
        
        await setDoc(doc(db, "remissions", orderRef.id), { 
            ...orderData, 
            orderId: orderRef.id, 
            status: 'PENDIENTE_ALISTAMIENTO', 
            type: 'DIRECTA' 
        });

        alert(`✅ Venta Exitosa.\nLa orden #${orderRef.id.slice(0,6)} ha sido enviada al centro logístico.`);
        document.getElementById('manual-modal').classList.add('hidden');
        
        if (onSuccessCallback) onSuccessCallback();

    } catch (e) {
        console.error(e);
        alert(e.message);
    } finally {
        btn.disabled = false; btn.innerHTML = originalText;
    }
}