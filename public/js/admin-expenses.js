import { db, collection, doc, getDocs, getDoc, query, orderBy, Timestamp, runTransaction, limit, startAt, endAt } from './firebase-init.js';
import { loadAdminSidebar } from './admin-ui.js';
import { AdminStore } from './admin-store.js'; // 🔥 IMPORTAMOS EL CEREBRO

loadAdminSidebar();

// --- DOM ---
const listContainer = document.getElementById('expenses-list');
const loadMoreBtn = document.getElementById('load-more-container');
const modal = document.getElementById('expense-modal');
const form = document.getElementById('expense-form');
const accountSelect = document.getElementById('account-select');
const taxAlert = document.getElementById('tax-alert');
const amountDisplay = document.getElementById('amount-display');
const supplierSearch = document.getElementById('supplier-search');
const supplierDropdown = document.getElementById('supplier-dropdown');
const selectedSupplierId = document.getElementById('selected-supplier-id');
const searchInput = document.getElementById('search-input');
const filterMonthInput = document.getElementById('filter-month');
const btnClearDate = document.getElementById('btn-clear-date');
const lblPeriodTotal = document.getElementById('lbl-period-total');
const trashModal = document.getElementById('trash-modal');
const trashList = document.getElementById('trash-list');

// --- ESTADO ---
const PAGE_SIZE = 50;
let currentPage = 1;
let currentFilterDate = null;
let adminExpensesCache = []; // Base de datos maestra de gastos en RAM
let accountsList = [];

const getCurrentAdminName = () => document.getElementById('admin-name')?.textContent || 'Admin Desconocido';
const cleanNumber = (val) => {
    if (typeof val === 'number') return val;
    if (!val) return 0;
    return parseFloat(val.toString().replace(/[^\d-]/g, '')) || 0;
};

// ==========================================================================
// 🔥 CONEXIÓN AL STORE CENTRAL
// ==========================================================================

AdminStore.subscribeToAccounts((accs) => {
    accountsList = accs;
    const previousSelection = accountSelect.value;
    accountSelect.innerHTML = '<option value="">Seleccione Cuenta...</option>';
    accountsList.forEach(a => {
        accountSelect.innerHTML += `<option value="${a.id}">${a.name} ($${(a.balance || 0).toLocaleString()})</option>`;
    });
    if (previousSelection) accountSelect.value = previousSelection;
});

AdminStore.subscribeToExpenses((expenses) => {
    adminExpensesCache = expenses;
    renderExpensesFromMemory();
});

// ==========================================================================
// 1. INICIALIZACIÓN Y FILTROS LOCALES (RAM)
// ==========================================================================

function init() {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    filterMonthInput.value = `${yyyy}-${mm}`;
    currentFilterDate = new Date(yyyy, now.getMonth(), 1); 
    
    // AdminStore ya inicializó la descarga en background, solo esperamos a que llame al render.
}

filterMonthInput.addEventListener('change', (e) => {
    if(e.target.value) {
        const [y, m] = e.target.value.split('-');
        currentFilterDate = new Date(y, m - 1, 1);
    } else {
        currentFilterDate = null;
    }
    currentPage = 1;
    renderExpensesFromMemory();
});

btnClearDate.addEventListener('click', () => {
    filterMonthInput.value = "";
    currentFilterDate = null;
    currentPage = 1;
    renderExpensesFromMemory();
});

searchInput.addEventListener('input', () => {
    currentPage = 1;
    renderExpensesFromMemory();
});

window.loadMoreExpenses = () => {
    currentPage++;
    renderExpensesFromMemory();
};

