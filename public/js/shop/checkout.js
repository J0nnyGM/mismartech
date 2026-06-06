import { auth, db, doc, updateDoc, onSnapshot, arrayUnion, functions, httpsCallable, onAuthStateChanged, collection, query, where, documentId, getDocs } from "../firebase-init.js";
import { getCart, getCartTotal, updateCartCount } from "./cart.js";

// --- CONFIGURACIÓN DE LLAVES DEL ENTORNO MAESTRO SMARTECH ---
const CART_KEY = 'smartech_cart';
const PROFILE_KEY = 'smartech_user_profile';
const ADDRESSES_KEY = 'smartech_user_addresses';
const SHIPPING_CONFIG_KEY = 'mismartech_shipping_config';

// --- REFERENCIAS DOM ---
const els = {
    form: document.getElementById('checkout-form'),
    itemsContainer: document.getElementById('checkout-items'),
    subtotal: document.getElementById('check-subtotal'),
    shippingCost: document.getElementById('check-shipping'),
    total: document.getElementById('check-total'),
    freeShippingMsg: document.getElementById('free-shipping-msg'),
    dispatchMsg: document.getElementById('checkout-dispatch-msg'), 
    btnSubmit: document.getElementById('btn-complete-order'),
    
    // Inputs Envío
    savedAddrSelect: document.getElementById('saved-addresses-select'),
    idNumber: document.getElementById('cust-id-number'),
    name: document.getElementById('cust-name'),
    phone: document.getElementById('cust-phone'),
    address: document.getElementById('cust-address'),
    postal: document.getElementById('cust-postal'),
    deptSelect: document.getElementById('shipping-dept'),
    citySelect: document.getElementById('shipping-city'),
    notes: document.getElementById('cust-notes'),
    saveAddrCheck: document.getElementById('save-address-check'),

    // DOM Pagos
    codInput: document.getElementById('payment-cod'),
    codContainer: document.getElementById('cod-container'),
    codWarning: document.getElementById('cod-warning'),
    onlineInput: document.getElementById('payment-online'),

    // Facturación Empresa
    checkInvoice: document.getElementById('check-need-invoice'),
    billingForm: document.getElementById('billing-form-checkout'),
    billInputs: {
        name: document.getElementById('bill-name'),
        taxId: document.getElementById('bill-taxid'),
        address: document.getElementById('bill-address'),
        city: document.getElementById('bill-city'),
        email: document.getElementById('bill-email'),
        phone: document.getElementById('bill-phone')
    },

    // NUEVO: Cupones Promocionales
    promoCodeInput: document.getElementById('promo-code-input'),
    btnApplyPromo: document.getElementById('btn-apply-promo'),
    appliedPromosContainer: document.getElementById('applied-promos-container'),
    discountRow: document.getElementById('discount-row'),
    discountAmount: document.getElementById('check-discount')
};

let currentUser = null;
let userProfileData = null;
let cart = getCart().filter(item => item.maxStock === undefined || item.maxStock > 0);

let shippingConfig = { freeThreshold: 0, defaultPrice: 0, groups: [] };
let currentShippingCost = 0;
let selectedPaymentMethod = 'MANUAL';
let colombianHolidays = [];

let unsubscribeShipping = null;
let unsubscribeUser = null;

// Helper de Alertas Visuales Premium (Toasts)
function showAlert(message, type = 'error') {
    if (window.showToast) {
        window.showToast(message, type);
    } else {
        alert(message);
    }
}

// NUEVO: Estado de Cupones
let appliedPromoCodes = [];
let appliedPromosDetails = [];
let currentDiscountAmount = 0;

// Escuchar actualizaciones del carrito
window.addEventListener('cartUpdated', () => {
    cart = getCart().filter(item => item.maxStock === undefined || item.maxStock > 0);
    if (cart.length === 0 && currentUser) {
        showAlert("Tu carrito no tiene productos disponibles para comprar.");
        window.location.href = '/shop/cart.html';
        return;
    }
    renderOrderSummary();
    calculateShipping();
});

// --- 1. CONFIGURACIÓN INICIAL ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        if (cart.length === 0) {
            showAlert("Tu carrito no tiene productos disponibles para comprar.");
            window.location.href = '/shop/cart.html';
            return;
        }
        currentUser = user;
        
        await loadDepartments(); 
        await loadHolidays();    
        
        initShippingRealtimeSync();
        initUserRealtimeSync(user.uid);
        
        renderOrderSummary();
        setupPaymentListeners(); 
        validatePaymentMethods(); 
    } else {
        if(unsubscribeShipping) unsubscribeShipping();
        if(unsubscribeUser) unsubscribeUser();
        sessionStorage.setItem('redirect_after_login', '/shop/checkout.html');
        window.location.href = '/auth/login.html';
    }
});

// --- 2. GESTOR TRANSACCIONAL DE MÉTODOS DE PAGO ---
function setupPaymentListeners() {
    const radios = document.querySelectorAll('input[name="payment_method"]');
    radios.forEach(r => {
        r.addEventListener('change', (e) => {
            selectedPaymentMethod = e.target.value;
            updateSubmitButtonText();
            validateAndRenderPromos();
        });
    });
}

