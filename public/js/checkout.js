import { auth, db, doc, updateDoc, onSnapshot, arrayUnion, functions, httpsCallable, onAuthStateChanged } from "./firebase-init.js";
import { getCart, getCartTotal, updateCartCount } from "./cart.js";

// --- REFERENCIAS DOM ---
const els = {
    form: document.getElementById('checkout-form'),
    itemsContainer: document.getElementById('checkout-items'),
    subtotal: document.getElementById('check-subtotal'),
    shippingCost: document.getElementById('check-shipping'),
    total: document.getElementById('check-total'),
    freeShippingMsg: document.getElementById('free-shipping-msg'),
    dispatchMsg: document.getElementById('dispatch-time-msg'), 
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

    // Facturación
    checkInvoice: document.getElementById('check-need-invoice'),
    billingForm: document.getElementById('billing-form-checkout'),
    billInputs: {
        name: document.getElementById('bill-name'),
        taxId: document.getElementById('bill-taxid'),
        address: document.getElementById('bill-address'),
        city: document.getElementById('bill-city'),
        email: document.getElementById('bill-email'),
        phone: document.getElementById('bill-phone')
    }
};

let currentUser = null;
let userProfileData = null;
// Filtramos items agotados para no procesarlos
let cart = getCart().filter(item => item.maxStock === undefined || item.maxStock > 0);

let shippingConfig = { freeThreshold: 0, defaultPrice: 0, groups: [] };
let currentShippingCost = 0;
let selectedPaymentMethod = 'MANUAL';

let colombianHolidays = [];

// Listeners en vivo
let unsubscribeShipping = null;
let unsubscribeUser = null;

// Escuchar cambios en el carrito globalmente (si `cart.js` lo dispara en otra pestaña o internamente)
window.addEventListener('cartUpdated', () => {
    cart = getCart().filter(item => item.maxStock === undefined || item.maxStock > 0);
    
    if (cart.length === 0 && currentUser) {
        alert("Tu carrito no tiene productos disponibles para comprar.");
        window.location.href = '/shop/cart.html';
        return;
    }
    
    renderOrderSummary();
    calculateShipping();
});

// --- 1. INICIALIZACIÓN ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        if (cart.length === 0) {
            alert("Tu carrito no tiene productos disponibles para comprar.");
            window.location.href = '/shop/cart.html';
            return;
        }

        currentUser = user;
        
        await loadDepartments(); // API Externa (0 lecturas)
        await loadHolidays();    // 🔥 NUEVO: Cargamos los festivos al entrar
        
        // Iniciamos los motores en tiempo real
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

// --- 2. LÓGICA DE MÉTODOS DE PAGO ---
function setupPaymentListeners() {
    const radios = document.querySelectorAll('input[name="payment_method"]');
    radios.forEach(r => {
        r.addEventListener('change', (e) => {
            selectedPaymentMethod = e.target.value;
            updateSubmitButtonText();
        });
    });
}

function validatePaymentMethods() {
    const city = els.citySelect.value || "";
    const isBogota = city.toLowerCase().includes('bogot'); 

    if (isBogota) {
        els.codInput.disabled = false;
        els.codContainer.classList.remove('payment-disabled', 'opacity-50', 'grayscale', 'pointer-events-none');
        els.codWarning.classList.add('hidden');
    } else {
        els.codInput.disabled = true;
        els.codContainer.classList.add('payment-disabled', 'opacity-50', 'grayscale', 'pointer-events-none');
        els.codWarning.classList.remove('hidden');

        if (els.codInput.checked) {
            els.onlineInput.checked = true;
            selectedPaymentMethod = 'ONLINE';
            updateSubmitButtonText();
        }
    }
}