function renderExpensesFromMemory() {
    if (!listContainer) return;

    let filtered = adminExpensesCache;
    const term = searchInput.value.toLowerCase().trim();

    // 1. Aplicar Filtro de Mes
    if (currentFilterDate) {
        const start = currentFilterDate;
        const end = new Date(currentFilterDate.getFullYear(), currentFilterDate.getMonth() + 1, 0, 23, 59, 59);
        filtered = filtered.filter(e => e.dateObj >= start && e.dateObj <= end);
    }

    // 2. Aplicar Búsqueda por Texto
    if (term.length > 0) {
        filtered = filtered.filter(e => 
            (e.supplierName || "").toLowerCase().includes(term) || 
            (e.description || "").toLowerCase().includes(term)
        );
    }

    // 3. Actualizar Estadísticas (KPI Superior)
    const totalPeriod = filtered.reduce((sum, item) => sum + cleanNumber(item.amount), 0);
    document.getElementById('stats-total').textContent = `$${Math.round(totalPeriod).toLocaleString('es-CO')}`;
    
    if (currentFilterDate) {
        const monthName = currentFilterDate.toLocaleString('es-CO', { month: 'long' });
        lblPeriodTotal.textContent = `Total ${monthName}`.toUpperCase();
    } else {
        lblPeriodTotal.textContent = "TOTAL HISTÓRICO";
    }

    // 4. Paginación y Renderizado
    listContainer.innerHTML = "";
    
    if (filtered.length === 0) {
        listContainer.innerHTML = `<tr><td colspan="7" class="p-8 text-center text-gray-400 text-xs font-bold uppercase">No se encontraron gastos.</td></tr>`;
        loadMoreBtn.classList.add('hidden');
        return;
    }

    const endIdx = currentPage * PAGE_SIZE;
    const pageExpenses = filtered.slice(0, endIdx);

    const html = pageExpenses.map(item => `
        <tr class="hover:bg-slate-50 transition border-b border-gray-50 last:border-0 group fade-in">
            <td class="px-6 py-4 text-gray-500 font-mono text-xs">${item.dateObj.toLocaleDateString('es-CO')}</td>
            <td class="px-6 py-4 font-bold text-xs uppercase">${item.supplierName || 'General'}</td>
            <td class="px-6 py-4 text-xs text-brand-black">${item.description}</td>
            <td class="px-6 py-4"><span class="bg-gray-100 px-2 py-1 rounded text-[9px] font-black uppercase text-gray-500">${item.category}</span></td>
            <td class="px-6 py-4 text-xs font-bold text-brand-cyan">${item.paymentMethod || '---'}</td>
            <td class="px-6 py-4 text-right font-black ${item.amount < 0 ? 'text-green-500' : 'text-brand-black'}">$${Math.abs(Number(item.amount)).toLocaleString('es-CO')}</td>
            <td class="px-6 py-4 text-center">
                <button onclick="window.deleteExpense('${item.id}')" class="w-8 h-8 rounded-lg bg-red-50 text-red-500 hover:bg-red-500 hover:text-white transition shadow-sm opacity-0 group-hover:opacity-100" title="Borrar (Mover a Papelera)">
                    <i class="fa-solid fa-trash text-xs"></i>
                </button>
            </td>
        </tr>`).join('');

    listContainer.innerHTML = html;

    if (endIdx < filtered.length) {
        loadMoreBtn.classList.remove('hidden');
        loadMoreBtn.querySelector('button').innerHTML = `<i class="fa-solid fa-circle-plus"></i> Cargar siguientes 50 (${endIdx}/${filtered.length})`;
    } else {
        loadMoreBtn.classList.add('hidden');
    }
}

// ==========================================================================
// ELIMINAR GASTOS Y PAPELERA
// ==========================================================================

window.deleteExpense = async (id) => {
    if (!confirm("⚠️ ¿Estás seguro?\n\n1. Se devolverá el dinero a la cuenta.\n2. Si es pago a proveedor, la deuda volverá a aparecer.\n3. El registro irá a la papelera.")) return;

    try {
        const expenseSnap = await getDoc(doc(db, "expenses", id));
        if (!expenseSnap.exists()) throw "El documento no existe.";
        
        const expenseData = expenseSnap.data();
        const amountToReverse = Number(expenseData.amount);
        const accountName = expenseData.paymentMethod;
        const supplierName = expenseData.supplierName;
        
        const isSupplierPayment = expenseData.category === "Pago Proveedores" || expenseData.category === "Logística" || expenseData.category === "Inventario"; 

        const accountRef = accountsList.find(a => a.name === accountName)?.id;
        if (!accountRef) throw "La cuenta bancaria vinculada a este gasto ya no existe.";

        let payablesToReopen = [];
        if (isSupplierPayment && supplierName) {
            // Buscamos directamente en Firebase, porque las deudas de proveedores tienen una paginación especial.
            const payQuerySimple = query(collection(db, "payables"), where("provider", "==", supplierName), where("amountPaid", ">", 0));
            const pSnap = await getDocs(payQuerySimple);
            
            const docs = pSnap.docs.map(d => ({...d.data(), id: d.id, ref: d.ref}));
            docs.sort((a, b) => {
                const dateA = a.lastPaymentDate?.seconds || a.createdAt?.seconds || 0;
                const dateB = b.lastPaymentDate?.seconds || b.createdAt?.seconds || 0;
                return dateB - dateA; 
            });
            
            let remainingReverse = amountToReverse;
            
            for (const p of docs) {
                if (remainingReverse <= 0) break;
                
                const paidInThisDoc = cleanNumber(p.amountPaid);
                const amountToSubtract = Math.min(remainingReverse, paidInThisDoc);
                
                payablesToReopen.push({
                    ref: p.ref,
                    currentPaid: paidInThisDoc,
                    currentTotal: cleanNumber(p.total),
                    subtract: amountToSubtract
                });
                
                remainingReverse -= amountToSubtract;
            }
        }

        await runTransaction(db, async (t) => {
            const accRefDoc = doc(db, "accounts", accountRef);
            const accDoc = await t.get(accRefDoc);
            
            if (accDoc.exists()) {
                const currentBal = Number(accDoc.data().balance);
                t.update(accRefDoc, { balance: currentBal + amountToReverse });
            }

            for (const item of payablesToReopen) {
                const newPaid = item.currentPaid - item.subtract;
                const newBalance = item.currentTotal - newPaid;
                
                t.update(item.ref, {
                    amountPaid: newPaid,
                    balance: newBalance,
                    status: newPaid === 0 ? 'PENDING' : 'PARTIAL', 
                    updatedAt: new Date() // Trigger al caché central
                });
            }

            const trashRef = doc(db, "expenses_trash", id);
            t.set(trashRef, {
                ...expenseData,
                deletedAt: Timestamp.now(),
                deletedBy: getCurrentAdminName(),
                reversalType: isSupplierPayment ? "FULL_REVERSAL" : "REFUND_ONLY",
                originalCollection: "expenses"
            });

            t.delete(doc(db, "expenses", id));
        });

        let msg = `✅ Gasto eliminado y $${amountToReverse.toLocaleString()} devueltos a ${accountName}.`;
        if (payablesToReopen.length > 0) {
            msg += `\n\n🔄 Se reactivó la deuda en ${payablesToReopen.length} factura(s) de ${supplierName}.`;
        }
        alert(msg);
        
    } catch (e) {
        console.error(e);
        let errText = e.message || e;
        alert("Error al reversar: " + errText);
    }
};