// ✅ CORRECCIÓN COBERTURA: La Contraentrega ahora opera para Medellín, Bogotá, Cali, Barranquilla, Bello, Itagüí, Sabaneta y Copacabana
function validatePaymentMethods() {
    const city = els.citySelect.value || "";
    
    // Normalizar texto para ignorar acentos/tildes y mayúsculas/minúsculas
    const cleanCity = city.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    
    // Ciudades permitidas para Contra Entrega
    const allowedCities = ['medellin', 'bogota', 'cali', 'barranquilla', 'bello', 'itagui', 'sabaneta', 'copacabana'];
    const isAllowed = allowedCities.some(allowed => cleanCity.includes(allowed));

    if (isAllowed) {
        els.codInput.disabled = false;
        els.codContainer.classList.remove('payment-disabled');
        els.codWarning.classList.add('hidden');
    } else {
        els.codInput.disabled = true;
        els.codContainer.classList.add('payment-disabled');
        if (els.codWarning) {
            els.codWarning.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Servicio Contra Entrega disponible únicamente para Medellín (y Área Metropolitana), Bogotá, Cali y Barranquilla.`;
        }
        els.codWarning.classList.remove('hidden');

        if (els.codInput.checked) {
            const manualRadio = document.getElementById('payment-manual');
            if (manualRadio) manualRadio.checked = true;
            selectedPaymentMethod = 'MANUAL';
            updateSubmitButtonText();
            validateAndRenderPromos();
        }
    }
}

function updateSubmitButtonText() {
    const btn = els.btnSubmit;
    btn.className = "w-full mt-10 font-black py-5 rounded-2xl transition-all duration-300 uppercase text-xs tracking-[0.2em] flex items-center justify-center gap-3 cursor-pointer hover:shadow-lg";

    if (selectedPaymentMethod === 'MANUAL') {
        btn.innerHTML = `Confirmar Transferencia Manual <i class="fa-solid fa-building-columns"></i>`;
        btn.classList.add('bg-brand-orange', 'text-white', 'hover:bg-orange-600', 'active:scale-95');
    }
    else if (selectedPaymentMethod === 'COD') {
        btn.innerHTML = `Confirmar Contra Entrega <i class="fa-solid fa-truck-fast"></i>`;
        btn.classList.add('bg-brand-orange', 'text-white', 'hover:bg-orange-600', 'active:scale-95');
    } 
    else if (selectedPaymentMethod === 'ONLINE' || selectedPaymentMethod === 'PSE') {
        btn.innerHTML = `Ir a Pagar con MercadoPago <i class="fa-solid fa-lock"></i>`;
        btn.classList.add('bg-blue-600', 'text-white', 'hover:bg-blue-700', 'active:scale-95');
    } 
    else if (selectedPaymentMethod === 'ADDI') {
        btn.innerHTML = `Pagar con ADDI <i class="fa-solid fa-arrow-right"></i>`;
        btn.classList.add('bg-[#00D6D6]', 'text-brand-black', 'hover:bg-[#00baba]', 'active:scale-95');
    }
    else if (selectedPaymentMethod === 'SISTECREDITO') {
        btn.innerHTML = `Pagar con Sistecrédito <i class="fa-solid fa-arrow-right"></i>`;
        btn.classList.add('bg-[#00B34A]', 'text-white', 'hover:bg-[#009e41]', 'active:scale-95');
    }

    checkDispatchTime(shippingConfig.cutoffTime || "14:00");
}

// --- 3. SYNC EN TIEMPO REAL CLOUD ---
function initShippingRealtimeSync() {
    const cachedConfig = sessionStorage.getItem(SHIPPING_CONFIG_KEY);
    if (cachedConfig) {
        shippingConfig = JSON.parse(cachedConfig);
        checkDispatchTime(shippingConfig.cutoffTime || "14:00");
        calculateShipping(); 
    }

    if (unsubscribeShipping) unsubscribeShipping();

    unsubscribeShipping = onSnapshot(doc(db, "config", "shipping"), (snap) => {
        if (snap.exists()) {
            const freshConfig = snap.data();
            if (JSON.stringify(shippingConfig) !== JSON.stringify(freshConfig)) {
                shippingConfig = freshConfig;
                sessionStorage.setItem(SHIPPING_CONFIG_KEY, JSON.stringify(shippingConfig));
                checkDispatchTime(shippingConfig.cutoffTime || "14:00");
                calculateShipping(); 
            }
        }
    }, (e) => console.error("SmartSync Shipping error:", e));
}

function initUserRealtimeSync(uid) {
    const cachedProfile = sessionStorage.getItem(PROFILE_KEY);
    const cachedAddr = sessionStorage.getItem(ADDRESSES_KEY);

    if (cachedProfile && cachedAddr) {
        const profile = JSON.parse(cachedProfile);
        const addresses = JSON.parse(cachedAddr);
        userProfileData = { ...profile, addresses: addresses };
        populateUserForm();
    }

    if (unsubscribeUser) unsubscribeUser();

    unsubscribeUser = onSnapshot(doc(db, "users", uid), (snap) => {
        if (snap.exists()) {
            const freshData = snap.data();
            if (JSON.stringify(userProfileData) !== JSON.stringify(freshData)) {
                userProfileData = freshData;
                const { addresses, ...profileData } = userProfileData;
                sessionStorage.setItem(PROFILE_KEY, JSON.stringify(profileData));
                sessionStorage.setItem(ADDRESSES_KEY, JSON.stringify(addresses || []));
                populateUserForm();
            }
        }
    }, (e) => console.error("SmartSync User error:", e));
}

function populateUserForm() {
    if (!els.idNumber.value && document.activeElement !== els.idNumber) els.idNumber.value = userProfileData.document || ""; 
    if (!els.name.value && document.activeElement !== els.name) els.name.value = userProfileData.name || currentUser.displayName || "";
    if (!els.phone.value && document.activeElement !== els.phone) els.phone.value = userProfileData.phone || userProfileData.contactPhone || "";

    const addresses = userProfileData.addresses || [];
    const currentSelection = els.savedAddrSelect.value;
    els.savedAddrSelect.innerHTML = '<option value="">-- Mis Direcciones Guardadas --</option>';
    
    let defaultIndex = -1;
    addresses.forEach((addr, idx) => {
        const opt = document.createElement('option');
        opt.value = idx;
        opt.textContent = `${addr.alias} (${addr.city}) ${addr.isDefault ? '★' : ''}`;
        els.savedAddrSelect.appendChild(opt);
        if (addr.isDefault) defaultIndex = idx;
    });

    if (currentSelection !== "") {
        els.savedAddrSelect.value = currentSelection;
    } else if (defaultIndex >= 0) {
        els.savedAddrSelect.value = defaultIndex;
        if (!els.address.value) fillFormWithData(addresses[defaultIndex]);
    } 
}

// --- 4. RELOJ LOGÍSTICO COMPLETO ---
function checkDispatchTime(cutoffTimeStr) {
    if(!els.dispatchMsg) return;
    
    const now = new Date();
    const dayOfWeek = now.getDay(); 
    const [hours, minutes] = cutoffTimeStr.split(':').map(Number);
    
    let cutoffDate = new Date();
    cutoffDate.setHours(hours, minutes, 0, 0);

    const formatDateStr = (dateObj) => {
        const offset = dateObj.getTimezoneOffset() * 60000;
        return new Date(dateObj.getTime() - offset).toISOString().split('T')[0];
    };

    const todayStr = formatDateStr(now);
    const isTodayHoliday = colombianHolidays.includes(todayStr);

    if (selectedPaymentMethod === 'SISTECREDITO') {
        cutoffDate.setHours(cutoffDate.getHours() - 6);
    }

    let isBeforeCutoff = now < cutoffDate;

    if (dayOfWeek === 0 || isTodayHoliday) {
        isBeforeCutoff = false;
    }

    els.dispatchMsg.classList.remove('hidden');

    if (isBeforeCutoff) {
        const diffHrs = Math.floor((cutoffDate - now) / 3600000);
        const diffMins = Math.floor(((cutoffDate - now) % 3600000) / 60000);
        
        let timeText = "";
        if(diffHrs > 0) timeText += `${diffHrs}h `;
        timeText += `${diffMins}m`;
        els.dispatchMsg.innerHTML = `<p class="text-[11px] font-black uppercase text-brand-orange pulse-text"><i class="fa-solid fa-bolt text-yellow-500 mr-1"></i> Despachamos HOY si pides en <span class="underline">${timeText}</span></p>`;
    } else {
        let nextDay = new Date(now);
        nextDay.setDate(nextDay.getDate() + 1);

        while (nextDay.getDay() === 0 || colombianHolidays.includes(formatDateStr(nextDay))) {
            nextDay.setDate(nextDay.getDate() + 1); 
        }

        const diasSemana = ['el DOMINGO', 'el LUNES', 'el MARTES', 'el MIÉRCOLES', 'el JUEVES', 'el VIERNES', 'el SÁBADO'];
        let dispatchDayText = diasSemana[nextDay.getDay()];
        
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        if (formatDateStr(nextDay) === formatDateStr(tomorrow)) {
            dispatchDayText = "MAÑANA";
        }

        els.dispatchMsg.innerHTML = `<p class="text-[11px] font-black uppercase text-gray-500"><i class="fa-solid fa-calendar-check mr-1"></i> Tu pedido será entregado al operador ${dispatchDayText}</p>`;
    }
}

async function loadDepartments() {
    try {
        const res = await fetch('https://api-colombia.com/api/v1/Department');
        const depts = await res.json();
        depts.sort((a, b) => a.name.localeCompare(b.name));
        els.deptSelect.innerHTML = '<option value="">Seleccione...</option>';
        depts.forEach(d => {
            const opt = document.createElement('option');
            opt.value = d.id; 
            opt.textContent = d.name;
            opt.dataset.name = d.name; 
            els.deptSelect.appendChild(opt);
        });
    } catch (e) { console.error("API Dept Error:", e); }
}

async function loadHolidays() {
    try {
        const year = new Date().getFullYear();
        const res = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/CO`);
        const data = await res.json();
        colombianHolidays = data.map(h => h.date);
    } catch (e) { console.error("Error cargando festivos:", e); }
}

