import { db, collection, doc, runTransaction, addDoc, setDoc, getDocs, query, orderBy, auth } from '../firebase-init.js';
import { adjustStock } from './inventory-core.js';
import { AdminStore } from './admin-store.js';

// --- HTML DEL MODAL ---
const MODAL_HTML = `
<div id="manual-modal" class="fixed inset-0 z-[80] hidden flex items-center justify-center p-4 sm:p-6">
    <div class="absolute inset-0 bg-slate-900/70 backdrop-blur-sm" id="btn-close-overlay"></div>
    <div class="relative bg-white w-full max-w-5xl rounded-[2.5rem] shadow-2xl flex flex-col max-h-[95vh] overflow-hidden">
        
        <div class="px-8 py-6 border-b border-gray-100 flex justify-between items-center bg-slate-50/80 shrink-0">
            <div>
                <h3 class="text-2xl font-black tracking-tighter uppercase text-brand-black leading-none">Nueva <span class="text-brand-orange">Venta Directa</span></h3>
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
                        <input type="text" id="m-cust-search" autocomplete="off" placeholder="Buscar por nombre, teléfono o cédula..." class="w-full bg-slate-50 border border-gray-100 py-4 pl-11 pr-4 rounded-2xl text-sm font-bold outline-none focus:border-brand-orange focus:bg-white transition-colors text-brand-black shadow-sm">
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

                <div id="m-new-client-section" class="hidden bg-orange-50/30 p-6 rounded-[2rem] border border-orange-100 relative animate-in fade-in slide-in-from-top-2 shadow-sm">
                    <button id="btn-cancel-new-client" class="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:bg-white hover:text-red-500 transition shadow-sm border border-transparent hover:border-gray-200" title="Cancelar"><i class="fa-solid fa-xmark"></i></button>
                    
                    <div class="mb-5">
                        <span class="bg-brand-orange text-brand-black px-3 py-1 rounded-md text-[9px] font-black uppercase tracking-widest shadow-sm">Registrar Nuevo Cliente</span>
                    </div>
                    
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
                        <div class="md:col-span-2">
                            <label class="text-[9px] font-black text-gray-500 uppercase tracking-widest mb-1 block ml-1">Nombre Completo *</label>
                            <input type="text" id="m-nc-name" placeholder="Ej: Juan Pérez" class="w-full bg-white border border-orange-100 p-3.5 rounded-xl text-sm font-bold outline-none focus:border-brand-orange shadow-sm">
                        </div>
                        <div>
                            <label class="text-[9px] font-black text-gray-500 uppercase tracking-widest mb-1 block ml-1">Teléfono / WhatsApp *</label>
                            <input type="text" id="m-nc-phone" placeholder="Ej: 3001234567" class="w-full bg-white border border-orange-100 p-3.5 rounded-xl text-sm font-bold outline-none focus:border-brand-orange shadow-sm">
                        </div>
                        <div>
                            <label class="text-[9px] font-black text-gray-500 uppercase tracking-widest mb-1 block ml-1">Cédula / NIT</label>
                            <input type="text" id="m-nc-doc" placeholder="Opcional" class="w-full bg-white border border-orange-100 p-3.5 rounded-xl text-sm font-bold outline-none focus:border-brand-orange shadow-sm">
                        </div>
                        <div class="md:col-span-2">
                            <label class="text-[9px] font-black text-gray-500 uppercase tracking-widest mb-1 block ml-1">Email</label>
                            <input type="email" id="m-nc-email" placeholder="cliente@correo.com" class="w-full bg-white border border-orange-100 p-3.5 rounded-xl text-sm font-bold outline-none focus:border-brand-orange shadow-sm">
                        </div>
                    </div>
                </div>
            </div>

            <div class="bg-slate-50 p-6 rounded-[2rem] border border-gray-100 space-y-5 relative">
                <div class="absolute -top-3 left-6 bg-brand-orange text-brand-black px-3 py-1 rounded-md text-[9px] font-black uppercase tracking-widest shadow-sm">
                    Datos de Entrega
                </div>
                
                <div class="grid grid-cols-1 gap-4 pt-2">
                    <select id="m-shipping-mode" class="w-full bg-white border border-gray-200 p-4 rounded-2xl text-xs font-bold outline-none focus:border-brand-orange appearance-none cursor-pointer text-brand-black shadow-sm">
                        <option value="pickup">📍 Recogida en Local / Contraentrega</option>
                        <option value="new" selected>🚚 Nueva Dirección Nacional</option>
                        <option value="saved" disabled id="opt-saved-addr">🏠 Dirección Guardada (Seleccione Cliente)</option>
                    </select>
                </div>

                <div id="container-saved-addr" class="hidden animate-in fade-in slide-in-from-top-2">
                    <select id="m-saved-addr-select" class="w-full bg-white border border-gray-200 p-4 rounded-2xl text-xs font-bold outline-none focus:border-brand-orange appearance-none cursor-pointer text-brand-black shadow-sm">
                        <option value="">Seleccione...</option>
                    </select>
                </div>

                <div id="container-new-addr" class="animate-in fade-in slide-in-from-top-2 space-y-4">
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label class="text-[9px] font-black uppercase text-gray-400 tracking-widest mb-2 block ml-1">Departamento</label>
                            <select id="m-dept-manual" class="w-full bg-white border border-gray-200 p-4 rounded-2xl text-xs font-bold outline-none focus:border-brand-orange appearance-none cursor-pointer text-brand-black shadow-sm"><option value="">Seleccionar...</option></select>
                        </div>
                        <div>
                            <label class="text-[9px] font-black uppercase text-gray-400 tracking-widest mb-2 block ml-1">Ciudad</label>
                            <select id="m-city-manual" class="w-full bg-white border border-gray-200 p-4 rounded-2xl text-xs font-bold outline-none focus:border-brand-orange appearance-none cursor-pointer text-brand-black shadow-sm" disabled><option value="">Seleccione Depto primero</option></select>
                        </div>
                    </div>
                    <div>
                        <label class="text-[9px] font-black uppercase text-gray-400 tracking-widest mb-2 block ml-1">Dirección Exacta</label>
                        <input type="text" id="m-address-manual" placeholder="Ej: Calle 123 # 45 - 67, Barrio..." class="w-full bg-white border border-gray-200 p-4 rounded-2xl text-sm font-bold outline-none focus:border-brand-orange text-brand-black shadow-sm">
                    </div>
                </div>
            </div>

            <div class="space-y-4">
                <div class="flex justify-between items-end border-b border-gray-100 pb-3">
                    <div>
                        <h4 class="text-xs font-black text-brand-black uppercase tracking-widest">Productos</h4>
                        <p class="text-[9px] text-gray-400 font-bold uppercase mt-0.5">Añade los items a vender</p>
                    </div>
                    <button id="btn-add-item-row" class="text-brand-orange hover:text-white hover:bg-brand-orange bg-orange-50 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-colors flex items-center gap-2 border border-brand-orange/20">
                        <i class="fa-solid fa-circle-plus text-sm"></i> Añadir Línea
                    </button>
                </div>
                <div id="manual-items-container" class="space-y-3"></div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-5 gap-6 pt-6 border-t border-gray-100 items-start">
                <!-- Métodos de Pago y Montos (4/5) -->
                <div class="md:col-span-4 space-y-4">
                    <label class="block text-[9px] font-black text-gray-400 uppercase tracking-widest ml-1">Métodos de Pago y Montos</label>
                    <div id="m-pay-splits-container" class="space-y-3">
                        <!-- Se insertan dinámicamente -->
                    </div>
                    
                    <!-- Resumen de Pagos Divididos -->
                    <div id="m-pay-splits-summary" class="hidden p-4 rounded-2xl border flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 transition-all duration-300">
                        <div class="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-brand-black">
                            <i class="fa-solid fa-calculator text-brand-orange"></i>
                            <span>Resumen de Pagos:</span>
                        </div>
                        <div class="flex flex-wrap gap-4 text-[10px] font-bold uppercase tracking-wider">
                            <div>Suma: <span id="m-pay-split-sum" class="font-black text-brand-black"></span></div>
                            <div>Restante: <span id="m-pay-split-remaining" class="font-black text-brand-orange"></span></div>
                        </div>
                    </div>

                    <button type="button" id="btn-m-add-pay-split" class="w-full py-3.5 border-2 border-dashed border-gray-200 rounded-2xl font-black text-[10px] uppercase tracking-widest text-gray-400 hover:border-brand-orange hover:text-brand-orange hover:bg-orange-50/20 transition flex items-center justify-center gap-2">
                        <i class="fa-solid fa-circle-plus"></i> Agregar Método de Pago (Dividir Pago)
                    </button>
                </div>

                <!-- Facturación Electrónica (1/5) -->
                <div class="md:col-span-1 bg-brand-orange/5 border border-brand-orange/20 p-5 rounded-[2rem] flex flex-col justify-between shadow-sm min-h-[150px]">
                    <div class="flex flex-col gap-2">
                        <div class="w-9 h-9 rounded-full bg-white text-brand-orange flex items-center justify-center text-sm shadow-sm border border-brand-orange/15">
                            <i class="fa-solid fa-file-invoice"></i>
                        </div>
                        <p class="text-[10px] font-black uppercase tracking-widest text-brand-black leading-tight mt-1">¿Factura Electrónica?</p>
                    </div>
                    <div class="flex justify-end mt-4">
                        <label class="relative inline-flex items-center cursor-pointer">
                            <input type="checkbox" id="m-requires-invoice" class="sr-only peer">
                            <div class="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-brand-orange"></div>
                        </label>
                    </div>
                </div>
            </div>
        </div>
        
        <div class="p-6 md:p-8 border-t border-gray-100 bg-white grid grid-cols-1 md:grid-cols-12 gap-6 items-center shrink-0 rounded-b-[2.5rem]">
             <div class="md:col-span-4 flex flex-col justify-center">
                <label class="text-[9px] font-black uppercase text-gray-400 tracking-widest mb-2 block ml-1">Costo de Envío Extra</label>
                <div class="relative">
                    <i class="fa-solid fa-truck-fast absolute left-4 top-1/2 -translate-y-1/2 text-gray-300"></i>
                    <input type="text" id="m-shipping-cost" value="$ 0" class="currency-input w-full bg-slate-50 border border-gray-100 py-4 pl-11 pr-4 rounded-2xl text-sm font-black outline-none focus:border-brand-orange text-brand-black transition-colors shadow-inner">
                </div>
                <!-- 🔥 NUEVO: Checkbox 4x1000 -->
                <label class="flex items-center gap-2 mt-3 cursor-pointer ml-1 select-none">
                    <input type="checkbox" id="m-apply-4x1000" class="w-4 h-4 rounded text-brand-orange border-gray-300 focus:ring-brand-orange">
                    <span class="text-[10px] font-black uppercase text-brand-black tracking-widest">Cobrar 4x1000 Cliente</span>
                </label>
            </div>
            
            <div class="md:col-span-4 text-center md:text-right flex flex-col justify-center">
                <p class="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1">Total de la Venta</p>
                <h4 id="manual-total-display" class="text-4xl md:text-5xl font-black text-brand-black tracking-tighter leading-none">$ 0</h4>
            </div>
            
            <div class="md:col-span-4 h-full">
                <button id="btn-save-manual" class="w-full h-full min-h-[60px] bg-brand-black text-white font-black px-6 py-4 rounded-2xl shadow-xl shadow-brand-black/20 uppercase text-xs tracking-widest hover:bg-brand-orange hover:text-brand-black hover:shadow-brand-orange/30 transition-all duration-300 transform active:scale-95 flex items-center justify-center gap-3">
                    <i class="fa-solid fa-check-double text-lg"></i> <span class="mt-0.5">Generar Venta</span>
                </button>
            </div>
        </div>
    </div>
</div>
`;