window.openTrashModal = async () => {
    trashModal.classList.remove('hidden');
    trashList.innerHTML = `<tr><td colspan="4" class="p-8 text-center"><i class="fa-solid fa-circle-notch fa-spin"></i> Cargando logs...</td></tr>`;

    try {
        const q = query(collection(db, "expenses_trash"), orderBy("deletedAt", "desc"), limit(50));
        const snap = await getDocs(q);

        trashList.innerHTML = "";
        if (snap.empty) {
            trashList.innerHTML = `<tr><td colspan="4" class="p-8 text-center text-gray-400 text-xs font-bold uppercase">Papelera vacía.</td></tr>`;
            return;
        }

        snap.forEach(d => {
            const item = d.data();
            const delDate = item.deletedAt?.toDate().toLocaleString('es-CO') || '--';
            const origDate = item.date?.toDate().toLocaleDateString('es-CO') || '--';

            trashList.innerHTML += `
                <tr class="border-b border-gray-50 last:border-0 hover:bg-red-50/30">
                    <td class="p-3 font-mono text-[10px] text-gray-500">
                        <div class="font-bold text-brand-red">${delDate}</div>
                        <div class="text-[9px] text-gray-300">ID: ${d.id.slice(0,6)}</div>
                    </td>
                    <td class="p-3 text-xs font-bold text-brand-black uppercase">${item.deletedBy || 'Desconocido'}</td>
                    <td class="p-3">
                        <p class="text-xs font-bold text-gray-600">${item.description}</p>
                        <p class="text-[9px] text-gray-400">Prov: ${item.supplierName} • Fecha Orig: ${origDate}</p>
                    </td>
                    <td class="p-3 text-right text-xs font-black text-gray-400 line-through decoration-red-300">
                        $${Number(item.amount).toLocaleString('es-CO')}
                    </td>
                </tr>
            `;
        });

    } catch (e) {
        console.error(e);
        trashList.innerHTML = `<tr><td colspan="4" class="p-8 text-center text-red-400">Error cargando papelera.</td></tr>`;
    }
};

// ==========================================================================
// FORMULARIO Y CREACIÓN DE GASTOS
// ==========================================================================