els.savedAddrSelect.addEventListener('change', (e) => {
    const idx = e.target.value;
    if (idx === "") {
        els.form.reset();
        els.name.value = userProfileData.name || "";
        els.phone.value = userProfileData.phone || "";
        els.idNumber.value = userProfileData.document || "";
        validatePaymentMethods(); 
        return;
    }
    const addresses = userProfileData.addresses || [];
    const selectedAddr = addresses[idx];
    if (selectedAddr) fillFormWithData(selectedAddr);
});

async function fillFormWithData(data) {
    els.address.value = data.address || "";
    els.postal.value = data.zip || "";
    els.notes.value = data.notes || "";

    if (data.dept) {
        const deptOptions = Array.from(els.deptSelect.options);
        const foundDeptOpt = deptOptions.find(opt => opt.dataset.name && opt.dataset.name.toLowerCase() === data.dept.toLowerCase());
        
        if (foundDeptOpt) {
            els.deptSelect.value = foundDeptOpt.value;
            await loadCitiesForDept(foundDeptOpt.value);
            
            if (data.city) {
                const cityOptions = Array.from(els.citySelect.options);
                const foundCityOpt = cityOptions.find(opt => opt.textContent.toLowerCase() === data.city.toLowerCase());
                if (foundCityOpt) {
                    els.citySelect.value = foundCityOpt.value;
                    calculateShipping(); 
                }
            }
        }
    }
    validatePaymentMethods(); 
}