// --- VARIABLES GLOBALES ---
let manualProductsCache = []; 
let manualClientsCache = [];
let isCreatingNewClient = false;
let selectedUserId = null;
let selectedUserName = "";
let selectedUserPhone = "";
let selectedUserDoc = ""; 
let currentUserAddresses = [];
let onSuccessCallback = null;

const formatCurrency = (num) => '$ ' + num.toLocaleString('es-CO');
const parseCurrency = (str) => Number(str.replace(/[^0-9-]/g, '')) || 0;
const normalizeText = (str) => str ? str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") : "";

let manualBranchesList = [];
async function loadBranchesForManualSale() {
    if (manualBranchesList.length > 0) return manualBranchesList;
    try {
        const snap = await getDocs(collection(db, "branches"));
        manualBranchesList = [];
        snap.forEach(d => {
            manualBranchesList.push({ id: d.id, ...d.data() });
        });
        return manualBranchesList;
    } catch (e) {
        console.error("Error cache branches manual sale:", e);
        return [];
    }
}

function getOtherBranchesStockDetails(product, activeBranchId, selectedColor = null, selectedCap = null) {
    let branchStockMap = {};
    let globalStock = 0;
    
    if (product.combinations && product.combinations.length > 0) {
        if (selectedColor || selectedCap) {
            const combo = product.combinations.find(c => {
                const matchColor = selectedColor ? c.color === selectedColor : true;
                const matchCap = selectedCap ? c.capacity === selectedCap : true;
                return matchColor && matchCap;
            });
            if (combo) {
                branchStockMap = combo.branchStock || {};
                globalStock = combo.stock || 0;
            }
        } else {
            // Sum global combinations stock by branch if no specific variant is selected yet
            let totalOtherStock = 0;
            manualBranchesList.forEach(br => {
                let brSum = 0;
                product.combinations.forEach(combo => {
                    brSum += combo.branchStock ? (combo.branchStock[br.id] || 0) : (br.id === 'sede_principal' ? combo.stock || 0 : 0);
                });
                if (br.id !== activeBranchId && brSum > 0) {
                    totalOtherStock += brSum;
                }
            });
            return `Otras: ${totalOtherStock}`;
        }
    } else {
        branchStockMap = product.branchStock || {};
        globalStock = product.stock || 0;
    }

    let totalOtherStock = 0;
    manualBranchesList.forEach(br => {
        if (br.id !== activeBranchId) {
            const qty = branchStockMap[br.id] !== undefined 
                ? (branchStockMap[br.id] || 0) 
                : (br.id === 'sede_principal' ? globalStock : 0);
            if (qty > 0) {
                totalOtherStock += qty;
            }
        }
    });

    return `Otras: ${totalOtherStock}`;
}