function updateSubmitButtonText() {
    const btn = els.btnSubmit;
    btn.className = "w-full mt-10 font-black py-5 rounded-2xl transition-all duration-300 uppercase text-xs tracking-[0.25em] flex items-center justify-center gap-3 cursor-pointer hover:shadow-lg";

    if (selectedPaymentMethod === 'MANUAL') {
        btn.innerHTML = `Confirmar Transferencia Manual <i class="fa-solid fa-building-columns"></i>`;
        btn.classList.add('bg-gray-600', 'text-white');
    }
    else if (selectedPaymentMethod === 'COD') {
        btn.innerHTML = `Confirmar Contra Entrega <i class="fa-solid fa-truck-fast"></i>`;
        btn.classList.add('bg-brand-black', 'text-white');
    } 
    else if (selectedPaymentMethod === 'ONLINE') {
        btn.innerHTML = `Ir a Pagar con MercadoPago <i class="fa-solid fa-lock"></i>`;
        btn.classList.add('bg-blue-600', 'text-white');
    } 
    else if (selectedPaymentMethod === 'ADDI') {
        btn.innerHTML = `Pagar con ADDI <i class="fa-solid fa-arrow-right"></i>`;
        btn.classList.add('bg-[#00D6D6]', 'text-white');
    }
    else if (selectedPaymentMethod === 'SISTECREDITO') {
        btn.innerHTML = `Pagar con Sistecrédito <i class="fa-solid fa-arrow-right"></i>`;
        btn.classList.add('bg-[#00B34A]', 'text-white');
    }
    else if (selectedPaymentMethod === 'PSE') {
        btn.innerHTML = `Pagar con PSE <i class="fa-solid fa-building-columns"></i>`;
        btn.classList.add('bg-blue-600', 'text-white');
    }

    // 🔥 NUEVO: Forzamos la actualización del mensaje de despacho al cambiar de método
    checkDispatchTime(shippingConfig.cutoffTime || "14:00");
}

// ==========================================================================
// 🧠 SMART REAL-TIME CACHE (onSnapshot)
// ==========================================================================

// A. Configuración de Envío en Tiempo Real
function initShippingRealtimeSync() {
    const cachedConfig = sessionStorage.getItem('pixeltech_shipping_config');
    if (cachedConfig) {
        shippingConfig = JSON.parse(cachedConfig);
        checkDispatchTime(shippingConfig.cutoffTime || "14:00");
        calculateShipping(); // Renderiza usando caché inicial
    }

    if (unsubscribeShipping) unsubscribeShipping();

    unsubscribeShipping = onSnapshot(doc(db, "config", "shipping"), (snap) => {
        if (snap.exists()) {
            const freshConfig = snap.data();
            
            // Solo si cambia algo respecto a nuestro caché, recalculamos los precios del usuario
            if (JSON.stringify(shippingConfig) !== JSON.stringify(freshConfig)) {
                console.log("🚚 [Checkout] Políticas de envío actualizadas en vivo.");
                shippingConfig = freshConfig;
                sessionStorage.setItem('pixeltech_shipping_config', JSON.stringify(shippingConfig));
                
                checkDispatchTime(shippingConfig.cutoffTime || "14:00");
                calculateShipping(); // Esto actualizará la factura del usuario instantáneamente
            }
        }
    }, (e) => console.error("SmartSync Shipping error:", e));
}

// B. Datos del Usuario y Direcciones en Tiempo Real
function initUserRealtimeSync(uid) {
    const cachedProfile = sessionStorage.getItem('pixeltech_user_profile');
    const cachedAddr = sessionStorage.getItem('pixeltech_user_addresses');

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
                console.log("👤 [Checkout] Perfil de usuario actualizado en vivo.");
                userProfileData = freshData;
                
                const { addresses, ...profileData } = userProfileData;
                sessionStorage.setItem('pixeltech_user_profile', JSON.stringify(profileData));
                sessionStorage.setItem('pixeltech_user_addresses', JSON.stringify(addresses || []));
                
                populateUserForm();
            }
        }
    }, (e) => console.error("SmartSync User error:", e));
}

function populateUserForm() {
    // Rellenamos datos base solo si están vacíos para no borrarle lo que ya esté escribiendo
    if (!els.idNumber.value && document.activeElement !== els.idNumber) els.idNumber.value = userProfileData.document || ""; 
    if (!els.name.value && document.activeElement !== els.name) els.name.value = userProfileData.name || currentUser.displayName || "";
    if (!els.phone.value && document.activeElement !== els.phone) els.phone.value = userProfileData.phone || userProfileData.contactPhone || "";

    const addresses = userProfileData.addresses || [];
    
    // Guardamos la selección actual para no quitársela si Firebase repinta la lista
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

    // Si ya tenía algo seleccionado, lo mantenemos. Si no, ponemos la default.
    if (currentSelection !== "") {
        els.savedAddrSelect.value = currentSelection;
    } else if (defaultIndex >= 0) {
        els.savedAddrSelect.value = defaultIndex;
        // Solo autocompletamos si los campos están vacíos
        if (!els.address.value) fillFormWithData(addresses[defaultIndex]);
    } 
}

// --- UTILIDADES ---