els.deptSelect.addEventListener('change', async (e) => {
    await loadCitiesForDept(e.target.value);
    validatePaymentMethods();
});

async function loadCitiesForDept(deptId) {
    els.citySelect.innerHTML = '<option value="">Cargando...</option>';
    els.citySelect.disabled = true;
    if (!deptId) {
        els.citySelect.innerHTML = '<option value="">Seleccione Depto primero</option>';
        calculateShipping(); 
        return;
    }
    try {
        const res = await fetch(`https://api-colombia.com/api/v1/Department/${deptId}/cities`);
        const cities = await res.json();
        cities.sort((a, b) => a.name.localeCompare(b.name));
        els.citySelect.innerHTML = '<option value="">Seleccione Ciudad...</option>';
        cities.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.name;
            opt.textContent = c.name;
            els.citySelect.appendChild(opt);
        });
        els.citySelect.disabled = false;
    } catch (e) { console.error(e); }
}

els.citySelect.addEventListener('change', () => { calculateShipping(); validatePaymentMethods(); });

function calculateShipping() {
    const cartTotal = cart.reduce((acc, item) => acc + (item.price * item.quantity), 0);
    const city = els.citySelect.value;
    const deptOpt = els.deptSelect.options[els.deptSelect.selectedIndex];
    const dept = deptOpt ? deptOpt.dataset.name : "";

    if (!els.shippingCost) return;

    if (!city || !dept) {
        els.shippingCost.textContent = "--";
        toggleSubmitBtn(false);
        return;
    }

    if (shippingConfig.freeThreshold > 0 && cartTotal >= shippingConfig.freeThreshold) {
        currentShippingCost = 0;
        els.freeShippingMsg.classList.remove('hidden');
    } else {
        els.freeShippingMsg.classList.add('hidden');
        let foundPrice = null;
        if (shippingConfig.groups) {
            for (const group of shippingConfig.groups) {
                const match = group.cities.some(c => c.toLowerCase().includes(city.toLowerCase()));
                if (match) { foundPrice = group.price; break; }
            }
        }
        currentShippingCost = (foundPrice !== null) ? foundPrice : shippingConfig.defaultPrice;
    }

    els.shippingCost.textContent = currentShippingCost === 0 ? "GRATIS" : `$${currentShippingCost.toLocaleString('es-CO')}`;
    updateTotalDisplay();
    toggleSubmitBtn(true);
}

function updateTotalDisplay() {
    const cartTotal = cart.reduce((acc, item) => acc + (item.price * item.quantity), 0);
    
    if (appliedPromoCodes.length > 0) {
        validateAndRenderPromos();
        return;
    }
    
    const t = cartTotal + currentShippingCost;
    els.subtotal.textContent = `$${cartTotal.toLocaleString('es-CO')}`;
    els.discountRow.classList.add('hidden');
    els.total.textContent = `$${t.toLocaleString('es-CO')}`;
}

function toggleSubmitBtn(enable) {
    if (enable) {
        els.btnSubmit.disabled = false;
        els.btnSubmit.classList.remove('bg-gray-200', 'text-gray-400', 'cursor-not-allowed');
        updateSubmitButtonText(); 
    } else {
        els.btnSubmit.disabled = true;
        els.btnSubmit.className = "w-full mt-10 bg-gray-200 text-gray-400 font-black py-5 rounded-2xl transition-all duration-300 uppercase text-xs tracking-[0.25em] flex items-center justify-center gap-3 cursor-not-allowed";
        els.btnSubmit.innerHTML = `Confirmar Pedido <div class="w-6 h-6 rounded-full bg-white/50 flex items-center justify-center"><i class="fa-solid fa-check"></i></div>`;
    }
}

els.checkInvoice.addEventListener('change', (e) => {
    if(e.target.checked) {
        els.billingForm.classList.remove('hidden');
    } else {
        els.billingForm.classList.add('hidden');
    }
});

// ✅ FUNCIÓN DE CONTROL: Validador de Precios y Stock de último segundo antes de proceder al pago
async function validateCartBeforePayment() {
    try {
        const currentCart = getCart();
        if (currentCart.length === 0) return { success: true };

        let oosItems = [];
        let priceChanges = [];
        let cartHasChanges = false;
        const uniqueIds = [...new Set(currentCart.map(i => i.id))];
        let productsMap = {};

        for (let i = 0; i < uniqueIds.length; i += 10) {
            const batchIds = uniqueIds.slice(i, i + 10);
            const q = query(collection(db, "products"), where(documentId(), "in", batchIds));
            const snap = await getDocs(q);
            snap.forEach(d => productsMap[d.id] = d.data());
        }

        const newCart = currentCart.map(item => {
            const p = productsMap[item.id];
            if (!p) {
                item.maxStock = 0; 
                oosItems.push(item.name + " (No disponible)"); 
                cartHasChanges = true; 
                return item;
            }
            
            let realPrice = p.price || 0;
            let realOriginalPrice = p.originalPrice || 0;
            let realStock = p.stock || 0;
            const isInactive = p.status !== 'active';

            if (isInactive) {
                realStock = 0;
            } 
            else if (p.combinations && p.combinations.length > 0) {
                const combo = p.combinations.find(c => {
                    const cColor = (c.color || "").trim().toLowerCase();
                    const itemColor = (item.color || "").trim().toLowerCase();
                    const cCapacity = (c.capacity || "").trim().toLowerCase();
                    const itemCapacity = (item.capacity || "").trim().toLowerCase();
                    return cColor === itemColor && cCapacity === itemCapacity;
                });
                if (combo) {
                    realPrice = combo.price;
                    realOriginalPrice = combo.originalPrice || 0;
                    realStock = combo.stock;
                } else {
                    realStock = 0; 
                }
            } 
            else if (item.capacity && p.capacities) {
                const cap = p.capacities.find(c => {
                    const cLabel = (c.label || "").trim().toLowerCase();
                    const itemCapacity = (item.capacity || "").trim().toLowerCase();
                    return cLabel === itemCapacity;
                });
                if (cap) {
                    realPrice = cap.price;
                    realOriginalPrice = cap.originalPrice || 0;
                }
            }

            if (item.price !== realPrice || item.originalPrice !== realOriginalPrice) {
                let desc = item.name;
                if (item.color || item.capacity) {
                    desc += ` (${[item.color, item.capacity].filter(Boolean).join(" - ")})`;
                }
                priceChanges.push(desc);
                item.price = realPrice;
                item.originalPrice = realOriginalPrice;
                cartHasChanges = true;
            }

            if (realStock <= 0) {
                if (item.maxStock !== 0) { 
                    item.maxStock = 0; 
                    oosItems.push(item.name); 
                    cartHasChanges = true; 
                }
            } else {
                item.maxStock = realStock; 
                if (item.quantity > realStock) { 
                    item.quantity = realStock; 
                    cartHasChanges = true; 
                }
            }
            return item;
        });

        if (cartHasChanges) {
            localStorage.setItem(CART_KEY, JSON.stringify(newCart));
            window.dispatchEvent(new Event('cartUpdated'));
            updateCartCount();
            
            return {
                success: false,
                priceChanges,
                oosItems
            };
        }

        return { success: true };

    } catch (e) {
        console.error("Error validando carrito de último segundo:", e);
        throw new Error("No pudimos verificar la vigencia de los precios con el servidor. Por favor, reintenta.");
    }
}