function setupCurrencyInput(input) {
    input.addEventListener('input', (e) => {
        const val = parseCurrency(e.target.value);
        e.target.value = formatCurrency(val);
        calculateManualTotal();
    });
    input.addEventListener('focus', (e) => e.target.select());
}

AdminStore.subscribeToProducts((products) => {
    manualProductsCache = products;
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
    const searchInput = document.getElementById('m-cust-search');
    if (searchInput && searchInput.value.trim().length >= 2 && !isCreatingNewClient && !selectedUserId) {
        searchInput.dispatchEvent(new Event('input'));
    }
});

export function initManualSale(onSuccess) {
    if (!document.getElementById('manual-modal')) {
        document.body.insertAdjacentHTML('beforeend', MODAL_HTML);
        setupEventListeners();
    }
    onSuccessCallback = onSuccess;
}

export async function openManualSaleModal() {
    const modal = document.getElementById('manual-modal');
    const container = document.getElementById('manual-items-container');
    
    isCreatingNewClient = false;
    selectedUserId = null;
    selectedUserName = "";
    selectedUserPhone = "";
    selectedUserDoc = "";
    currentUserAddresses = [];
    
    document.getElementById('m-search-section').classList.remove('hidden');
    document.getElementById('m-selected-client-section').classList.add('hidden');
    document.getElementById('m-new-client-section').classList.add('hidden');
    
    document.getElementById('m-cust-search').value = "";
    document.getElementById('m-nc-name').value = "";
    document.getElementById('m-nc-phone').value = "";
    document.getElementById('m-nc-doc').value = "";
    document.getElementById('m-nc-email').value = "";
    document.getElementById('m-apply-4x1000').checked = false; // Reiniciar check

    document.getElementById('manual-total-display').textContent = "$ 0";
    document.getElementById('m-shipping-cost').value = "$ 0";
    document.getElementById('m-dept-manual').value = "";
    document.getElementById('m-city-manual').value = "";
    document.getElementById('m-address-manual').value = "";
    container.innerHTML = "";
    resetPaymentSplits();

    await Promise.all([
        loadPaymentAccounts(), 
        loadManualDepartments(),
        loadBranchesForManualSale()
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
    document.getElementById('m-apply-4x1000').addEventListener('change', calculateManualTotal); // Evento 4x1000
    document.getElementById('btn-m-add-pay-split').onclick = () => {
        const remaining = getManualRemainingBalance();
        addManualPaySplitRow(remaining);
    };

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

function addManualItemRow() {
    const div = document.createElement('div');
    div.className = "item-row-container relative focus-within:z-[60] bg-slate-50/50 p-4 rounded-2xl border border-gray-100 shadow-sm animate-in fade-in slide-in-from-top-2";
    div.innerHTML = `
        <div class="grid grid-cols-1 md:grid-cols-12 gap-3 items-start relative focus-within:z-[60]">
            <div class="md:col-span-4 relative focus-within:z-[70]">
                <label class="text-[8px] font-black text-gray-400 uppercase tracking-widest mb-2 block ml-1">Producto</label>
                <div class="relative">
                    <input type="text" autocomplete="off" placeholder="Buscar por nombre o SKU..." class="p-search w-full bg-white border border-gray-200 rounded-xl py-3 px-4 text-xs font-bold outline-none focus:border-brand-orange text-brand-black pr-8 shadow-sm relative z-10">
                    <i class="fa-solid fa-magnifying-glass absolute right-3 top-1/2 -translate-y-1/2 text-gray-300 text-xs pointer-events-none z-20"></i>
                </div>
                <div class="p-results absolute top-full left-0 z-[100] w-full mt-2 bg-white border border-gray-200 rounded-xl shadow-2xl hidden max-h-56 overflow-y-auto custom-scroll"></div>
            </div>
            
            <div class="md:col-span-3 flex gap-2 p-variants-container"></div>
            
             <div class="md:col-span-3">
                <label class="text-[8px] font-black text-gray-400 uppercase tracking-widest mb-2 block text-center">Precio Unitario</label>
                <input type="text" class="p-price-display currency-input w-full bg-white border border-gray-200 rounded-xl py-3 px-2 text-xs font-bold text-center outline-none focus:border-brand-orange text-brand-black shadow-sm">
            </div>
            
            <div class="md:col-span-2 flex items-start gap-2">
                <div class="w-full relative">
                    <label class="text-[8px] font-black text-gray-400 uppercase tracking-widest mb-2 block text-center">Cant.</label>
                    <input type="number" value="1" min="1" class="p-qty w-full bg-white border border-gray-200 rounded-xl py-3 px-1 text-sm font-black text-center outline-none focus:border-brand-orange text-brand-black shadow-sm mb-1">
                    <p class="text-[8px] font-black text-center stock-display text-gray-400 whitespace-normal">---</p>
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
    qtyInput.oninput = () => {
        let current = parseInt(qtyInput.value) || 1;
        if (current < 1) { qtyInput.value = 1; current = 1; }
        
        const pId = div.querySelector('.p-id').value;
        if (pId) {
            const product = manualProductsCache.find(p => p.id === pId);
            if (product) updateRowStock(div, product);
        }
        calculateManualTotal();
    };
    qtyInput.onchange = qtyInput.oninput;

    div.querySelector('.btn-remove-row').onclick = () => { div.remove(); calculateManualTotal(); };
    setupProductSearch(div);
}

function setupProductSearch(row) {
    const searchInput = row.querySelector('.p-search');
    const resultsDiv = row.querySelector('.p-results');

    searchInput.addEventListener('input', (e) => {
        const term = normalizeText(e.target.value);
        resultsDiv.innerHTML = "";
        if (term.length < 2) { resultsDiv.classList.add('hidden'); return; }
        
        const filtered = manualProductsCache.filter(p => {
            const searchStr = p.searchStr || normalizeText(`${p.name} ${p.sku || ''}`);
            return searchStr.includes(term);
        });

        const activeBranchId = sessionStorage.getItem('activeBranchId') || 'bodega';

        if (filtered.length === 0) {
            resultsDiv.innerHTML = `<div class="p-3 text-[10px] text-gray-400 text-center uppercase font-bold">No encontrado</div>`;
        } else {
            filtered.slice(0, 15).forEach(p => {
                const branchStockVal = (p.branchStock && p.branchStock[activeBranchId] !== undefined) ? (p.branchStock[activeBranchId] || 0) : (p.stock || 0);
                const otherBranchesText = getOtherBranchesStockDetails(p, activeBranchId);
                const isOutOfStock = branchStockVal <= 0;
                const d = document.createElement('div');
                d.className = "p-3 flex items-center justify-between border-b border-gray-50 last:border-0 hover:bg-orange-50 cursor-pointer transition";
                d.innerHTML = `<div class="flex-1 min-w-0 pr-2"><p class="text-[10px] font-black uppercase text-brand-black line-clamp-1">${p.name}</p><p class="text-[9px] font-bold text-gray-400 mt-0.5">SKU: ${p.sku || '--'} | Sede: <span class="${isOutOfStock ? 'text-red-500 font-bold' : 'text-brand-orange'}">${branchStockVal}</span> | ${otherBranchesText}</p></div><div class="text-right shrink-0"><p class="text-[10px] font-black text-brand-black">${formatCurrency(p.price)}</p></div>`;

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
                resultsDiv.appendChild(d);
            });
        }
        resultsDiv.classList.remove('hidden');
    });

    document.addEventListener('click', (e) => {
        if (!searchInput.contains(e.target) && !resultsDiv.contains(e.target)) resultsDiv.classList.add('hidden');
    });
}

function updateRowStock(row, product) {
    const activeBranchId = sessionStorage.getItem('activeBranchId') || 'bodega';
    const activeBranchName = sessionStorage.getItem('activeBranchName') || 'Sede Principal';

    const colorSel = row.querySelector('.p-color');
    const capSel = row.querySelector('.p-capacity');
    const selectedColor = colorSel ? colorSel.value : null;
    const selectedCap = capSel ? capSel.value : null;

    let hasSelectedAllRequiredVariants = true;
    if (product.combinations && product.combinations.length > 0) {
        if (colorSel && colorSel.value === "") hasSelectedAllRequiredVariants = false;
        if (capSel && capSel.value === "") hasSelectedAllRequiredVariants = false;
    }

    if (!hasSelectedAllRequiredVariants) {
        row.querySelector('.p-max-stock').value = 0;
        const display = row.querySelector('.stock-display');
        if (display) {
            display.innerHTML = `<span class="text-orange-500 font-black">Seleccionar Variante</span>`;
        }
        const transferContainer = row.querySelector('.transfer-auto-container');
        if (transferContainer) transferContainer.classList.add('hidden');
        return;
    }

    const hasBranchStock = product.branchStock && Object.keys(product.branchStock).length > 0;
    let currentStock = hasBranchStock ? (parseInt(product.branchStock[activeBranchId]) || 0) : (parseInt(product.stock) || 0);
    let totalStock = parseInt(product.stock) || 0;

    if (product.combinations && product.combinations.length > 0) {
        const combo = product.combinations.find(c => {
            const matchColor = selectedColor ? c.color === selectedColor : true;
            const matchCap = selectedCap ? c.capacity === selectedCap : true;
            return matchColor && matchCap;
        });
        if (combo) {
            const hasComboBranchStock = combo.branchStock && Object.keys(combo.branchStock).length > 0;
            currentStock = hasComboBranchStock ? (parseInt(combo.branchStock[activeBranchId]) || 0) : (parseInt(combo.stock) || 0);
            totalStock = parseInt(combo.stock) || 0;
        } else {
            currentStock = 0;
            totalStock = 0;
        }
    }

    const otherBranchesText = getOtherBranchesStockDetails(product, activeBranchId, selectedColor, selectedCap);

    row.querySelector('.p-max-stock').value = currentStock;
    const display = row.querySelector('.stock-display');
    if (display) {
        display.innerHTML = currentStock > 0 
            ? `Sede: <span class="text-brand-orange">${currentStock}</span> <span class="text-gray-400 font-normal">| ${otherBranchesText}</span>` 
            : `<span class="text-red-500">Agotado Sede</span> <span class="text-xs text-gray-400 font-normal">| ${otherBranchesText}</span>`;
    }

    const qtyInput = row.querySelector('.p-qty');
    let currentQty = parseInt(qtyInput.value) || 1;

    // 🔥 PREVENIR VENDER MÁS DEL STOCK GLOBAL DISPONIBLE
    if (currentQty > totalStock) {
        alert(`🚨 No puedes vender más del stock global disponible de este producto/variante (${totalStock} unds).`);
        qtyInput.value = totalStock;
        currentQty = totalStock;
    }

    // --- DETECTAR DÉFICIT Y MOSTRAR CONTENEDOR DE TRASLADO AUTOMÁTICO ---
    let transferContainer = row.querySelector('.transfer-auto-container');
    
    if (currentQty > currentStock) {
        if (!transferContainer) {
            transferContainer = document.createElement('div');
            transferContainer.className = "transfer-auto-container mt-3 text-[10px] bg-orange-50 border border-brand-orange/20 p-3 rounded-2xl flex items-center justify-between gap-3 animate-in slide-in-from-top-1 duration-200 w-full z-10 relative";
            row.appendChild(transferContainer);
        }

        let branchStockMap = {};
        let globalStock = 0;
        if (product.combinations && product.combinations.length > 0) {
            const combo = product.combinations.find(c => {
                const matchColor = selectedColor ? c.color === selectedColor : true;
                const matchCap = selectedCap ? c.capacity === selectedCap : true;
                return matchColor && matchCap;
            });
            if (combo) {
                branchStockMap = combo.branchStock || {};
                globalStock = combo.stock || 0;
            }
        } else {
            branchStockMap = product.branchStock || {};
            globalStock = product.stock || 0;
        }

        const branchesWithStock = [];
        manualBranchesList.forEach(br => {
            if (br.id !== activeBranchId) {
                const qty = branchStockMap[br.id] !== undefined 
                    ? (branchStockMap[br.id] || 0) 
                    : (br.id === 'sede_principal' ? globalStock : 0);
                if (qty > 0) {
                    branchesWithStock.push({ id: br.id, name: br.name, stock: qty });
                }
            }
        });

        const deficit = currentQty - currentStock;

        if (branchesWithStock.length === 0) {
            transferContainer.innerHTML = `<span class="text-red-500 font-black uppercase flex items-center gap-2"><i class="fa-solid fa-triangle-exclamation animate-bounce"></i> Sin stock disponible en otras sedes para cubrir faltante de ${deficit} und(s).</span>`;
            transferContainer.classList.remove('hidden');
            qtyInput.classList.add('border-red-300', 'bg-red-50/30');
        } else {
            qtyInput.classList.remove('border-red-300', 'bg-red-50/30');
            
            let selectOptions = '';
            branchesWithStock.forEach(br => {
                selectOptions += `<option value="${br.id}" data-stock="${br.stock}" ${br.stock >= deficit ? 'selected' : ''}>${br.name.replace(/Sede\s+Zona\s+|Sede\s+/i, '')} (Stock: ${br.stock})</option>`;
            });

            transferContainer.innerHTML = `
                <div class="flex flex-col gap-0.5 max-w-[50%]">
                    <span class="text-brand-orange font-black uppercase flex items-center gap-1"><i class="fa-solid fa-truck-ramp-box mr-1"></i> Faltante: ${deficit} und(s) en ${activeBranchName.replace(/Sede\s+/i, '')}</span>
                    <span class="text-gray-400 font-bold text-[8px] uppercase">Solicitud de traslado automática desde:</span>
                </div>
                <div class="flex items-center gap-2 grow justify-end">
                    <select class="p-transfer-source-select text-[9px] font-black uppercase tracking-wider bg-white border border-brand-orange/20 rounded-lg px-2 py-1.5 outline-none focus:border-brand-orange text-brand-black shadow-sm">
                        ${selectOptions}
                    </select>
                    <span class="text-brand-orange font-bold uppercase text-[9px]">Cant:</span>
                    <input type="number" min="1" max="${deficit}" value="${deficit}" class="p-transfer-qty w-12 text-center text-[9px] font-black bg-white border border-brand-orange/20 rounded-lg py-1 shadow-sm outline-none focus:border-brand-orange">
                </div>
            `;
            transferContainer.classList.remove('hidden');

            const trSelect = transferContainer.querySelector('.p-transfer-source-select');
            const trQtyInput = transferContainer.querySelector('.p-transfer-qty');

            const updateTrQtyLimits = () => {
                const opt = trSelect.options[trSelect.selectedIndex];
                if (!opt) return;
                const maxBranchStock = parseInt(opt.dataset.stock) || 0;
                // El máximo a solicitar de esta sede es el menor entre el stock de esa sede y la cantidad pedida
                const maxLimit = Math.min(maxBranchStock, currentQty);
                trQtyInput.max = maxLimit;
                if (parseInt(trQtyInput.value) > maxLimit) trQtyInput.value = maxLimit;
            };

            trSelect.onchange = updateTrQtyLimits;
            trQtyInput.oninput = () => {
                let val = parseInt(trQtyInput.value) || 1;
                const opt = trSelect.options[trSelect.selectedIndex];
                const maxBranchStock = opt ? (parseInt(opt.dataset.stock) || 0) : currentQty;
                const maxLimit = Math.min(maxBranchStock, currentQty);
                if (val < 1) trQtyInput.value = 1;
                if (val > maxLimit) trQtyInput.value = maxLimit;
            };

            updateTrQtyLimits();
        }
    } else {
        if (transferContainer) transferContainer.classList.add('hidden');
        qtyInput.classList.remove('border-red-300', 'bg-red-50/30');
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
            if(opt && opt.dataset.price) row.querySelector('.p-price-display').value = formatCurrency(parseFloat(opt.dataset.price));
            updateRowStock(row, product);
            calculateManualTotal();
        };
        wrap.appendChild(sel); container.appendChild(wrap);
    }
    updateRowStock(row, product);
}

// 🔥 CÁLCULO TOTAL CON 4X1000
function calculateManualTotal() {
    let subtotal = 0;
    document.querySelectorAll('.item-row-container').forEach(row => {
        const price = parseCurrency(row.querySelector('.p-price-display').value);
        const qty = parseInt(row.querySelector('.p-qty').value) || 0;
        subtotal += price * qty;
    });
    
    const shipping = parseCurrency(document.getElementById('m-shipping-cost').value);
    let baseTotal = subtotal + shipping;
    
    let tax4x1000 = 0;
    const apply4x1000 = document.getElementById('m-apply-4x1000').checked;
    if (apply4x1000) {
        tax4x1000 = Math.round(baseTotal * 0.004); // 0.4%
    }
    
    const total = baseTotal + tax4x1000;
    
    const display = document.getElementById('manual-total-display');
    if (tax4x1000 > 0) {
        display.innerHTML = `${formatCurrency(total)} <span class="block text-[12px] font-bold text-purple-500 mt-2 tracking-widest">+ ${formatCurrency(tax4x1000)} (Impuesto 4x1000)</span>`;
    } else {
        display.textContent = formatCurrency(total);
    }

    // Auto-update amount of the single payment split row to match total if there is only 1 row
    const splitRows = document.querySelectorAll('.m-pay-split-row');
    if (splitRows.length === 1) {
        const input = splitRows[0].querySelector('.m-pay-split-amount');
        if (input) {
            input.value = formatCurrency(total);
        }
    }
    recalculateManualPaySplits();
}

async function setupCustomerSearch() {
    const search = document.getElementById('m-cust-search');
    const results = document.getElementById('m-cust-results');
    
    const searchSection = document.getElementById('m-search-section');
    const selectedSection = document.getElementById('m-selected-client-section');
    const newClientSection = document.getElementById('m-new-client-section');
    
    const modeSelect = document.getElementById('m-shipping-mode');
    const optSaved = document.getElementById('opt-saved-addr');
    const savedSelect = document.getElementById('m-saved-addr-select');

    search.addEventListener('input', (e) => {
        const term = normalizeText(e.target.value);
        results.innerHTML = "";
        
        if (term.length < 2) { results.classList.add('hidden'); return; }
        
        const filtered = manualClientsCache.filter(u => {
            const clientNameRaw = u.name || u.userName || "";
            const clientPhoneRaw = u.phone || "";
            const clientDocRaw = u.document || "";
            return normalizeText(clientNameRaw).includes(term) || clientPhoneRaw.includes(term) || clientDocRaw.includes(term);
        });

        if (filtered.length === 0) {
            results.innerHTML = `<div class="p-4 text-[10px] text-gray-400 font-bold text-center uppercase border-b border-gray-100">Cliente no encontrado</div><div class="p-2 bg-gray-50 rounded-b-2xl"><button type="button" id="btn-m-inline-create" class="w-full bg-brand-orange text-brand-black font-black text-[10px] py-3 rounded-xl uppercase tracking-widest hover:bg-orange-400 transition shadow-sm flex items-center justify-center gap-2"><i class="fa-solid fa-user-plus"></i> Registrar Nuevo Cliente</button></div>`;
            document.getElementById('btn-m-inline-create').onmousedown = (ev) => {
                ev.preventDefault(); 
                isCreatingNewClient = true;
                searchSection.classList.add('hidden'); newClientSection.classList.remove('hidden');
                
                const rawTerm = search.value.trim();
                if (/^[\d\s\+]+$/.test(rawTerm)) {
                    document.getElementById('m-nc-phone').value = rawTerm.replace(/\s+/g, '');
                    document.getElementById('m-nc-name').focus();
                } else {
                    document.getElementById('m-nc-name').value = rawTerm;
                    document.getElementById('m-nc-phone').focus();
                }
                
                optSaved.disabled = true; optSaved.textContent = "🏠 Dirección Guardada (Seleccione Cliente)";
                modeSelect.value = 'new'; modeSelect.dispatchEvent(new Event('change'));
                results.classList.add('hidden');
            };
        } else {
            filtered.slice(0, 8).forEach(u => {
                const div = document.createElement('div');
                div.className = "p-3 hover:bg-orange-50 cursor-pointer rounded-xl transition flex justify-between items-center border-b border-gray-50 last:border-0 group";
                const displayName = u.name || u.userName || 'Cliente sin nombre';
                div.innerHTML = `<div><span class="block font-black text-xs uppercase text-brand-black">${displayName}</span><span class="text-[9px] font-bold text-gray-400">${u.phone || 'Sin teléfono'} ${u.document ? ` | Doc: ${u.document}` : ''}</span></div><button class="bg-white border border-gray-200 text-brand-orange w-6 h-6 rounded-full flex items-center justify-center group-hover:bg-brand-orange group-hover:text-white transition shadow-sm"><i class="fa-solid fa-check text-[10px]"></i></button>`;
                
                div.onmousedown = (ev) => {
                    ev.preventDefault(); 
                    isCreatingNewClient = false; selectedUserId = u.id; selectedUserName = displayName;
                    selectedUserPhone = u.phone || ""; selectedUserDoc = u.document || ""; 
                    currentUserAddresses = u.addresses || [];
                    
                    searchSection.classList.add('hidden'); selectedSection.classList.remove('hidden');
                    document.getElementById('m-sel-cname').textContent = selectedUserName;
                    document.getElementById('m-sel-cphone').textContent = selectedUserPhone || "Sin Teléfono";
                    
                    if (currentUserAddresses.length > 0) {
                        optSaved.disabled = false; optSaved.textContent = `🏠 Usar Guardada (${currentUserAddresses.length})`;
                        savedSelect.innerHTML = '<option value="">Seleccione Dirección...</option>';
                        currentUserAddresses.forEach((a, i) => savedSelect.innerHTML += `<option value="${i}">${a.alias} - ${a.address}</option>`);
                        modeSelect.value = 'saved';
                    } else {
                        optSaved.disabled = true; optSaved.textContent = "🏠 Sin direcciones guardadas";
                        modeSelect.value = 'new';
                    }
                    modeSelect.dispatchEvent(new Event('change')); results.classList.add('hidden');
                };
                results.appendChild(div);
            });
        }
        results.classList.remove('hidden');
    });

    const resetClientUI = () => {
        isCreatingNewClient = false; selectedUserId = null; selectedUserName = ""; selectedUserPhone = ""; selectedUserDoc = ""; currentUserAddresses = [];
        search.value = ""; document.getElementById('m-nc-name').value = ""; document.getElementById('m-nc-phone').value = ""; document.getElementById('m-nc-doc').value = ""; document.getElementById('m-nc-email').value = "";
        
        searchSection.classList.remove('hidden'); selectedSection.classList.add('hidden'); newClientSection.classList.add('hidden'); results.classList.add('hidden'); search.focus();
        
        optSaved.disabled = true; optSaved.textContent = "🏠 Dirección Guardada (Seleccione Cliente)";
        modeSelect.value = 'new'; modeSelect.dispatchEvent(new Event('change'));
    };

    document.getElementById('btn-clear-client').onclick = resetClientUI;
    document.getElementById('btn-cancel-new-client').onclick = resetClientUI;

    document.addEventListener('click', (e) => {
        if (!search.contains(e.target) && !results.contains(e.target)) results.classList.add('hidden');
    });
}

let manualAccountsList = [];
function loadPaymentAccounts() {
    if (window._manualAccountsSubscribed) return;
    window._manualAccountsSubscribed = true;

    AdminStore.subscribeToAccounts((accs) => {
        manualAccountsList = accs;
        
        // Repintar el primer split row para que tenga las cuentas cargadas
        const splitsContainer = document.getElementById('m-pay-splits-container');
        if (splitsContainer && splitsContainer.children.length === 0) {
            resetPaymentSplits();
        } else if (splitsContainer) {
            // Si ya hay filas, actualizar los selectores de cuentas existentes
            document.querySelectorAll('.m-pay-split-row').forEach(row => {
                const select = row.querySelector('.m-pay-split-account');
                if (select) {
                    const currentVal = select.value;
                    const activeBranchId = sessionStorage.getItem('activeBranchId') || 'bodega';
                    let optionsHtml = '<option value="credit">⏳ Cartera (Pendiente de Cobro)</option>';
                    manualAccountsList.forEach(acc => {
                        const accBranchId = acc.branchId || 'ALL';
                        if (accBranchId === 'ALL' || accBranchId === activeBranchId) {
                            optionsHtml += `<option value="${acc.id}">🏦 ${acc.name}</option>`;
                        }
                    });
                    select.innerHTML = optionsHtml;
                    select.value = currentVal || 'credit';
                }
            });
        }
    });
}

function resetPaymentSplits() {
    const container = document.getElementById('m-pay-splits-container');
    if (container) container.innerHTML = '';
    addManualPaySplitRow(0);
}

function getManualSaleTotal() {
    let subtotal = 0;
    document.querySelectorAll('.item-row-container').forEach(row => {
        const price = parseCurrency(row.querySelector('.p-price-display').value);
        const qty = parseInt(row.querySelector('.p-qty').value) || 0;
        subtotal += price * qty;
    });
    
    const shipping = parseCurrency(document.getElementById('m-shipping-cost').value);
    let baseTotal = subtotal + shipping;
    
    let tax4x1000 = 0;
    const apply4x1000 = document.getElementById('m-apply-4x1000').checked;
    if (apply4x1000) {
        tax4x1000 = Math.round(baseTotal * 0.004);
    }
    
    return baseTotal + tax4x1000;
}

function getManualRemainingBalance() {
    const total = getManualSaleTotal();
    let splitTotal = 0;
    document.querySelectorAll('.m-pay-split-row').forEach(row => {
        const val = parseCurrency(row.querySelector('.m-pay-split-amount').value);
        splitTotal += val;
    });
    return Math.max(0, total - splitTotal);
}

function addManualPaySplitRow(defaultAmount = 0) {
    const container = document.getElementById('m-pay-splits-container');
    if (!container) return;

    const row = document.createElement('div');
    row.className = "m-pay-split-row flex gap-3 items-center w-full animate-in fade-in slide-in-from-top-1 duration-200";

    const activeBranchId = sessionStorage.getItem('activeBranchId') || 'bodega';
    
    let optionsHtml = '<option value="credit">⏳ Cartera (Pendiente de Cobro)</option>';
    manualAccountsList.forEach(acc => {
        const accBranchId = acc.branchId || 'ALL';
        if (accBranchId === 'ALL' || accBranchId === activeBranchId) {
            optionsHtml += `<option value="${acc.id}">🏦 ${acc.name}</option>`;
        }
    });

    row.innerHTML = `
        <div class="relative flex-1">
            <select class="m-pay-split-account w-full h-11 bg-slate-50 border border-gray-100 px-4 rounded-xl text-xs font-bold outline-none focus:border-brand-orange appearance-none cursor-pointer text-brand-black shadow-sm">
                ${optionsHtml}
            </select>
            <i class="fa-solid fa-chevron-down absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"></i>
        </div>
        <div class="relative w-48 sm:w-56 shrink-0">
            <input type="text" class="m-pay-split-amount w-full h-11 bg-slate-50 border border-gray-100 px-4 rounded-xl text-xs font-black text-right outline-none focus:border-brand-orange text-brand-black shadow-sm" placeholder="$ 0" value="${defaultAmount > 0 ? '$ ' + defaultAmount.toLocaleString('es-CO') : ''}">
        </div>
        <button type="button" class="btn-m-remove-pay-split w-11 h-11 rounded-xl bg-red-50 hover:bg-red-100 text-red-500 transition flex items-center justify-center border border-red-100 shrink-0 shadow-sm">
            <i class="fa-solid fa-trash-can"></i>
        </button>
    `;

    container.appendChild(row);

    const amountInput = row.querySelector('.m-pay-split-amount');
    amountInput.addEventListener('input', (e) => {
        let val = parseCurrency(e.target.value);
        e.target.value = val ? "$ " + val.toLocaleString('es-CO') : "";
        recalculateManualPaySplits();
    });
    amountInput.addEventListener('focus', (e) => e.target.select());

    const removeBtn = row.querySelector('.btn-m-remove-pay-split');
    removeBtn.addEventListener('click', () => {
        if (document.querySelectorAll('.m-pay-split-row').length > 1) {
            row.remove();
            recalculateManualPaySplits();
        } else {
            alert("Debe haber al menos un método de pago.");
        }
    });

    recalculateManualPaySplits();
}

function recalculateManualPaySplits() {
    const total = getManualSaleTotal();
    let splitTotal = 0;
    
    document.querySelectorAll('.m-pay-split-row').forEach(row => {
        const val = parseCurrency(row.querySelector('.m-pay-split-amount').value);
        splitTotal += val;
    });

    const summaryEl = document.getElementById('m-pay-splits-summary');
    const sumEl = document.getElementById('m-pay-split-sum');
    const remainingEl = document.getElementById('m-pay-split-remaining');
    const splitRows = document.querySelectorAll('.m-pay-split-row');

    if (!summaryEl || !sumEl || !remainingEl) return;

    if (splitRows.length > 1) {
        summaryEl.classList.remove('hidden');
        sumEl.textContent = formatCurrency(splitTotal);

        const diff = total - splitTotal;
        
        // Reset classes
        summaryEl.className = "p-4 rounded-2xl border flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 transition-all duration-300";
        sumEl.className = "font-black";
        remainingEl.className = "font-black";

        if (diff === 0) {
            summaryEl.classList.add('bg-emerald-50/40', 'border-emerald-200/60', 'text-emerald-700');
            sumEl.classList.add('text-emerald-800');
            remainingEl.textContent = "✓ PAGO COMPLETO";
            remainingEl.className = "font-black text-emerald-800";
        } else if (diff > 0) {
            summaryEl.classList.add('bg-amber-50/40', 'border-amber-200/60', 'text-amber-700');
            sumEl.classList.add('text-amber-800');
            remainingEl.textContent = `FALTAN ${formatCurrency(diff)}`;
            remainingEl.className = "font-black text-brand-orange";
        } else {
            summaryEl.classList.add('bg-rose-50/40', 'border-rose-200/60', 'text-rose-700');
            sumEl.classList.add('text-rose-800');
            remainingEl.textContent = `SOBRAN ${formatCurrency(Math.abs(diff))}`;
            remainingEl.className = "font-black text-rose-800";
        }
    } else {
        summaryEl.classList.add('hidden');
    }
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

// --- GUARDAR TRANSACCIÓN ---
let isSavingOrder = false;
async function saveOrder() {
    if (isSavingOrder) return;
    const btn = document.getElementById('btn-save-manual');
    
    if (!selectedUserId && !isCreatingNewClient) { 
        return alert("🚨 Por favor, busca un cliente existente o registra uno nuevo."); 
    }

    const items = [];
    let hasStockError = false;
    
    document.querySelectorAll('.item-row-container').forEach(row => {
        const id = row.querySelector('.p-id').value;
        const qty = parseInt(row.querySelector('.p-qty').value);
        const maxStock = parseInt(row.querySelector('.p-max-stock').value) || 0;
        
        if(id && qty > 0) {
            const colorEl = row.querySelector('.p-color');
            const capEl = row.querySelector('.p-capacity');
            if (colorEl && colorEl.value === "") {
                alert(`🚨 Por favor, selecciona un Color para el producto: ${row.querySelector('.p-search').value}`);
                hasStockError = true;
                return;
            }
            if (capEl && capEl.value === "") {
                alert(`🚨 Por favor, selecciona una Capacidad para el producto: ${row.querySelector('.p-search').value}`);
                hasStockError = true;
                return;
            }

            const transferSelect = row.querySelector('.p-transfer-source-select');
            const sourceBranchId = transferSelect ? transferSelect.value : null;

            const transferQtyEl = row.querySelector('.p-transfer-qty');
            const qtyToTransfer = transferQtyEl ? (parseInt(transferQtyEl.value) || 0) : 0;

            if (qty > maxStock && !sourceBranchId) {
                hasStockError = true;
            }

            items.push({
                id, 
                name: row.querySelector('.p-search').value, 
                price: parseCurrency(row.querySelector('.p-price-display').value),
                quantity: qty, 
                image: row.querySelector('.p-img').value, 
                color: row.querySelector('.p-color')?.value || null, 
                capacity: row.querySelector('.p-capacity')?.value || null,
                maxStock,
                sourceBranchId,
                qtyToTransfer
            });
        }
    });

    if (hasStockError) return alert("🚨 Uno de los productos excede el stock disponible localmente y no se ha seleccionado ninguna sede de origen con inventario para solicitar el traslado.");
    if (items.length === 0) return alert("🚨 Debes agregar al menos un producto a la venta.");

    const shippingMode = document.getElementById('m-shipping-mode').value;
    let shippingData = {};
    let clientDept = ""; let clientCity = ""; let clientAddr = "";
    
    if (shippingMode === 'pickup') { shippingData = { address: "📍 Recogida en Local" }; } 
    else if (shippingMode === 'saved') {
        const idx = document.getElementById('m-saved-addr-select').value;
        if (idx === "") return alert("Seleccione la dirección guardada del cliente");
        const a = currentUserAddresses[idx];
        shippingData = { department: a.dept, city: a.city, address: `${a.address} (${a.alias})` };
    } else {
        const dSelect = document.getElementById('m-dept-manual');
        clientDept = dSelect.options[dSelect.selectedIndex]?.text || "";
        clientCity = document.getElementById('m-city-manual').value || "";
        clientAddr = document.getElementById('m-address-manual').value || "";
        shippingData = { department: clientDept, city: clientCity, address: clientAddr };
        if(!shippingData.department || !shippingData.address) return alert("Faltan datos de la nueva dirección de entrega.");
    }

    isSavingOrder = true;
    const originalText = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Procesando Venta...';

    try {
        const activeBranchId = sessionStorage.getItem('activeBranchId') || 'bodega';
        const activeBranchName = sessionStorage.getItem('activeBranchName') || 'Sede Principal';

        let finalUserId = selectedUserId;
        let custName = selectedUserName;
        let custPhone = selectedUserPhone;
        let custDoc = selectedUserDoc; 
        let emailVal = "";

        if (isCreatingNewClient) {
            custName = document.getElementById('m-nc-name').value.trim();
            custPhone = document.getElementById('m-nc-phone').value.trim();
            custDoc = document.getElementById('m-nc-doc').value.trim(); 
            emailVal = document.getElementById('m-nc-email').value.trim();
            if (!custName || !custPhone) throw new Error("🚨 El Nombre y Teléfono del nuevo cliente son obligatorios.");

            const newClientData = {
                name: custName, phone: custPhone, email: emailVal, document: custDoc, source: 'MANUAL', role: 'client',
                createdAt: new Date(), updatedAt: new Date(), dept: clientDept, city: clientCity, address: clientAddr,
                addresses: clientAddr ? [{ alias: "Principal", address: clientAddr, dept: clientDept, city: clientCity, isDefault: true }] : []
            };
            const docRef = await addDoc(collection(db, "users"), newClientData);
            finalUserId = docRef.id;
        }

        // 🔥 LÓGICA DE 4X1000
        const shippingCost = parseCurrency(document.getElementById('m-shipping-cost').value);
        const subtotal = items.reduce((acc, i) => acc + (i.price * i.quantity), 0);
        let baseTotal = subtotal + shippingCost;
        let tax4x1000 = 0;
        
        if (document.getElementById('m-apply-4x1000').checked) {
            tax4x1000 = Math.round(baseTotal * 0.004);
        }
        
        const total = baseTotal + tax4x1000;
        if (total <= 0) throw new Error("El total de la venta no puede ser cero.");

        // Validar splits de pago
        const splits = [];
        let splitTotal = 0;
        let totalPaid = 0;
        let hasCredit = false;

        document.querySelectorAll('.m-pay-split-row').forEach(row => {
            const accId = row.querySelector('.m-pay-split-account').value;
            const amount = parseCurrency(row.querySelector('.m-pay-split-amount').value);
            if (amount > 0) {
                splits.push({ accountId: accId, amount });
                splitTotal += amount;
                if (accId === 'credit') {
                    hasCredit = true;
                } else {
                    totalPaid += amount;
                }
            }
        });

        if (splitTotal !== total) {
            throw new Error(`🚨 La suma de los métodos de pago (${formatCurrency(splitTotal)}) no coincide con el total de la venta (${formatCurrency(total)}).`);
        }

        let paymentStatus = 'PENDING';
        let paymentMethodName = 'Crédito / Cartera';
        let amountPaid = 0;

        const nonCreditSplits = splits.filter(s => s.accountId !== 'credit');
        const paymentSplitsField = splits.map(s => {
            const accName = s.accountId === 'credit' ? 'Cartera (Pendiente de Cobro)' : (manualAccountsList.find(a => a.id === s.accountId)?.name || 'Desconocido');
            return {
                accountId: s.accountId === 'credit' ? null : s.accountId,
                accountName: accName,
                amount: s.amount
            };
        });

        if (nonCreditSplits.length > 0) {
            await runTransaction(db, async (t) => {
                const accountData = [];
                for (const split of nonCreditSplits) {
                    const ref = doc(db, "accounts", split.accountId);
                    const snap = await t.get(ref);
                    if (!snap.exists()) throw new Error(`La cuenta seleccionada ya no existe.`);
                    accountData.push({ ref, snap, split });
                }

                for (const ad of accountData) {
                    const currentBalance = ad.snap.data().balance || 0;
                    t.update(ad.ref, { balance: currentBalance + ad.split.amount });
                }
            });

            for (const split of nonCreditSplits) {
                const accName = manualAccountsList.find(a => a.id === split.accountId)?.name || 'Cuenta Desconocida';
                await addDoc(collection(db, "expenses"), {
                    amount: split.amount,
                    category: "Ingreso Ventas Manual",
                    description: `Cobro Inmediato (Dividido) - Venta a ${custName || 'Cliente'}`,
                    paymentMethod: accName,
                    supplierName: custName || "Cliente Directo",
                    date: new Date(),
                    createdAt: new Date(),
                    type: 'INCOME'
                });
            }

            amountPaid = totalPaid;
            if (hasCredit) {
                paymentStatus = 'PARTIAL';
                paymentMethodName = 'Múltiples Cuentas';
            } else {
                paymentStatus = 'PAID';
                paymentMethodName = nonCreditSplits.length > 1 ? 'Múltiples Cuentas' : manualAccountsList.find(a => a.id === nonCreditSplits[0].accountId)?.name || 'Efectivo';
            }
        }

        const orderData = {
            userId: finalUserId, userName: custName, phone: custPhone, clientDoc: custDoc, 
            items, 
            subtotal, shippingCost, tax4x1000, total, // 🔥 SE GUARDA EL 4x1000
            status: 'PENDIENTE', source: 'MANUAL', requiresInvoice: document.getElementById('m-requires-invoice').checked,
            paymentStatus, amountPaid, paymentAccountId: nonCreditSplits.length > 0 ? nonCreditSplits[0].accountId : null, paymentMethodName,
            paymentSplits: paymentSplitsField,
            createdAt: new Date(), updatedAt: new Date(), shippingData, buyerInfo: { name: custName, email: emailVal || "", phone: custPhone, document: custDoc },
            branchId: activeBranchId,
            branchName: activeBranchName
        };
        
        const orderRef = await addDoc(collection(db, "orders"), orderData);
        await setDoc(doc(db, "remissions", orderRef.id), { ...orderData, orderId: orderRef.id, status: 'PENDIENTE_ALISTAMIENTO', type: 'DIRECTA' });

        // --- DESCONTAR INVENTARIO LOCAL Y CREAR TRASLADOS AUTOMÁTICOS ---
        for (const item of items) {
            const qtyToTransfer = item.qtyToTransfer || 0;

            if (qtyToTransfer === 0) {
                // Hay stock suficiente localmente
                await adjustStock(item.id, -item.quantity, item.color, item.capacity, activeBranchId);
            } else {
                // Hay déficit: descontar lo disponible en la sede activa si es mayor a cero
                const localDeduction = item.quantity - qtyToTransfer;
                if (localDeduction > 0) {
                    await adjustStock(item.id, -localDeduction, item.color, item.capacity, activeBranchId);
                }
                
                // Reservar el excedente en la sede origen elegida y registrar solicitud de traslado
                const sourceBranchId = item.sourceBranchId;
                const srcBr = manualBranchesList.find(b => b.id === sourceBranchId);
                const sourceBranchName = srcBr ? srcBr.name : sourceBranchId;

                // Descontar del origen (reservar)
                await adjustStock(item.id, -qtyToTransfer, item.color, item.capacity, sourceBranchId);

                // Crear solicitud de traslado
                await addDoc(collection(db, "transfers"), {
                    productId: item.id,
                    productName: item.name,
                    color: item.color,
                    capacity: item.capacity,
                    quantity: qtyToTransfer,
                    sourceBranchId: sourceBranchId,
                    sourceBranchName: sourceBranchName,
                    targetBranchId: activeBranchId,
                    targetBranchName: activeBranchName,
                    status: 'PENDING',
                    requestedBy: 'Traslado Automático por Venta Manual - ' + (auth.currentUser ? auth.currentUser.email : 'Sistema'),
                    requestedAt: new Date(),
                    resolvedBy: null,
                    resolvedAt: null,
                    associatedOrderId: orderRef.id
                });
            }
        }

        alert(`✅ Venta Exitosa.\nLa orden #${orderRef.id.slice(0,6)} ha sido enviada al centro logístico y se registraron las solicitudes de traslado correspondientes.`);
        document.getElementById('manual-modal').classList.add('hidden');
        if (onSuccessCallback) onSuccessCallback();

    } catch (e) {
        console.error(e); alert(e.message);
    } finally {
        isSavingOrder = false;
        btn.disabled = false; btn.innerHTML = originalText;
    }
}