function checkDispatchTime(cutoffTimeStr) {
    if(!els.dispatchMsg) return;
    
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0 = Domingo, 1 = Lunes ... 6 = Sábado
    const [hours, minutes] = cutoffTimeStr.split(':').map(Number);
    
    let cutoffDate = new Date();
    cutoffDate.setHours(hours, minutes, 0, 0);

    // Formatear fecha a YYYY-MM-DD (Ajustando la zona horaria local)
    const formatDateStr = (dateObj) => {
        const offset = dateObj.getTimezoneOffset() * 60000;
        return new Date(dateObj.getTime() - offset).toISOString().split('T')[0];
    };

    const todayStr = formatDateStr(now);
    const isTodayHoliday = colombianHolidays.includes(todayStr);

    // LÓGICA SISTECRÉDITO: Restamos 6 horas al límite normal
    if (selectedPaymentMethod === 'SISTECREDITO') {
        cutoffDate.setHours(cutoffDate.getHours() - 6);
    }

    // ¿Estamos a tiempo de despachar hoy?
    let isBeforeCutoff = now < cutoffDate;

    // Si hoy es Domingo o Festivo en Colombia, NUNCA se despacha hoy.
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
        
        els.dispatchMsg.innerHTML = `<p class="text-[10px] font-black uppercase text-green-600 pulse-text"><i class="fa-solid fa-bolt text-yellow-500 mr-1"></i> Pide en <span class="underline">${timeText}</span> y despachamos HOY</p>`;
    } else {
        // 🔥 MAGIA: Si no sale hoy, buscamos el siguiente día hábil real (saltando domingos y festivos)
        let nextDay = new Date(now);
        nextDay.setDate(nextDay.getDate() + 1); // Empezamos revisando el día de mañana

        while (nextDay.getDay() === 0 || colombianHolidays.includes(formatDateStr(nextDay))) {
            nextDay.setDate(nextDay.getDate() + 1); // Si es domingo o festivo, saltamos al siguiente día
        }

        // Traducir el día que encontramos a español
        const diasSemana = ['el DOMINGO', 'el LUNES', 'el MARTES', 'el MIÉRCOLES', 'el JUEVES', 'el VIERNES', 'el SÁBADO'];
        let dispatchDayText = diasSemana[nextDay.getDay()];
        
        // Si casualmente el siguiente día hábil es exactamente mañana, decimos "MAÑANA" por elegancia
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        if (formatDateStr(nextDay) === formatDateStr(tomorrow)) {
            dispatchDayText = "MAÑANA";
        }

        if (selectedPaymentMethod === 'SISTECREDITO') {
            els.dispatchMsg.innerHTML = `<p class="text-[10px] font-black uppercase text-blue-500"><i class="fa-solid fa-calendar-check mr-1"></i> Tu pedido será despachado despacharemos ${dispatchDayText}</p>`;
        } else {
            els.dispatchMsg.innerHTML = `<p class="text-[10px] font-black uppercase text-blue-500"><i class="fa-solid fa-calendar-check mr-1"></i> Tu pedido será despachado ${dispatchDayText}</p>`;
        }
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

// 🔥 NUEVO: Cargar festivos de Colombia del año actual
async function loadHolidays() {
    try {
        const year = new Date().getFullYear();
        const res = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/CO`);
        const data = await res.json();
        // Extraemos solo las fechas (ej: "2026-05-01") y las guardamos en nuestro caché
        colombianHolidays = data.map(h => h.date);
    } catch (e) {
        console.error("Error cargando festivos de Colombia:", e);
    }
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

els.deptSelect.addEventListener('change', (e) => loadCitiesForDept(e.target.value));

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

// --- 4. CÁLCULOS Y UI ---
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
    const t = cartTotal + currentShippingCost;
    
    els.subtotal.textContent = `$${cartTotal.toLocaleString('es-CO')}`;
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

// --- 5. LOGICA PRINCIPAL DE SUBMIT ---
els.btnSubmit.addEventListener('click', async (e) => {
    e.preventDefault();
    if (!els.name.value || !els.phone.value || !els.idNumber.value || !els.citySelect.value || !els.address.value) {
        alert("⚠️ Completa todos los campos obligatorios."); 
        return;
    }

    let billData = null;
    if(els.checkInvoice.checked) {
        if(!els.billInputs.name.value || !els.billInputs.taxId.value) return alert("⚠️ Faltan datos de facturación.");
        billData = {
            name: els.billInputs.name.value,
            taxId: els.billInputs.taxId.value,
            address: els.billInputs.address.value,
            city: els.billInputs.city.value,
            email: els.billInputs.email.value,
            phone: els.billInputs.phone.value
        };
    }
    
    // NUEVO: Lógica de Autoguardado Inteligente
    // Si el usuario no tiene ninguna dirección guardada previamente, forzamos que esta se guarde y sea la Default
    const userAddresses = userProfileData?.addresses || [];
    let shouldSaveAddress = els.saveAddrCheck.checked;
    let isFirstAddress = false;

    if (userAddresses.length === 0) {
        shouldSaveAddress = true;
        isFirstAddress = true; // Bandera para marcarla como predeterminada más adelante
    }

    if (selectedPaymentMethod === 'MANUAL' || selectedPaymentMethod === 'COD') {
        await processCODOrder(billData, shouldSaveAddress, isFirstAddress);
    } 
    else if (selectedPaymentMethod === 'ONLINE') {
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

            // Guardado automático del perfil antes de ir a MercadoPago
            await saveUserProfileUpdates(shouldSaveAddress, isFirstAddress, deptName);

            const payloadCompleto = {
                userToken: String(token),
                shippingCost: Number(currentShippingCost),
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
            console.error("❌ Error:", error);
            alert("Error: " + (error.message || "Desconocido"));
            els.btnSubmit.disabled = false;
            els.btnSubmit.innerHTML = btnHtml;
        }
    }
    // Aceptamos tanto ADDI como PSE para disparar esta función
    else if (selectedPaymentMethod === 'ADDI' || selectedPaymentMethod === 'PSE') {
        if (!auth.currentUser) return window.location.href = '/auth/login.html';
        if (!els.idNumber.value || els.idNumber.value.length < 5) return alert("⚠️ Se requiere Documento válido.");
        if (!els.phone.value || els.phone.value.length < 10) return alert("⚠️ Se requiere Celular válido.");

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
                paymentMethod: selectedPaymentMethod, // 🔥 NUEVO: Le pasamos 'ADDI' o 'PSE' al backend
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
                localStorage.setItem('pending_order_data', JSON.stringify({ items: cart, method: 'ADDI' }));
                window.location.href = initPoint; 
            } else throw new Error("No se recibió link de ADDI.");

        } catch (error) {
            console.error("❌ Error ADDI:", error);
            alert("Error ADDI: " + (error.message || "Desconocido"));
            els.btnSubmit.disabled = false;
            els.btnSubmit.innerHTML = btnHtml;
        }
    }
    // =====================================
    // LÓGICA PARA SISTECRÉDITO
    // =====================================
    else if (selectedPaymentMethod === 'SISTECREDITO') {
        if (!auth.currentUser) return window.location.href = '/auth/login.html';
        
        // Validaciones idénticas a las que requiere la pasarela
        if (!els.idNumber.value || els.idNumber.value.length < 5) return alert("⚠️ Se requiere Documento válido para Sistecrédito.");
        if (!els.phone.value || els.phone.value.length < 10) return alert("⚠️ Se requiere Celular válido para Sistecrédito.");

        const btnHtml = els.btnSubmit.innerHTML;
        els.btnSubmit.disabled = true;
        els.btnSubmit.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Conectando a Sistecrédito...`;

        try {
            const token = await auth.currentUser.getIdToken(true);
            // Llamamos a la función que acabamos de crear en el backend
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

            // Autoguardado del perfil
            await saveUserProfileUpdates(shouldSaveAddress, isFirstAddress, deptName);

            const payloadCompleto = {
                userToken: String(token),
                shippingCost: Number(currentShippingCost),
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

            // Ejecutamos la petición
            const response = await createSistecredito(payloadCompleto);
            const { initPoint } = response.data;
            
            if (initPoint) {
                // Guardamos en localstorage por si cancelan y regresan
                localStorage.setItem('pending_order_data', JSON.stringify({ items: cart, method: 'SISTECREDITO' }));
                window.location.href = initPoint; // Redirigimos a la experiencia de Sistecrédito
            } else {
                throw new Error("No se recibió link de pago.");
            }

        } catch (error) {
            console.error("❌ Error Sistecrédito:", error);
            alert("Error conectando con Sistecrédito: " + (error.message || "Intenta nuevamente."));
            els.btnSubmit.disabled = false;
            els.btnSubmit.innerHTML = btnHtml;
        }
    }
});

// --- 6. PROCESAMIENTO CONTRA ENTREGA O MANUAL ---
async function processCODOrder(billData, shouldSaveAddress, isFirstAddress) {
    const btnHtml = els.btnSubmit.innerHTML;
    els.btnSubmit.disabled = true;
    els.btnSubmit.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Confirmando...`;

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

        // Guardado automático del perfil antes de crear la orden
        await saveUserProfileUpdates(shouldSaveAddress, isFirstAddress, deptName);

        const createCOD = httpsCallable(functions, 'createCODOrder');
        const response = await createCOD(payload);
        const { orderId } = response.data;

        localStorage.removeItem('pixeltech_cart');
        updateCartCount();
        window.location.href = `/shop/success.html?order=${orderId}`;

    } catch (error) {
        console.error("❌ Error COD/Manual:", error);
        alert("Error: " + (error.message || error));
        els.btnSubmit.disabled = false;
        els.btnSubmit.innerHTML = btnHtml;
    }
}

// --- NUEVA FUNCIÓN: ACTUALIZAR PERFIL Y DIRECCIONES ---
async function saveUserProfileUpdates(shouldSaveAddress, isFirstAddress, deptName) {
    if (!currentUser) return;
    
    try {
        let updates = {};
        let needsUpdate = false;

        // 1. Completar datos faltantes en el perfil del usuario
        if (!userProfileData.name || userProfileData.name !== els.name.value) {
            updates.name = els.name.value;
            needsUpdate = true;
        }
        if (!userProfileData.phone || userProfileData.phone !== els.phone.value) {
            updates.phone = els.phone.value;
            needsUpdate = true;
        }
        if (!userProfileData.document || userProfileData.document !== els.idNumber.value) {
            updates.document = els.idNumber.value;
            needsUpdate = true;
        }

        // 2. Guardar o inyectar la nueva dirección si corresponde
        if (shouldSaveAddress) {
            const newAddr = {
                alias: isFirstAddress ? "Mi Casa" : `Envío ${new Date().toLocaleDateString()}`,
                address: els.address.value,
                dept: deptName,
                city: els.citySelect.value,
                zip: els.postal.value,
                notes: els.notes.value,
                isDefault: isFirstAddress // Si es la primera, se vuelve predeterminada forzosamente
            };
            
            updates.addresses = arrayUnion(newAddr);
            needsUpdate = true;
        }

        if (needsUpdate) {
            const userRef = doc(db, "users", currentUser.uid);
            await updateDoc(userRef, updates);
            console.log("✅ Perfil de usuario actualizado/completado automáticamente.");
        }
    } catch (error) {
        console.warn("⚠️ Error guardando perfil en background:", error);
        // No bloqueamos la compra si falla el autoguardado
    }
}

// --- 7. RENDERIZADO DEL RESUMEN ---
els.checkInvoice.addEventListener('change', (e) => {
    e.target.checked ? els.billingForm.classList.remove('hidden') : els.billingForm.classList.add('hidden');
});

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
        <div class="flex items-center gap-4 py-3 border-b border-dashed border-gray-50 last:border-0">
            <div class="w-14 h-14 bg-white border border-gray-100 rounded-xl p-1 flex items-center justify-center shrink-0 relative">
                <img src="${item.image || item.mainImage || 'https://placehold.co/50'}" class="max-w-full max-h-full object-contain">
                ${hasDiscount ? `
                    <span class="absolute -top-2 -left-2 bg-brand-red text-white text-[7px] font-black px-1.5 py-0.5 rounded-full shadow-sm border border-white">-${discountPercent}%</span>
                ` : `
                    <span class="absolute -top-1.5 -right-1.5 bg-gray-100 text-gray-500 text-[9px] font-black w-5 h-5 flex items-center justify-center rounded-full border-2 border-white">${item.quantity}</span>
                `}
            </div>
            <div class="flex-grow min-w-0">
                <p class="text-[10px] font-black text-brand-black uppercase truncate leading-tight">${item.name}</p>
                <div class="flex flex-wrap gap-1 mt-1">
                    ${item.color ? `<span class="text-[8px] bg-slate-50 border border-slate-100 px-1.5 rounded text-gray-500 font-bold uppercase">${item.color}</span>` : ''}
                    ${item.capacity ? `<span class="text-[8px] bg-slate-50 border border-slate-100 px-1.5 rounded text-gray-500 font-bold uppercase">${item.capacity}</span>` : ''}
                </div>
            </div>
            <div class="text-right flex flex-col items-end justify-center">
                ${hasDiscount ? `
                    <span class="text-[9px] font-bold text-gray-300 line-through decoration-gray-300">$${lineOriginalTotal.toLocaleString('es-CO')}</span>
                    <span class="text-xs font-black text-brand-red">$${lineTotal.toLocaleString('es-CO')}</span>
                ` : `
                    <span class="text-xs font-black text-brand-black">$${lineTotal.toLocaleString('es-CO')}</span>
                `}
            </div>
        </div>
    `}).join('');
    
    updateTotalDisplay();
}