// --- 5. LOGICA PRINCIPAL TRANSACCIONAL ---
els.btnSubmit.addEventListener('click', async (e) => {
    e.preventDefault();
    if (!els.name.value || !els.phone.value || !els.idNumber.value || !els.citySelect.value || !els.address.value) {
        showAlert("⚠️ Completa todos los campos obligatorios."); 
        return;
    }

    const btnHtml = els.btnSubmit.innerHTML;
    els.btnSubmit.disabled = true;
    els.btnSubmit.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Validando precios vigentes...`;

    try {
        const validation = await validateCartBeforePayment();
        if (!validation.success) {
            let alertMsg = "";
            if (validation.oosItems.length > 0) {
                alertMsg += `⚠️ STOCK ACTUALIZADO: ${validation.oosItems.join(", ")}. Algunos artículos de tu pedido ya no están disponibles en el inventario. `;
            }
            if (validation.priceChanges.length > 0) {
                alertMsg += `⚠️ PRECIOS ACTUALIZADOS: ${validation.priceChanges.join(", ")}. La promoción de algunos productos ha finalizado o sus precios se han actualizado. Por favor, revisa el nuevo total.`;
            }
            showAlert(alertMsg);
            
            toggleSubmitBtn(true);
            return;
        }
    } catch (err) {
        showAlert("⚠️ Error de Validación: " + err.message);
        toggleSubmitBtn(true);
        return;
    }

    // Si la validación pasa, restauramos temporalmente el texto para continuar con el flujo normal de cada pasarela
    els.btnSubmit.innerHTML = btnHtml;

    let billData = null;
    if(els.checkInvoice.checked) {
        if(!els.billInputs.name.value || !els.billInputs.taxId.value || !els.billInputs.address.value || !els.billInputs.city.value || !els.billInputs.email.value) {
            showAlert("⚠️ Faltan datos obligatorios para la expedición de tu Factura Electrónica.");
            return;
        }
        billData = {
            name: els.billInputs.name.value,
            taxId: els.billInputs.taxId.value,
            address: els.billInputs.address.value,
            city: els.billInputs.city.value,
            email: els.billInputs.email.value,
            phone: els.billInputs.phone.value
        };
    }
    
    const userAddresses = userProfileData?.addresses || [];
    let shouldSaveAddress = els.saveAddrCheck.checked;
    let isFirstAddress = userAddresses.length === 0;

    if (userAddresses.length === 0) {
        shouldSaveAddress = true;
    }

    if (selectedPaymentMethod === 'MANUAL' || selectedPaymentMethod === 'COD') {
        await processCODOrder(billData, shouldSaveAddress, isFirstAddress);
    } 
    else if (selectedPaymentMethod === 'ONLINE' || selectedPaymentMethod === 'PSE') {
        if (!auth.currentUser) return window.location.href = '/auth/login.html';
        const btnHtml = els.btnSubmit.innerHTML;
        els.btnSubmit.disabled = true;
        els.btnSubmit.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Conectando...`;

        try {
            const token = await auth.currentUser.getIdToken(true);
            const createPreference = httpsCallable(functions, 'createMercadoPagoPreference');
            const deptName = els.deptSelect.options[els.deptSelect.selectedIndex]?.dataset.name || "";
            const fullShippingData = {
                name: els.name.value,
                phone: els.phone.value,
                department: deptName,
                city: els.citySelect.value,
                address: els.address.value,
                postalCode: els.postal.value,
                notes: els.notes.value || ""
            };

            await saveUserProfileUpdates(shouldSaveAddress, isFirstAddress, deptName);

            const payloadCompleto = {
                userToken: String(token),
                shippingCost: Number(currentShippingCost),
                promoCodes: appliedPromoCodes,
                items: cart.map(i => ({ id: i.id, quantity: i.quantity, color: i.color || "", capacity: i.capacity || "" })),
                extraData: {
                    userName: els.name.value,
                    clientDoc: els.idNumber.value, 
                    needsInvoice: els.checkInvoice.checked, 
                    billingData: billData, 
                    shippingData: fullShippingData, 
                    source: 'TIENDA' 
                },
                buyerInfo: {
                    name: els.name.value,
                    email: auth.currentUser.email,
                    phone: els.phone.value,
                    address: els.address.value,
                    postal: els.postal.value
                }
            };

            const response = await createPreference(payloadCompleto);
            const { initPoint } = response.data;
            if (initPoint) {
                localStorage.setItem('pending_order_data', JSON.stringify({ items: cart, shipping: els.address.value, buyerInfo: { name: els.name.value, email: auth.currentUser.email } }));
                window.location.href = initPoint; 
            } else throw new Error("No se recibió link de pago.");

        } catch (error) {
            console.error("❌ Error preferencial:", error);
            showAlert("Error: " + (error.message || "Desconocido"));
            els.btnSubmit.disabled = false;
            els.btnSubmit.innerHTML = btnHtml;
        }
    }
    else if (selectedPaymentMethod === 'ADDI') {
        if (!auth.currentUser) return window.location.href = '/auth/login.html';
        if (!els.idNumber.value || els.idNumber.value.length < 5) {
            showAlert("⚠️ Se requiere Documento válido.");
            return;
        }
        if (!els.phone.value || els.phone.value.length < 10) {
            showAlert("⚠️ Se requiere Celular válido.");
            return;
        }

        const btnHtml = els.btnSubmit.innerHTML;
        els.btnSubmit.disabled = true;
        els.btnSubmit.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Conectando...`;

        try {
            const token = await auth.currentUser.getIdToken(true);
            const createAddi = httpsCallable(functions, 'createAddiCheckout');
            const deptName = els.deptSelect.options[els.deptSelect.selectedIndex]?.dataset.name || "";
            const fullShippingData = {
                name: els.name.value,
                phone: els.phone.value,
                department: deptName,
                city: els.citySelect.value,
                address: els.address.value,
                postalCode: els.postal.value,
                notes: els.notes.value || ""
            };

            await saveUserProfileUpdates(shouldSaveAddress, isFirstAddress, deptName);

            const payloadCompleto = {
                userToken: String(token),
                shippingCost: Number(currentShippingCost),
                paymentMethod: selectedPaymentMethod, 
                promoCodes: appliedPromoCodes,
                items: cart.map(i => ({ id: i.id, quantity: i.quantity, color: i.color || "", capacity: i.capacity || "" })),
                extraData: {
                    userName: els.name.value,
                    clientDoc: els.idNumber.value, 
                    phone: els.phone.value,        
                    needsInvoice: els.checkInvoice.checked, 
                    billingData: billData, 
                    shippingData: fullShippingData, 
                    source: 'TIENDA' 
                },
                buyerInfo: {
                    name: els.name.value,
                    email: auth.currentUser.email,
                    phone: els.phone.value,
                    address: els.address.value
                }
            };

            const response = await createAddi(payloadCompleto);
            const { initPoint } = response.data;
            if (initPoint) {
                localStorage.setItem('pending_order_data', JSON.stringify({ items: cart, method: selectedPaymentMethod }));
                window.location.href = initPoint; 
            } else throw new Error("No se recibió redirección externa.");

        } catch (error) {
            console.error("❌ Error de pasarela:", error);
            showAlert("Error: " + (error.message || "Desconocido"));
            els.btnSubmit.disabled = false;
            els.btnSubmit.innerHTML = btnHtml;
        }
    }
    else if (selectedPaymentMethod === 'SISTECREDITO') {
        if (!auth.currentUser) return window.location.href = '/auth/login.html';
        if (!els.idNumber.value || els.idNumber.value.length < 5) {
            showAlert("⚠️ Se requiere Documento válido para Sistecrédito.");
            return;
        }
        if (!els.phone.value || els.phone.value.length < 10) {
            showAlert("⚠️ Se requiere Celular válido para Sistecrédito.");
            return;
        }

        const btnHtml = els.btnSubmit.innerHTML;
        els.btnSubmit.disabled = true;
        els.btnSubmit.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Conectando a Sistecrédito...`;

        try {
            const token = await auth.currentUser.getIdToken(true);
            const createSistecredito = httpsCallable(functions, 'createSistecreditoCheckout');
            const deptName = els.deptSelect.options[els.deptSelect.selectedIndex]?.dataset.name || "";
            const fullShippingData = {
                name: els.name.value,
                phone: els.phone.value,
                department: deptName,
                city: els.citySelect.value,
                address: els.address.value,
                postalCode: els.postal.value,
                notes: els.notes.value || ""
            };

            await saveUserProfileUpdates(shouldSaveAddress, isFirstAddress, deptName);

            const payloadCompleto = {
                userToken: String(token),
                shippingCost: Number(currentShippingCost),
                promoCodes: appliedPromoCodes,
                items: cart.map(i => ({ id: i.id, quantity: i.quantity, color: i.color || "", capacity: i.capacity || "" })),
                extraData: {
                    userName: els.name.value,
                    clientDoc: els.idNumber.value, 
                    phone: els.phone.value,        
                    needsInvoice: els.checkInvoice.checked, 
                    billingData: billData, 
                    shippingData: fullShippingData, 
                    source: 'TIENDA_WEB' 
                },
                buyerInfo: {
                    name: els.name.value,
                    email: auth.currentUser.email,
                    phone: els.phone.value,
                    address: els.address.value,
                    document: els.idNumber.value 
                }
            };

            const response = await createSistecredito(payloadCompleto);
            const { initPoint } = response.data;
            
            if (initPoint) {
                localStorage.setItem('pending_order_data', JSON.stringify({ items: cart, method: 'SISTECREDITO' }));
                window.location.href = initPoint; 
            } else {
                throw new Error("No se recibió link de pago.");
            }

        } catch (error) {
            console.error("❌ Error Sistecrédito:", error);
            showAlert("Error conectando con Sistecrédito: " + (error.message || "Intenta nuevamente."));
            els.btnSubmit.disabled = false;
            els.btnSubmit.innerHTML = btnHtml;
        }
    }
});