let supplierTimeout = null;
supplierSearch.addEventListener('input', (e) => {
    const term = e.target.value.trim();
    selectedSupplierId.value = "";
    supplierDropdown.innerHTML = `<div class="p-3 text-xs text-gray-400"><i class="fa-solid fa-spinner fa-spin"></i></div>`;
    supplierDropdown.classList.remove('hidden');

    if (term.length < 1) { supplierDropdown.classList.add('hidden'); return; }

    clearTimeout(supplierTimeout);
    supplierTimeout = setTimeout(async () => {
        try {
            const termCap = term.charAt(0).toUpperCase() + term.slice(1).toLowerCase();
            const q = query(collection(db, "suppliers"), orderBy('name'), startAt(termCap), endAt(termCap + '\uf8ff'), limit(5));
            const snap = await getDocs(q);
            
            supplierDropdown.innerHTML = "";
            const divGen = document.createElement('div');
            divGen.className = "p-3 hover:bg-slate-50 cursor-pointer text-xs font-bold text-gray-500 border-b border-gray-50 italic";
            divGen.textContent = "-- Gasto General / Varios --";
            divGen.onclick = () => {
                supplierSearch.value = "General / Varios";
                selectedSupplierId.value = "general";
                supplierDropdown.classList.add('hidden');
            };
            supplierDropdown.appendChild(divGen);

            snap.forEach(d => {
                const s = d.data();
                const item = document.createElement('div');
                item.className = "p-3 hover:bg-slate-50 cursor-pointer text-xs font-bold text-brand-black border-b border-gray-50 last:border-0 transition-colors";
                item.textContent = s.name;
                item.onclick = () => {
                    supplierSearch.value = s.name;
                    selectedSupplierId.value = d.id;
                    supplierDropdown.classList.add('hidden');
                };
                supplierDropdown.appendChild(item);
            });
        } catch(e) { console.error(e); }
    }, 300);
});

amountDisplay.addEventListener('input', (e) => {
    let value = e.target.value.replace(/\D/g, "");
    if (value === "") { e.target.value = ""; checkTax(); return; }
    e.target.value = "$" + parseInt(value, 10).toLocaleString('es-CO');
    checkTax();
});

function getCleanAmount() {
    const raw = amountDisplay.value.replace(/\D/g, "");
    return raw ? parseInt(raw, 10) : 0;
}

function checkTax() {
    const accId = accountSelect.value;
    const amount = getCleanAmount();
    const acc = accountsList.find(a => a.id === accId);
    if (acc && acc.type === 'banco' && !acc.isExempt && amount > 0) {
        const tax = Math.ceil(amount * 0.004);
        document.getElementById('tax-val').textContent = `$${tax.toLocaleString('es-CO')}`;
        taxAlert.classList.remove('hidden');
    } else {
        taxAlert.classList.add('hidden');
    }
}
accountSelect.addEventListener('change', checkTax);

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btn-save');
    btn.disabled = true; btn.innerText = "Procesando...";

    const supplierId = selectedSupplierId.value;
    const supplierName = supplierSearch.value;
    const desc = document.getElementById('desc').value;
    const amount = getCleanAmount();
    const dateVal = document.getElementById('date').value;
    const category = document.getElementById('category').value;
    const accountId = accountSelect.value;
    const accountName = accountSelect.options[accountSelect.selectedIndex].text.split(' (')[0];

    if(!supplierName || amount <= 0 || !accountId) { alert("Datos incompletos"); btn.disabled=false; btn.innerText = "Registrar Gasto"; return; }

    const dateParts = dateVal.split('-');
    const localDate = new Date(dateParts[0], dateParts[1] - 1, dateParts[2]);

    try {
        await runTransaction(db, async (t) => {
            const accRef = doc(db, "accounts", accountId);
            const accDoc = await t.get(accRef);
            if(!accDoc.exists()) throw "La cuenta no existe.";
            const accData = accDoc.data();
            
            let tax = 0;
            if (accData.type === 'banco' && !accData.isExempt) tax = Math.ceil(amount * 0.004);

            const totalDeduction = amount + tax;
            if (accData.balance < totalDeduction) throw `Saldo insuficiente en ${accData.name}.`;

            t.update(accRef, { balance: accData.balance - totalDeduction });

            if (tax > 0) {
                t.set(doc(collection(db, "expenses")), {
                    description: `4x1000 ${desc}`,
                    amount: tax,
                    type: 'EXPENSE',
                    category: "Impuestos",
                    paymentMethod: accountName,
                    date: Timestamp.fromDate(localDate),
                    createdAt: Timestamp.now(), // Store escucha esto
                    supplierName: "DIAN / Banco"
                });
            }

            t.set(doc(collection(db, "expenses")), {
                supplierId: (!supplierId || supplierId === 'general') ? null : supplierId,
                supplierName: supplierName,
                description: desc,
                category: category,
                amount: amount,
                type: 'EXPENSE',
                paymentMethod: accountName,
                date: Timestamp.fromDate(localDate),
                createdAt: Timestamp.now() // Store escucha esto
            });
        });

        alert("✅ Gasto registrado");
        window.closeModal();

    } catch (error) { alert("Error: " + error.message); } 
    finally { btn.disabled = false; btn.innerText = "Registrar Gasto"; }
});

window.openModal = () => {
    form.reset();
    supplierSearch.value = "";
    selectedSupplierId.value = "";
    amountDisplay.value = "";
    document.getElementById('date').valueAsDate = new Date();
    taxAlert.classList.add('hidden');
    modal.classList.remove('hidden');
};
window.closeModal = () => modal.classList.add('hidden');

init();