async function processCODOrder(billData, shouldSaveAddress, isFirstAddress) {
    const btnHtml = els.btnSubmit.innerHTML;
    els.btnSubmit.disabled = true;
    els.btnSubmit.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Confirmando transacción...`;

    try {
        if (!auth.currentUser) throw new Error("Debes iniciar sesión.");
        const userToken = await auth.currentUser.getIdToken(true); 
        const deptName = els.deptSelect.options[els.deptSelect.selectedIndex]?.dataset.name || "";
        const shippingData = {
            name: els.name.value,
            phone: els.phone.value,
            department: deptName,
            city: els.citySelect.value,
            address: els.address.value,
            postalCode: els.postal.value,
            notes: els.notes.value || ""
        };

        const payload = {
            userToken: String(userToken),
            items: cart.map(i => ({ id: i.id, quantity: i.quantity, color: i.color || "", capacity: i.capacity || "" })),
            shippingCost: currentShippingCost,
            paymentMethod: selectedPaymentMethod, 
            promoCodes: appliedPromoCodes, 
            extraData: {
                userName: els.name.value,
                clientDoc: els.idNumber.value,
                phone: els.phone.value,
                needsInvoice: els.checkInvoice.checked,
                billingData: billData,
                shippingData: shippingData,
                source: 'TIENDA_WEB'
            }
        };

        await saveUserProfileUpdates(shouldSaveAddress, isFirstAddress, deptName);

        const createCOD = httpsCallable(functions, 'createCODOrder');
        const response = await createCOD(payload);
        const { orderId } = response.data;

        localStorage.removeItem(CART_KEY);
        updateCartCount();
        window.location.href = `/shop/success.html?order=${orderId}`;

    } catch (error) {
        console.error("❌ Error de registro transaccional:", error);
        showAlert("Error: " + (error.message || error));
        els.btnSubmit.disabled = false;
        els.btnSubmit.innerHTML = btnHtml;
    }
}

async function saveUserProfileUpdates(shouldSaveAddress, isFirstAddress, deptName) {
    if (!currentUser) return;
    try {
        let updates = {};
        let needsUpdate = false;

        if (!userProfileData.name || userProfileData.name !== els.name.value) {
            updates.name = els.name.value; needsUpdate = true;
        }
        if (!userProfileData.phone || userProfileData.phone !== els.phone.value) {
            updates.phone = els.phone.value; needsUpdate = true;
        }
        if (!userProfileData.document || userProfileData.document !== els.idNumber.value) {
            updates.document = els.idNumber.value; needsUpdate = true;
        }

        if (shouldSaveAddress) {
            const newAddr = {
                alias: isFirstAddress ? "Mi Casa" : `Envío ${new Date().toLocaleDateString()}`,
                address: els.address.value,
                dept: deptName,
                city: els.citySelect.value,
                zip: els.postal.value,
                notes: els.notes.value,
                isDefault: isFirstAddress 
            };
            updates.addresses = arrayUnion(newAddr);
            needsUpdate = true;
        }

        if (needsUpdate) {
            const userRef = doc(db, "users", currentUser.uid);
            await updateDoc(userRef, updates);
        }
    } catch (error) {
        console.warn("⚠️ Autoguardado diferido:", error);
    }
}

function renderOrderSummary() {
    const totalItems = cart.reduce((acc, item) => acc + (item.quantity || 1), 0);
    const qtyDisplay = document.getElementById('order-qty-display');
    if(qtyDisplay) qtyDisplay.textContent = `${totalItems} Ítems`;

    els.itemsContainer.innerHTML = cart.map(item => {
        const hasDiscount = item.originalPrice && item.price < item.originalPrice;
        const discountPercent = hasDiscount ? Math.round(((item.originalPrice - item.price) / item.originalPrice) * 100) : 0;
        const lineTotal = item.price * item.quantity;
        const lineOriginalTotal = item.originalPrice * item.quantity;

        return `
        <div class="flex items-center gap-4 py-3 border-b border-dashed border-white/5 last:border-0">
            <!-- Imagen del Producto con Badges de Descuento y Cantidad siempre legibles -->
            <div class="w-14 h-14 bg-white border border-white/5 rounded-xl p-1 flex items-center justify-center shrink-0 relative">
                <img src="${item.image || item.mainImage || 'https://placehold.co/50'}" class="max-w-full max-h-full object-contain">
                
                <!-- Badge de Descuento: Sin borde blanco, fuente más limpia y legible -->
                ${hasDiscount ? `
                    <span class="absolute -top-1.5 -left-1.5 bg-brand-red text-white text-[10px] font-bold px-2 py-0.5 rounded-md shadow-md tracking-normal">-${discountPercent}%</span>
                ` : ''}
                
                <!-- Badge de Cantidad: Siempre visible en la esquina superior derecha -->
                <span class="absolute -top-1.5 -right-1.5 bg-brand-orange text-white text-[10px] font-black w-5 h-5 flex items-center justify-center rounded-full border-2 border-white shadow-sm">${item.quantity}</span>
            </div>
            
            <div class="flex-grow min-w-0">
                <p class="text-[11px] font-black text-white uppercase truncate leading-tight hover:text-brand-orange transition-colors">${item.name}</p>
                <div class="flex flex-wrap gap-1 mt-1">
                    ${item.color ? `<span class="text-[8px] bg-white/5 border border-white/10 px-1.5 py-0.5 rounded text-gray-300 font-black uppercase tracking-wide">${item.color}</span>` : ''}
                    ${item.capacity ? `<span class="text-[8px] bg-brand-orange/10 border border-brand-orange/20 px-1.5 py-0.5 rounded text-brand-orange font-black uppercase tracking-wide">${item.capacity}</span>` : ''}
                </div>
            </div>
            
            <div class="text-right flex flex-col items-end justify-center">
                ${hasDiscount ? `
                    <span class="text-[9px] font-bold text-gray-500 line-through">$${lineOriginalTotal.toLocaleString('es-CO')}</span>
                    <span class="text-xs font-black text-brand-red">$${lineTotal.toLocaleString('es-CO')}</span>
                ` : `
                    <span class="text-xs font-black text-white">$${lineTotal.toLocaleString('es-CO')}</span>
                `}
            </div>
        </div>`
    }).join('');
    
    updateTotalDisplay();
}

// ==========================================================================
// 🎟️ NUEVO: CONTROL DE CUPONES EN EL CLIENTE
// ==========================================================================
async function validateAndRenderPromos() {
    if (cart.length === 0) return;
    
    const validatePromoCodesFn = httpsCallable(functions, 'validatePromoCodes');
    
    els.appliedPromosContainer.innerHTML = '<span class="text-[10px] text-gray-400 font-bold uppercase"><i class="fa-solid fa-circle-notch fa-spin"></i> Validando...</span>';
    
    try {
        const userToken = auth.currentUser ? await auth.currentUser.getIdToken(true) : null;
        const response = await validatePromoCodesFn({
            items: cart.map(i => ({ id: i.id, quantity: i.quantity, color: i.color || "", capacity: i.capacity || "" })),
            promoCodes: appliedPromoCodes,
            shippingCost: currentShippingCost,
            userToken: userToken,
            paymentMethod: selectedPaymentMethod
        });
        
        const result = response.data;
        
        if (!result.success) {
            showAlert(`❌ Error al aplicar cupones: ${result.error}`);
            appliedPromoCodes.pop();
            await validateAndRenderPromos();
            return;
        }
        
        appliedPromosDetails = result.appliedPromos || [];
        currentDiscountAmount = result.totalDiscounts || 0;
        
        renderPromoChips();
        
        const cartTotal = cart.reduce((acc, item) => acc + (item.price * item.quantity), 0);
        els.subtotal.textContent = `$${cartTotal.toLocaleString('es-CO')}`;
        
        const finalShipping = result.finalShippingCost;
        els.shippingCost.textContent = finalShipping === 0 ? "GRATIS" : `$${finalShipping.toLocaleString('es-CO')}`;
        
        if (finalShipping === 0 && currentShippingCost > 0) {
            els.freeShippingMsg.classList.remove('hidden');
        } else if (finalShipping > 0) {
            els.freeShippingMsg.classList.add('hidden');
        }
        
        if (currentDiscountAmount > 0) {
            els.discountRow.classList.remove('hidden');
            els.discountAmount.textContent = `- $${currentDiscountAmount.toLocaleString('es-CO')}`;
        } else {
            els.discountRow.classList.add('hidden');
        }
        
        els.total.textContent = `$${result.totalAmount.toLocaleString('es-CO')}`;
        
    } catch (err) {
        console.error("Error validando cupones:", err);
        showAlert("No se pudieron validar los cupones. Por favor intenta de nuevo.");
        appliedPromoCodes.pop();
        renderPromoChips();
    }
}

function renderPromoChips() {
    els.appliedPromosContainer.innerHTML = '';
    if (appliedPromoCodes.length === 0) {
        els.appliedPromosContainer.innerHTML = '<span class="text-[9px] text-gray-500 italic">No hay cupones aplicados</span>';
        return;
    }
    
    appliedPromoCodes.forEach((code, idx) => {
        const detail = appliedPromosDetails.find(p => p.code === code) || { value: 0, type: 'percentage' };
        let badgeText = code;
        if (detail.value > 0) {
            badgeText += ` (${detail.type === 'percentage' ? `${detail.value}%` : `$${detail.value.toLocaleString('es-CO')}`})`;
        }
        
        const chip = document.createElement('div');
        chip.className = 'bg-brand-orange/15 border border-brand-orange/30 text-brand-orange text-[10px] font-black uppercase px-2.5 py-1.5 rounded-xl flex items-center gap-1.5 shadow-sm';
        chip.innerHTML = `
            <span>${badgeText}</span>
            <button type="button" class="text-white hover:text-brand-red transition focus:outline-none" onclick="removePromoCode(${idx})"><i class="fa-solid fa-xmark text-[10px]"></i></button>
        `;
        els.appliedPromosContainer.appendChild(chip);
    });
}

window.removePromoCode = async (idx) => {
    appliedPromoCodes.splice(idx, 1);
    if (appliedPromoCodes.length === 0) {
        appliedPromosDetails = [];
        currentDiscountAmount = 0;
        calculateShipping();
        renderPromoChips();
    } else {
        await validateAndRenderPromos();
    }
};

if (els.btnApplyPromo) {
    els.btnApplyPromo.addEventListener('click', async () => {
        const code = els.promoCodeInput.value.trim().toUpperCase();
        if (!code) return;
        
        if (appliedPromoCodes.includes(code)) {
            showAlert("Este cupón ya ha sido aplicado.");
            return;
        }
        
        appliedPromoCodes.push(code);
        els.promoCodeInput.value = "";
        await validateAndRenderPromos();
    });
}