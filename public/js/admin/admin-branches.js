// public/js/admin/admin-branches.js
import { db, collection, addDoc, doc, getDocs, getDoc, updateDoc, setDoc, query, orderBy, where, runTransaction, auth } from '../firebase-init.js';
import { loadAdminSidebar } from './admin-ui.js';
import { adjustStock } from './inventory-core.js';
import { AdminStore } from './admin-store.js'; // 🔥 IMPORTAMOS EL CEREBRO CENTRAL

// --- ESTADO LOCAL ---
let branchesList = [];
let accountsList = [];
let cachedProducts = [];
let cachedPurchases = [];
let cachedOrders = [];
let currentTab = 'branches';
let currentValuationMode = 'sale'; // 'sale' o 'cost'

const tabs = {
    branches: { btn: document.getElementById('tab-branches'), sec: document.getElementById('sec-branches'), act: document.getElementById('btn-new-branch') },
    closings: { btn: document.getElementById('tab-closings'), sec: document.getElementById('sec-closings'), act: document.getElementById('btn-new-cierre') },
    transfers: { btn: document.getElementById('tab-transfers'), sec: document.getElementById('sec-transfers'), act: document.getElementById('btn-new-transfer') },
    inventory: { btn: document.getElementById('tab-inventory'), sec: document.getElementById('sec-inventory'), act: null }
};

function switchTab(targetTab) {
    currentTab = targetTab;
    const role = sessionStorage.getItem('adminUserRole');

    Object.keys(tabs).forEach(k => {
        const t = tabs[k];
        if (k === targetTab) {
            t.btn.classList.add('active', 'bg-brand-orange', 'text-brand-black');
            t.btn.classList.remove('text-gray-500');
            t.sec.classList.remove('hidden');
            t.sec.classList.add('block');
            
            // Mostrar botón de acción si corresponde
            if (t.act) {
                if (k === 'branches') {
                    if (role === 'admin') {
                        t.act.classList.remove('hidden');
                        t.act.style.display = 'flex';
                    } else {
                        t.act.classList.add('hidden');
                        t.act.style.display = 'none';
                    }
                } else {
                    t.act.classList.remove('hidden');
                    t.act.style.display = 'flex';
                }
            }
        } else {
            t.btn.classList.remove('active', 'bg-brand-orange', 'text-brand-black');
            t.btn.classList.add('text-gray-500');
            t.sec.classList.add('hidden');
            t.sec.classList.remove('block');
            if (t.act) {
                t.act.classList.add('hidden');
                t.act.style.display = 'none';
            }
        }
    });

    if (targetTab === 'branches') {
        loadBranches();
    } else if (targetTab === 'closings') {
        loadClosings();
    } else if (targetTab === 'transfers') {
        loadTransfers();
    } else if (targetTab === 'inventory') {
        loadInventoryTab();
    }
}

// Escuchar clics en pestañas
Object.keys(tabs).forEach(k => {
    if (tabs[k].btn) {
        tabs[k].btn.addEventListener('click', () => switchTab(k));
    }
});

// ==========================================================================
// 1. MÓDULO: SEDES FÍSICAS (CRUD)
// ==========================================================================
async function loadBranches() {
    const tbody = document.getElementById('branches-table-body');
    tbody.innerHTML = `<tr><td colspan="4" class="p-10 text-center"><i class="fa-solid fa-circle-notch fa-spin text-brand-orange text-2xl"></i> Cargando sedes...</td></tr>`;
    
    try {
        const bSnap = await getDocs(collection(db, "branches"));
        branchesList = [];
        bSnap.forEach(d => {
            branchesList.push({ id: d.id, ...d.data() });
        });

        // Cargar cuentas para select
        const aSnap = await getDocs(collection(db, "accounts"));
        accountsList = [];
        const accountMap = {};
        const accountSelect = document.getElementById('branch-account-id');
        accountSelect.innerHTML = '<option value="">-- Sin Vincular --</option>';
        
        aSnap.forEach(d => {
            const acc = d.data();
            accountsList.push({ id: d.id, ...acc });
            accountMap[d.id] = acc.name || d.id;
            accountSelect.innerHTML += `<option value="${d.id}">${acc.name || d.id}</option>`;
        });

        tbody.innerHTML = '';
        if (branchesList.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" class="p-10 text-center text-gray-400">No hay sedes registradas.</td></tr>`;
            return;
        }

        const role = sessionStorage.getItem('adminUserRole');
        const canEdit = role === 'admin';

        branchesList.forEach(branch => {
            const accName = branch.accountId ? (accountMap[branch.accountId] || branch.accountId) : '<span class="text-red-400 font-bold uppercase text-[10px]">Sin vincular</span>';
            const tr = document.createElement('tr');
            tr.className = "hover:bg-slate-50 transition border-b border-gray-50 last:border-0";
            tr.innerHTML = `
                <td class="px-6 py-4 font-black text-xs text-brand-black uppercase">${branch.id}</td>
                <td class="px-6 py-4 font-bold text-xs uppercase text-gray-600">${branch.name}</td>
                <td class="px-6 py-4 text-xs font-bold text-gray-500">${accName}</td>
                <td class="px-6 py-4 text-center">
                    ${canEdit ? `
                        <button onclick="window.editBranch('${branch.id}')" class="w-8 h-8 rounded-lg bg-orange-50 text-brand-orange hover:bg-brand-orange hover:text-black transition shadow-sm" title="Editar Sede">
                            <i class="fa-solid fa-pen text-[10px]"></i>
                        </button>
                    ` : '<span class="text-gray-300 text-xs italic">Sólo Admin</span>'}
                </td>
            `;
            tbody.appendChild(tr);
        });
    } catch (e) {
        console.error("Error loading branches:", e);
        tbody.innerHTML = `<tr><td colspan="4" class="p-10 text-center text-red-500 font-bold">Error al cargar sedes: ${e.message}</td></tr>`;
    }
}

window.editBranch = (id) => {
    const branch = branchesList.find(b => b.id === id);
    if (!branch) return;
    document.getElementById('edit-branch-id').value = branch.id;
    document.getElementById('branch-id').value = branch.id;
    document.getElementById('branch-id').readOnly = true;
    document.getElementById('branch-id').classList.add('bg-gray-100', 'text-gray-400', 'cursor-not-allowed');
    document.getElementById('branch-name').value = branch.name || '';
    document.getElementById('branch-account-id').value = branch.accountId || '';
    document.getElementById('branch-modal-title').innerHTML = `Editar Sede <span class="text-brand-orange">${branch.name}</span>`;
    document.getElementById('branch-modal').classList.remove('hidden');
};

document.getElementById('btn-new-branch').onclick = () => {
    document.getElementById('edit-branch-id').value = '';
    document.getElementById('branch-id').value = '';
    document.getElementById('branch-id').readOnly = false;
    document.getElementById('branch-id').classList.remove('bg-gray-100', 'text-gray-400', 'cursor-not-allowed');
    document.getElementById('branch-name').value = '';
    document.getElementById('branch-account-id').value = '';
    document.getElementById('branch-modal-title').innerHTML = `Nueva <span class="text-brand-orange">Sede Física</span>`;
    document.getElementById('branch-modal').classList.remove('hidden');
};

document.getElementById('branch-form').onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    const originalText = btn.innerText;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin mr-2"></i> GUARDANDO...';

    const editId = document.getElementById('edit-branch-id').value;
    const branchId = document.getElementById('branch-id').value.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
    const branchName = document.getElementById('branch-name').value.trim();
    const accountId = document.getElementById('branch-account-id').value;

    if (!branchId || !branchName) {
        alert("Todos los campos obligatorios deben completarse.");
        btn.disabled = false;
        btn.innerText = originalText;
        return;
    }

    try {
        const branchRef = doc(db, "branches", editId || branchId);
        
        await setDoc(branchRef, {
            name: branchName,
            accountId: accountId || null,
            updatedAt: new Date()
        }, { merge: true });

        showToast("Sede guardada con éxito");
        document.getElementById('branch-modal').classList.add('hidden');
        loadBranches();
    } catch (err) {
        console.error("Error saving branch:", err);
        alert("Error: " + err.message);
    } finally {
        btn.disabled = false;
        btn.innerText = originalText;
    }
};

// ==========================================================================
// 2. MÓDULO: CIERRE DE CAJA
// ==========================================================================
async function loadClosings() {
    const tbody = document.getElementById('closings-table-body');
    tbody.innerHTML = `<tr><td colspan="8" class="p-10 text-center"><i class="fa-solid fa-circle-notch fa-spin text-brand-orange text-2xl"></i> Cargando cierres...</td></tr>`;

    try {
        const q = query(collection(db, "cash_closings"), orderBy("closedAt", "desc"));
        const snap = await getDocs(q);

        tbody.innerHTML = '';
        if (snap.empty) {
            tbody.innerHTML = `<tr><td colspan="8" class="p-10 text-center text-gray-400">No hay cierres de caja registrados en esta sede.</td></tr>`;
            return;
        }

        snap.forEach(d => {
            const c = d.data();
            const date = c.closedAt?.toDate ? c.closedAt.toDate().toLocaleString('es-CO') : '---';
            const diffClass = c.difference === 0 ? 'text-green-500 font-bold' : (c.difference > 0 ? 'text-blue-500 font-bold' : 'text-red-500 font-bold');
            const diffPrefix = c.difference > 0 ? '+' : '';
            
            const tr = document.createElement('tr');
            tr.className = "hover:bg-slate-50 transition border-b border-gray-50 last:border-0";
            tr.innerHTML = `
                <td class="px-6 py-4 font-bold text-xs text-gray-400">${date}</td>
                <td class="px-6 py-4 font-black text-xs text-brand-black uppercase">${c.branchName || c.branchId}</td>
                <td class="px-6 py-4 font-bold text-xs text-gray-500 uppercase">${c.accountName || c.accountId || 'Ninguna'}</td>
                <td class="px-6 py-4 font-bold text-xs text-right text-gray-600">$${Math.round(c.openingBalance || 0).toLocaleString('es-CO')}</td>
                <td class="px-6 py-4 font-bold text-xs text-right text-brand-black">$${Math.round(c.physicalBalanceCounted || 0).toLocaleString('es-CO')}</td>
                <td class="px-6 py-4 font-black text-xs text-right ${diffClass}">${diffPrefix}$${Math.round(c.difference || 0).toLocaleString('es-CO')}</td>
                <td class="px-6 py-4 text-xs font-bold text-gray-500 uppercase">${c.closedBy || '---'}</td>
                <td class="px-6 py-4 text-xs font-medium text-gray-400 max-w-xs truncate" title="${c.notes || ''}">${c.notes || '---'}</td>
            `;
            tbody.appendChild(tr);
        });
    } catch (e) {
        console.error("Error loading closings:", e);
        tbody.innerHTML = `<tr><td colspan="8" class="p-10 text-center text-red-500 font-bold">Error al cargar cierres de caja: ${e.message}</td></tr>`;
    }
}

function updateCierreAccountDetails(accountId) {
    const acc = accountsList.find(a => a.id === accountId);
    if (!acc) return;

    const expectedBalance = acc.balance || 0;
    document.getElementById('cierre-expected-value').value = expectedBalance;
    document.getElementById('cierre-expected-display').value = `$${Math.round(expectedBalance).toLocaleString('es-CO')}`;

    // Recalcular diferencia y excedente
    recalculateCierreAmounts();

    // Actualizar el dropdown de cuentas destino
    const transferDestSelect = document.getElementById('cierre-transfer-dest');
    transferDestSelect.innerHTML = '<option value="">-- No Transferir (Dejar todo en cuenta) --</option>';
    accountsList.forEach(otherAcc => {
        if (otherAcc.id !== accountId) {
            const balFormatted = Math.round(otherAcc.balance || 0).toLocaleString('es-CO');
            transferDestSelect.innerHTML += `<option value="${otherAcc.id}">🏦 DEPOSITAR EN: ${otherAcc.name} ($${balFormatted})</option>`;
        }
    });
}

document.getElementById('btn-new-cierre').onclick = async () => {
    const activeBranchId = sessionStorage.getItem('activeBranchId');
    if (!activeBranchId) {
        alert("No se ha detectado una sede activa. Recarga la página.");
        return;
    }

    const role = sessionStorage.getItem('adminUserRole');
    const branchNameInput = document.getElementById('cierre-branch-name');
    const branchSelect = document.getElementById('cierre-branch-select');

    // Configurar visibilidad y opciones según el rol
    if (role === 'admin') {
        branchNameInput.classList.add('hidden');
        branchSelect.classList.remove('hidden');
        
        branchSelect.innerHTML = '';
        branchesList.forEach(b => {
            branchSelect.innerHTML += `<option value="${b.id}">${b.name}</option>`;
        });
        branchSelect.value = activeBranchId;
        
        branchSelect.onchange = async () => {
            await loadCierreForBranch(branchSelect.value);
        };
    } else {
        branchNameInput.classList.remove('hidden');
        branchSelect.classList.add('hidden');
    }

    const loadCierreForBranch = async (selectedBranchId) => {
        try {
            document.getElementById('cierre-branch-id').value = selectedBranchId;

            // Cargar detalles de la sede
            const branchSnap = await getDoc(doc(db, "branches", selectedBranchId));
            const branch = branchSnap.exists() ? branchSnap.data() : { name: selectedBranchId };
            const branchName = branch.name || selectedBranchId;
            
            // Sincronizar input de nombre (para el guardado final)
            branchNameInput.value = branchName;

            // Cargar cuentas vinculadas y globales para el select
            const accountSelect = document.getElementById('cierre-account-id');
            accountSelect.innerHTML = '';

            // Filtrar cuentas: asociadas a la sede seleccionada o globales
            const filteredAccounts = accountsList.filter(acc => {
                const accBranchId = acc.branchId || 'ALL';
                return accBranchId === selectedBranchId || accBranchId === 'ALL';
            });

            if (filteredAccounts.length === 0) {
                accountSelect.innerHTML = '<option value="">-- Sin Cuentas Disponibles --</option>';
                document.getElementById('cierre-expected-value').value = 0;
                document.getElementById('cierre-expected-display').value = '$ 0';
                recalculateCierreAmounts();
                return;
            }

            filteredAccounts.forEach(acc => {
                const isGlobal = !acc.branchId || acc.branchId === 'ALL';
                const badge = isGlobal ? 'GLOBAL' : 'SEDE';
                accountSelect.innerHTML += `<option value="${acc.id}">💳 [${badge}] ${acc.name}</option>`;
            });

            accountSelect.onchange = (e) => {
                updateCierreAccountDetails(e.target.value);
            };

            const defaultAccountId = branch.accountId && filteredAccounts.some(a => a.id === branch.accountId)
                ? branch.accountId 
                : filteredAccounts[0].id;
            
            accountSelect.value = defaultAccountId;
            updateCierreAccountDetails(defaultAccountId);
        } catch (err) {
            console.error("Error al cargar cierre para sede:", err);
            alert("Error al cargar la información de la sede: " + err.message);
        }
    };

    try {
        document.getElementById('cierre-physical').value = '';
        document.getElementById('cierre-difference-display').value = '$0';
        document.getElementById('cierre-difference-display').className = 'w-full bg-gray-100 text-gray-400 border border-gray-200 p-4 rounded-2xl text-xs font-black outline-none cursor-not-allowed text-right';
        document.getElementById('cierre-notes').value = '';

        document.getElementById('cierre-base').value = '$0';
        document.getElementById('cierre-transfer-amount').value = '$0';

        // Cargar los detalles para la sede seleccionada inicialmente
        await loadCierreForBranch(activeBranchId);

        document.getElementById('cierre-modal').classList.remove('hidden');
    } catch (e) {
        console.error("Error initializing cierre:", e);
        alert("Error al inicializar el cierre: " + e.message);
    }
};

function recalculateCierreAmounts() {
    const expectedVal = parseFloat(document.getElementById('cierre-expected-value').value) || 0;
    
    let physicalStr = document.getElementById('cierre-physical').value.replace(/\D/g, "");
    const physicalVal = physicalStr === "" ? 0 : parseInt(physicalStr, 10);
    
    let baseStr = document.getElementById('cierre-base').value.replace(/\D/g, "");
    const baseVal = baseStr === "" ? 0 : parseInt(baseStr, 10);

    // 1. Diferencia
    const diff = physicalVal - expectedVal;
    const diffEl = document.getElementById('cierre-difference-display');
    const diffText = (diff > 0 ? "+" : "") + "$" + Math.round(diff).toLocaleString('es-CO');
    diffEl.value = diffText;

    if (diff === 0) {
        diffEl.className = 'w-full bg-green-50 text-green-600 border border-green-200 p-4 rounded-2xl text-xs font-black outline-none cursor-not-allowed text-right';
    } else if (diff > 0) {
        diffEl.className = 'w-full bg-blue-50 text-blue-600 border border-blue-200 p-4 rounded-2xl text-xs font-black outline-none cursor-not-allowed text-right';
    } else {
        diffEl.className = 'w-full bg-red-50 text-red-600 border border-red-200 p-4 rounded-2xl text-xs font-black outline-none cursor-not-allowed text-right';
    }

    // 2. Excedente
    const surplus = Math.max(0, physicalVal - baseVal);
    document.getElementById('cierre-transfer-amount').value = "$" + surplus.toLocaleString('es-CO');
}

const physicalInput = document.getElementById('cierre-physical');
const baseInput = document.getElementById('cierre-base');

physicalInput.oninput = (e) => {
    let val = e.target.value.replace(/\D/g, "");
    if (val === "") {
        e.target.value = "";
    } else {
        e.target.value = "$" + parseInt(val, 10).toLocaleString('es-CO');
    }
    recalculateCierreAmounts();
};

baseInput.oninput = (e) => {
    let val = e.target.value.replace(/\D/g, "");
    if (val === "") {
        e.target.value = "";
    } else {
        e.target.value = "$" + parseInt(val, 10).toLocaleString('es-CO');
    }
    recalculateCierreAmounts();
};

document.getElementById('cierre-form').onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    const originalText = btn.innerText;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin mr-2"></i> PROCESANDO...';

    const branchId = document.getElementById('cierre-branch-id').value;
    const branchName = document.getElementById('cierre-branch-name').value;
    const accountId = document.getElementById('cierre-account-id').value;

    const acc = accountsList.find(a => a.id === accountId);
    const accountName = acc ? acc.name : accountId;

    const expected = parseFloat(document.getElementById('cierre-expected-value').value) || 0;
    const physical = parseFloat(document.getElementById('cierre-physical').value.replace(/[^\d]/g, "")) || 0;
    const baseVal = parseFloat(document.getElementById('cierre-base').value.replace(/[^\d]/g, "")) || 0;
    const surplus = Math.max(0, physical - baseVal);
    const transferDestId = document.getElementById('cierre-transfer-dest').value;

    let destAccountName = '';
    if (transferDestId) {
        const destAcc = accountsList.find(a => a.id === transferDestId);
        destAccountName = destAcc ? destAcc.name : transferDestId;
    }

    const diff = physical - expected;
    const notes = document.getElementById('cierre-notes').value.trim();

    try {
        await runTransaction(db, async (t) => {
            // 1. Obtener la cuenta origen
            const accRef = doc(db, "accounts", accountId);
            const accSnap = await t.get(accRef);
            if (!accSnap.exists()) throw `La cuenta ${accountId} no existe`;

            const currentBalance = accSnap.data().balance || 0;

            // 2. Obtener la cuenta destino si aplica (READ)
            let destAccRef = null;
            let destAccSnap = null;
            let destCurrentBalance = 0;
            if (transferDestId && surplus > 0) {
                destAccRef = doc(db, "accounts", transferDestId);
                destAccSnap = await t.get(destAccRef);
                if (!destAccSnap.exists()) throw `La cuenta de destino no existe`;
                destCurrentBalance = destAccSnap.data().balance || 0;
            }
            
            // 3. Guardar el Cierre (WRITE)
            const closingRef = doc(collection(db, "cash_closings"));
            t.set(closingRef, {
                branchId,
                branchName,
                accountId,
                accountName,
                openingBalance: expected,
                systemExpectedBalance: expected,
                physicalBalanceCounted: physical,
                difference: diff,
                baseBalance: baseVal,
                transferredAmount: (transferDestId && surplus > 0) ? surplus : 0,
                transferDestinationAccountId: transferDestId || null,
                transferDestinationAccountName: destAccountName || null,
                closedBy: (sessionStorage.getItem('adminUserRole') || 'empleado') + " - " + (auth.currentUser ? auth.currentUser.email : "Anónimo"),
                closedAt: new Date(),
                notes
            });

            // 4. Si hay diferencia, crear ajuste de caja (WRITE)
            let balanceAfterAdjustment = currentBalance;
            if (diff !== 0) {
                const isFaltante = diff < 0;
                const adjustmentAmount = Math.abs(diff);
                const expRef = doc(collection(db, "expenses"));
                
                t.set(expRef, {
                    description: `Ajuste Automático por Arqueo Sede: ${branchName} (${isFaltante ? 'FALTANTE' : 'SOBRANTE'})`,
                    amount: adjustmentAmount,
                    type: isFaltante ? 'EXPENSE' : 'INCOME',
                    category: 'Ajuste de Caja',
                    paymentMethod: accountName,
                    date: new Date(),
                    createdAt: new Date(),
                    supplierName: branchName,
                    notes: `Arqueo de caja realizado. Notas: ${notes}`
                });

                balanceAfterAdjustment = isFaltante ? (currentBalance - adjustmentAmount) : (currentBalance + adjustmentAmount);
            }

            // 5. Si se seleccionó destino y excedente > 0, transferir excedente (WRITE)
            let finalSourceBalance = balanceAfterAdjustment;
            if (transferDestId && surplus > 0) {
                // Restar excedente de la cuenta origen
                finalSourceBalance = balanceAfterAdjustment - surplus;
                
                // Sumar excedente a la cuenta destino
                const finalDestBalance = destCurrentBalance + surplus;

                t.update(destAccRef, { balance: finalDestBalance });

                // Crear registro de Gasto (Transfer Saliente)
                const outRef = doc(collection(db, "expenses"));
                t.set(outRef, {
                    description: `Traslado de Excedente de Arqueo Sede: ${branchName} a ${destAccountName}`,
                    amount: surplus,
                    type: 'EXPENSE',
                    category: 'Traslado de Caja',
                    paymentMethod: accountName,
                    date: new Date(),
                    createdAt: new Date(),
                    supplierName: branchName,
                    notes: `Arqueo y retiro de excedente. Notas: ${notes}`
                });

                // Crear registro de Ingreso (Transfer Entrante)
                const inRef = doc(collection(db, "expenses"));
                t.set(inRef, {
                    description: `Traslado de Excedente de Arqueo Sede: ${branchName} a ${destAccountName}`,
                    amount: surplus,
                    type: 'INCOME',
                    category: 'Traslado de Caja',
                    paymentMethod: destAccountName,
                    date: new Date(),
                    createdAt: new Date(),
                    supplierName: branchName,
                    notes: `Arqueo y depósito de excedente. Notas: ${notes}`
                });
            }

            // Actualizar la cuenta origen con su saldo final (WRITE)
            t.update(accRef, { balance: finalSourceBalance });
        });

        showToast("Arqueo, cierre de caja y transferencia procesados correctamente.");
        document.getElementById('cierre-modal').classList.add('hidden');
        
        setTimeout(() => {
            loadClosings();
        }, 1000);

    } catch (err) {
        console.error("Error registering cash closing:", err);
        alert("Error al registrar cierre de caja: " + err.message);
    } finally {
        btn.disabled = false;
        btn.innerText = originalText;
    }
};

// ==========================================================================
// 3. MÓDULO: TRASLADOS DE STOCK
// ==========================================================================
async function loadTransfers() {
    const tbody = document.getElementById('transfers-table-body');
    tbody.innerHTML = `<tr><td colspan="8" class="p-10 text-center"><i class="fa-solid fa-circle-notch fa-spin text-brand-orange text-2xl"></i> Cargando traslados...</td></tr>`;

    try {
        const snap = await getDocs(query(collection(db, "transfers"), orderBy("requestedAt", "desc")));
        tbody.innerHTML = '';
        if (snap.empty) {
            tbody.innerHTML = `<tr><td colspan="8" class="p-10 text-center text-gray-400">No hay registros de traslados.</td></tr>`;
            return;
        }

        const role = sessionStorage.getItem('adminUserRole');
        const userBranchId = sessionStorage.getItem('adminUserBranchId');

        snap.forEach(d => {
            const t = d.data();
            const date = t.requestedAt?.toDate ? t.requestedAt.toDate().toLocaleString('es-CO') : '---';
            
            let statusBadge = '';
            if (t.status === 'PENDING') statusBadge = '<span class="bg-yellow-50 text-yellow-600 border border-yellow-100 px-2.5 py-1 rounded-md text-[9px] font-black uppercase tracking-wider">PENDIENTE</span>';
            else if (t.status === 'APPROVED') statusBadge = '<span class="bg-green-50 text-green-600 border border-green-100 px-2.5 py-1 rounded-md text-[9px] font-black uppercase tracking-wider">APROBADO</span>';
            else statusBadge = '<span class="bg-red-50 text-red-600 border border-red-100 px-2.5 py-1 rounded-md text-[9px] font-black uppercase tracking-wider">RECHAZADO</span>';

            const variantLabel = (t.color || t.capacity) ? `(${t.color || ''} ${t.capacity || ''})`.trim() : '';

            const canResolve = t.status === 'PENDING' && (role === 'admin' || userBranchId === 'ALL' || userBranchId === t.targetBranchId);

            const tr = document.createElement('tr');
            tr.className = "hover:bg-slate-50 transition border-b border-gray-50 last:border-0";
            tr.innerHTML = `
                <td class="px-6 py-4 font-bold text-xs text-gray-400">${date}</td>
                <td class="px-6 py-4">
                    <p class="font-black text-xs text-brand-black uppercase">${t.productName}</p>
                    <p class="text-[9px] text-brand-orange font-bold uppercase tracking-wider">${variantLabel || 'Sin variante'}</p>
                </td>
                <td class="px-6 py-4 text-center font-black text-xs text-brand-black">${t.quantity}</td>
                <td class="px-6 py-4 font-bold text-xs text-gray-500 uppercase">${t.sourceBranchName || t.sourceBranchId}</td>
                <td class="px-6 py-4 font-bold text-xs text-brand-black uppercase">${t.targetBranchName || t.targetBranchId}</td>
                <td class="px-6 py-4">${statusBadge}</td>
                <td class="px-6 py-4 text-xs font-bold text-gray-400 truncate max-w-xs uppercase">${t.requestedBy || '---'}</td>
                <td class="px-6 py-4 text-center">
                    ${canResolve ? `
                        <div class="flex items-center justify-center gap-1.5">
                            <button onclick="window.resolveTransfer('${d.id}', 'APPROVED')" class="w-8 h-8 rounded-lg bg-green-50 text-green-500 hover:bg-green-500 hover:text-white transition shadow-sm" title="Aprobar Traslado">
                                <i class="fa-solid fa-check text-[10px]"></i>
                            </button>
                            <button onclick="window.resolveTransfer('${d.id}', 'REJECTED')" class="w-8 h-8 rounded-lg bg-red-50 text-red-500 hover:bg-red-500 hover:text-white transition shadow-sm" title="Rechazar Traslado">
                                <i class="fa-solid fa-xmark text-[10px]"></i>
                            </button>
                        </div>
                    ` : `
                        <span class="text-[9px] text-gray-300 font-bold uppercase tracking-wider">
                            ${t.status === 'PENDING' ? 'Esperando Destino' : `Resuelto por: ${t.resolvedBy?.split(' - ').shift() || ''}`}
                        </span>
                    `}
                </td>
            `;
            tbody.appendChild(tr);
        });
    } catch (e) {
        console.error("Error loading transfers:", e);
        tbody.innerHTML = `<tr><td colspan="8" class="p-10 text-center text-red-500 font-bold">Error al cargar traslados: ${e.message}</td></tr>`;
    }
}

async function loadProductsToMemory() {
    if (cachedProducts.length > 0) return;
    try {
        const snap = await getDocs(collection(db, "products"));
        cachedProducts = [];
        snap.forEach(d => {
            cachedProducts.push({ id: d.id, ...d.data() });
        });
    } catch (e) {
        console.error("Error loading products:", e);
    }
}

document.getElementById('btn-new-transfer').onclick = async () => {
    await loadProductsToMemory();

    document.getElementById('transfer-form').reset();
    document.getElementById('transfer-selected-product-id').value = '';
    document.getElementById('transfer-selected-combo-key').value = '';
    document.getElementById('transfer-stock-preview').classList.add('hidden');
    document.getElementById('transfer-product-results').classList.add('hidden');

    const srcSelect = document.getElementById('transfer-source-branch');
    const targetSelect = document.getElementById('transfer-target-branch');

    srcSelect.innerHTML = '<option value="">Seleccione origen...</option>';
    targetSelect.innerHTML = '<option value="">Seleccione destino...</option>';

    const role = sessionStorage.getItem('adminUserRole');
    const userBranchId = sessionStorage.getItem('adminUserBranchId');
    const activeBranchId = sessionStorage.getItem('activeBranchId');

    branchesList.forEach(b => {
        srcSelect.innerHTML += `<option value="${b.id}">${b.name}</option>`;
        targetSelect.innerHTML += `<option value="${b.id}">${b.name}</option>`;
    });

    if (role !== 'admin' && userBranchId !== 'ALL') {
        srcSelect.value = userBranchId;
        srcSelect.disabled = true;
        srcSelect.classList.add('bg-gray-100', 'text-gray-400', 'cursor-not-allowed');
    } else {
        srcSelect.value = activeBranchId;
        srcSelect.disabled = false;
        srcSelect.classList.remove('bg-gray-100', 'text-gray-400', 'cursor-not-allowed');
    }

    document.getElementById('transfer-modal').classList.remove('hidden');
};

const searchProdInput = document.getElementById('transfer-search-product');
const resultsDiv = document.getElementById('transfer-product-results');

searchProdInput.addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase().trim();
    if (term.length < 2) {
        resultsDiv.classList.add('hidden');
        return;
    }

    const matches = [];
    cachedProducts.forEach(p => {
        if (p.combinations && p.combinations.length > 0) {
            p.combinations.forEach(combo => {
                const variantLabel = `${combo.color || ''} ${combo.capacity || ''}`.trim();
                const fullName = `${p.name} (${variantLabel})`;
                if (fullName.toLowerCase().includes(term)) {
                    matches.push({
                        productId: p.id,
                        name: p.name,
                        label: fullName,
                        color: combo.color || null,
                        capacity: combo.capacity || null,
                        sku: combo.sku || '',
                        branchStock: combo.branchStock || {},
                        comboKey: `${combo.color || ''}-${combo.capacity || ''}`
                    });
                }
            });
        } else {
            if (p.name.toLowerCase().includes(term)) {
                matches.push({
                    productId: p.id,
                    name: p.name,
                    label: p.name,
                    color: null,
                    capacity: null,
                    sku: p.sku || '',
                    branchStock: p.branchStock || {},
                    comboKey: ''
                });
            }
        }
    });

    resultsDiv.innerHTML = '';
    if (matches.length === 0) {
        resultsDiv.innerHTML = '<div class="p-4 text-center text-xs text-gray-400 uppercase">Sin coincidencias</div>';
    } else {
        matches.slice(0, 10).forEach(m => {
            const div = document.createElement('div');
            div.className = "p-3 hover:bg-brand-orange/10 cursor-pointer text-xs font-bold transition flex items-center justify-between border-b border-gray-50 last:border-0";
            div.innerHTML = `
                <div>
                    <span class="text-brand-black uppercase block">${m.label}</span>
                    <span class="text-[9px] text-gray-400 uppercase font-bold">${m.sku || 'Sin SKU'}</span>
                </div>
            `;
            div.onclick = () => {
                searchProdInput.value = m.label;
                document.getElementById('transfer-selected-product-id').value = m.productId;
                document.getElementById('transfer-selected-combo-key').value = m.comboKey;
                resultsDiv.classList.add('hidden');
                updateTransferStockPreview();
            };
            resultsDiv.appendChild(div);
        });
    }
    resultsDiv.classList.remove('hidden');
});

document.addEventListener('click', (e) => {
    if (!searchProdInput.contains(e.target) && !resultsDiv.contains(e.target)) {
        resultsDiv.classList.add('hidden');
    }
});

const srcBranchSelect = document.getElementById('transfer-source-branch');
srcBranchSelect.addEventListener('change', () => {
    updateTransferStockPreview();
});

function updateTransferStockPreview() {
    const productId = document.getElementById('transfer-selected-product-id').value;
    const comboKey = document.getElementById('transfer-selected-combo-key').value;
    const srcBranchId = srcBranchSelect.value;

    if (!productId || !srcBranchId) {
        document.getElementById('transfer-stock-preview').classList.add('hidden');
        return;
    }

    const prod = cachedProducts.find(p => p.id === productId);
    if (!prod) return;

    let available = 0;
    if (comboKey) {
        const parts = comboKey.split('-');
        const color = parts[0] || null;
        const capacity = parts[1] || null;
        
        const combo = prod.combinations.find(c => 
            (c.color === color || (!c.color && !color)) && 
            (c.capacity === capacity || (!c.capacity && !capacity))
        );
        if (combo && combo.branchStock) {
            available = combo.branchStock[srcBranchId] || 0;
        }
    } else {
        if (prod.branchStock) {
            available = prod.branchStock[srcBranchId] || 0;
        }
    }

    document.getElementById('transfer-available-stock').innerText = available;
    document.getElementById('transfer-stock-preview').classList.remove('hidden');
}

let isSubmittingTransfer = false;
document.getElementById('transfer-form').onsubmit = async (e) => {
    e.preventDefault();
    if (isSubmittingTransfer) return;
    isSubmittingTransfer = true;

    const btn = e.target.querySelector('button[type="submit"]');
    const originalText = btn.innerText;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin mr-2"></i> REGISTRANDO...';

    const productId = document.getElementById('transfer-selected-product-id').value;
    const comboKey = document.getElementById('transfer-selected-combo-key').value;
    const sourceBranchId = srcBranchSelect.value;
    const targetBranchId = document.getElementById('transfer-target-branch').value;
    const qty = parseInt(document.getElementById('transfer-qty').value) || 0;

    if (!productId || !sourceBranchId || !targetBranchId || qty <= 0) {
        alert("Todos los campos obligatorios deben completarse con cantidades válidas.");
        btn.disabled = false;
        btn.innerText = originalText;
        isSubmittingTransfer = false;
        return;
    }

    if (sourceBranchId === targetBranchId) {
        alert("La sede origen no puede ser la misma que la sede destino.");
        btn.disabled = false;
        btn.innerText = originalText;
        isSubmittingTransfer = false;
        return;
    }

    const prod = cachedProducts.find(p => p.id === productId);
    if (!prod) {
        alert("El producto seleccionado no es válido.");
        btn.disabled = false;
        btn.innerText = originalText;
        isSubmittingTransfer = false;
        return;
    }

    let color = null;
    let capacity = null;
    if (comboKey) {
        const parts = comboKey.split('-');
        color = parts[0] || null;
        capacity = parts[1] || null;
    }

    const srcBranchObj = branchesList.find(b => b.id === sourceBranchId);
    const targetBranchObj = branchesList.find(b => b.id === targetBranchId);
    const sourceBranchName = srcBranchObj ? srcBranchObj.name : sourceBranchId;
    const targetBranchName = targetBranchObj ? targetBranchObj.name : targetBranchId;

    try {
        await adjustStock(productId, -qty, color, capacity, sourceBranchId);

        await addDoc(collection(db, "transfers"), {
            productId,
            productName: prod.name,
            color,
            capacity,
            quantity: qty,
            sourceBranchId,
            sourceBranchName,
            targetBranchId,
            targetBranchName,
            status: 'PENDING',
            requestedBy: (sessionStorage.getItem('adminUserRole') || 'ventas') + ' - ' + (auth.currentUser ? auth.currentUser.email : 'Anónimo'),
            requestedAt: new Date(),
            resolvedBy: null,
            resolvedAt: null
        });

        showToast("Solicitud de traslado enviada con éxito.");
        document.getElementById('transfer-modal').classList.add('hidden');
        loadTransfers();
    } catch (err) {
        console.error("Error requesting stock transfer:", err);
        alert("Error: " + err.message);
    } finally {
        isSubmittingTransfer = false;
        btn.disabled = false;
        btn.innerText = originalText;
    }
};

window.resolveTransfer = async (transferId, status) => {
    const actionName = status === 'APPROVED' ? 'Aprobar' : 'Rechazar';
    if (!confirm(`¿Estás seguro de que deseas ${actionName.toLowerCase()} este traslado?`)) return;

    const userEmail = auth.currentUser ? auth.currentUser.email : 'Anónimo';
    const resolverInfo = (sessionStorage.getItem('adminUserRole') || 'empleado') + ' - ' + userEmail;

    try {
        const transSnap = await getDoc(doc(db, "transfers", transferId));
        if (!transSnap.exists()) {
            alert("No existe el registro de traslado");
            return;
        }

        const t = transSnap.data();
        if (t.status !== 'PENDING') {
            alert("Este traslado ya ha sido resuelto");
            return;
        }

        if (status === 'APPROVED') {
            await adjustStock(t.productId, t.quantity, t.color, t.capacity, t.targetBranchId);
        } else {
            await adjustStock(t.productId, t.quantity, t.color, t.capacity, t.sourceBranchId);
        }

        await updateDoc(doc(db, "transfers", transferId), {
            status: status,
            resolvedBy: resolverInfo,
            resolvedAt: new Date()
        });

        showToast(`Traslado ${status === 'APPROVED' ? 'APROBADO' : 'RECHAZADO'} correctamente.`);
        loadTransfers();
    } catch (err) {
        console.error("Error resolving transfer:", err);
        alert("Error al resolver el traslado: " + err.message);
    }
};

// ==========================================================================
// 4. INVENTARIO DE SEDE
// ==========================================================================
function updateValuationButtonsUI() {
    const btnSale = document.getElementById('btn-val-sale');
    const btnCost = document.getElementById('btn-val-cost');
    if (!btnSale || !btnCost) return;

    if (currentValuationMode === 'sale') {
        btnSale.className = "px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-wider transition bg-white text-brand-black shadow-sm";
        btnCost.className = "px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-wider transition text-gray-400 hover:text-brand-black";
    } else {
        btnSale.className = "px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-wider transition text-gray-400 hover:text-brand-black";
        btnCost.className = "px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-wider transition bg-white text-brand-black shadow-sm";
    }
}

function updateValuationLabels() {
    const lblCard = document.getElementById('lbl-val-card-title');
    const thUnit = document.getElementById('th-val-unit');
    const thTotal = document.getElementById('th-val-total');

    const suffix = currentValuationMode === 'sale' ? '(Venta)' : '(Costo)';
    
    if (lblCard) lblCard.textContent = `Valor Total Inventario Sede ${suffix}`;
    if (thUnit) thUnit.textContent = `Valor Unitario ${suffix}`;
    if (thTotal) thTotal.textContent = `Valor Total Sede ${suffix}`;
}

let isInventoryInitialized = false;

function initInventorySubscriptions() {
    if (isInventoryInitialized) return;
    isInventoryInitialized = true;

    AdminStore.subscribeToProducts((products) => {
        cachedProducts = products;
        if (currentTab === 'inventory') renderInventoryRows();
    });

    AdminStore.subscribeToPurchases((purchases) => {
        cachedPurchases = purchases;
        if (currentTab === 'inventory') renderInventoryRows();
    });

    AdminStore.subscribeToOrders((orders) => {
        cachedOrders = orders;
        if (currentTab === 'inventory') renderInventoryRows();
    });
}

function adjustInventoryLayoutForRole() {
    const role = sessionStorage.getItem('adminUserRole');
    const isAdmin = (role === 'admin');

    const valCard = document.getElementById('inventory-value-card');
    const grid = document.getElementById('inventory-metrics-grid');
    const valWrapper = document.getElementById('valuation-mode-wrapper');
    const thead = document.getElementById('inventory-thead');

    if (isAdmin) {
        if (valCard) valCard.classList.remove('hidden');
        if (grid) {
            grid.classList.remove('md:grid-cols-1', 'max-w-md');
            grid.classList.add('md:grid-cols-2');
        }
        if (valWrapper) valWrapper.classList.remove('hidden');
        if (thead) {
            thead.innerHTML = `
                <tr>
                    <th class="px-6 py-4 w-[35%]">Producto / Variante</th>
                    <th class="px-6 py-4 w-[15%]">SKU</th>
                    <th class="px-6 py-4 w-[12%] text-center">Stock Sede</th>
                    <th id="th-val-unit" class="px-6 py-4 w-[13%] text-right">Valor Unitario (Venta)</th>
                    <th id="th-val-total" class="px-6 py-4 w-[13%] text-right">Valor Total Sede (Venta)</th>
                    <th class="px-6 py-4 w-[12%] text-center">Stock Bodega (Otras Sedes)</th>
                </tr>
            `;
        }
    } else {
        if (valCard) valCard.classList.add('hidden');
        if (grid) {
            grid.classList.remove('md:grid-cols-2');
            grid.classList.add('md:grid-cols-1', 'max-w-md');
        }
        if (valWrapper) valWrapper.classList.add('hidden');
        if (thead) {
            thead.innerHTML = `
                <tr>
                    <th class="px-6 py-4 w-[40%]">Producto / Variante</th>
                    <th class="px-6 py-4 w-[20%]">SKU</th>
                    <th class="px-6 py-4 w-[20%] text-center">Stock Sede</th>
                    <th class="px-6 py-4 w-[20%] text-center">Stock Bodega (Otras Sedes)</th>
                </tr>
            `;
        }
    }
}

async function loadInventoryTab() {
    const activeBranchId = sessionStorage.getItem('activeBranchId');
    if (!activeBranchId) {
        alert("No se ha detectado una sede activa.");
        return;
    }

    // Cargar nombre de la sede activa
    const activeBranch = branchesList.find(b => b.id === activeBranchId);
    const branchName = activeBranch ? activeBranch.name : activeBranchId;
    document.getElementById('inventory-branch-title').innerText = branchName;

    // Ajustar encabezados y controles superiores de acuerdo al rol del usuario
    adjustInventoryLayoutForRole();

    const tbody = document.getElementById('inventory-table-body');

    // Inicializar suscripciones de forma reactiva (0 lecturas duplicadas)
    initInventorySubscriptions();

    const role = sessionStorage.getItem('adminUserRole');
    const isAdmin = (role === 'admin');
    const colSpanCount = isAdmin ? 6 : 4;

    // Renderizar de inmediato si hay datos, o mostrar spinner
    if (cachedProducts.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${colSpanCount}" class="p-10 text-center"><i class="fa-solid fa-circle-notch fa-spin text-brand-orange text-2xl"></i> Sincronizando inventario en tiempo real...</td></tr>`;
    } else {
        renderInventoryRows();
    }

    // Configurar botones de valuación (solo si el usuario es administrador)
    if (isAdmin) {
        const btnSale = document.getElementById('btn-val-sale');
        const btnCost = document.getElementById('btn-val-cost');

        if (btnSale) {
            btnSale.onclick = () => {
                if (currentValuationMode !== 'sale') {
                    currentValuationMode = 'sale';
                    updateValuationButtonsUI();
                    updateValuationLabels();
                    renderInventoryRows();
                }
            };
        }
        if (btnCost) {
            btnCost.onclick = () => {
                if (currentValuationMode !== 'cost') {
                    currentValuationMode = 'cost';
                    updateValuationButtonsUI();
                    updateValuationLabels();
                    renderInventoryRows();
                }
            };
        }

        // Asegurar que la UI refleje el modo actual antes de renderizar
        updateValuationButtonsUI();
        updateValuationLabels();
    }

    // Configurar buscador
    const searchInput = document.getElementById('inventory-search');
    searchInput.oninput = () => {
        renderInventoryRows();
    };
}

function getFIFOQueue(productId, color = null, capacity = null) {
    let timeline = [];

    cachedPurchases.forEach(p => {
        if (p.items) {
            p.items.forEach(item => {
                const matchId = item.id === productId;
                const matchColor = color ? (item.color === color) : (!item.color);
                const matchCapacity = capacity ? (item.capacity === capacity) : (!item.capacity);
                
                if (matchId && matchColor && matchCapacity) {
                    timeline.push({
                        type: 'IN',
                        date: p.createdAt?.toDate ? p.createdAt.toDate() : new Date(p.createdAt),
                        qty: parseInt(item.quantity) || 0,
                        unitCost: parseFloat(item.unitCostBase) || 0
                    });
                }
            });
        }
    });

    cachedOrders.forEach(o => {
        if (['CANCELADO', 'RECHAZADO', 'DEVUELTO'].includes(o.status)) return;
        if (o.items) {
            o.items.forEach(item => {
                const matchId = item.id === productId;
                const matchColor = color ? (item.color === color) : (!item.color);
                const matchCapacity = capacity ? (item.capacity === capacity) : (!item.capacity);
                
                if (matchId && matchColor && matchCapacity) {
                    timeline.push({
                        type: 'OUT',
                        date: o.createdAt?.toDate ? o.createdAt.toDate() : new Date(o.createdAt),
                        qty: parseInt(item.quantity) || 0
                    });
                }
            });
        }
    });

    // Ordenar cronológicamente
    timeline.sort((a, b) => a.date - b.date);

    let queue = [];
    let lastKnownCost = 0;

    timeline.forEach(event => {
        if (event.type === 'IN') {
            queue.push({ qty: event.qty, cost: event.unitCost });
            if (event.unitCost > 0) lastKnownCost = event.unitCost;
        } else if (event.type === 'OUT') {
            let qtyToFulfill = event.qty;
            while (qtyToFulfill > 0 && queue.length > 0) {
                let batch = queue[0];
                if (batch.qty <= qtyToFulfill) {
                    qtyToFulfill -= batch.qty;
                    queue.shift();
                } else {
                    batch.qty -= qtyToFulfill;
                    qtyToFulfill = 0;
                }
            }
        }
    });

    return { queue, lastKnownCost };
}

function calculateValuationFromQueue(queue, quantity, fallbackCost) {
    let remaining = quantity;
    let totalValue = 0;
    
    // Copiar la cola para evitar mutar el estado
    let tempQueue = queue.map(b => ({ ...b }));

    for (let i = 0; i < tempQueue.length && remaining > 0; i++) {
        let batch = tempQueue[i];
        if (batch.qty <= remaining) {
            totalValue += batch.qty * batch.cost;
            remaining -= batch.qty;
        } else {
            totalValue += remaining * batch.cost;
            remaining = 0;
        }
    }

    if (remaining > 0) {
        totalValue += remaining * fallbackCost;
    }

    return totalValue;
}

function renderInventoryRows() {
    const activeBranchId = sessionStorage.getItem('activeBranchId') || 'bodega';
    const term = document.getElementById('inventory-search').value.toLowerCase().trim();
    const tbody = document.getElementById('inventory-table-body');
    tbody.innerHTML = '';

    const itemsToRender = [];

    cachedProducts.forEach(p => {
        if (p.combinations && p.combinations.length > 0) {
            p.combinations.forEach(combo => {
                const variantLabel = `${combo.color || ''} ${combo.capacity || ''}`.trim();
                const fullName = `${p.name} (${variantLabel})`;
                const sku = combo.sku || p.sku || '---';

                if (!term || fullName.toLowerCase().includes(term) || sku.toLowerCase().includes(term) || (p.brand && p.brand.toLowerCase().includes(term))) {
                    const activeStock = (combo.branchStock && combo.branchStock[activeBranchId] !== undefined)
                        ? (parseInt(combo.branchStock[activeBranchId]) || 0)
                        : (parseInt(combo.stock) || 0);
                    const totalStock = parseInt(combo.stock) || 0;
                    const bodegaStock = Math.max(0, totalStock - activeStock);

                    let price = 0;
                    let totalValue = 0;
                    if (currentValuationMode === 'sale') {
                        price = parseFloat(combo.price || p.price || 0) || 0;
                        totalValue = activeStock * price;
                    } else {
                        const { queue, lastKnownCost } = getFIFOQueue(p.id, combo.color, combo.capacity);
                        const fallbackCost = lastKnownCost || parseFloat(p.lastPurchaseCost || 0) || 0;
                        totalValue = calculateValuationFromQueue(queue, activeStock, fallbackCost);
                        price = activeStock > 0 ? (totalValue / activeStock) : fallbackCost;
                    }

                    itemsToRender.push({
                        name: p.name,
                        variant: variantLabel,
                        sku: sku,
                        activeStock: activeStock,
                        bodegaStock: bodegaStock,
                        category: p.category || 'Sin Categoría',
                        price: price,
                        totalValue: totalValue
                    });
                }
            });
        } else {
            const sku = p.sku || '---';
            if (!term || p.name.toLowerCase().includes(term) || sku.toLowerCase().includes(term) || (p.brand && p.brand.toLowerCase().includes(term))) {
                const activeStock = (p.branchStock && p.branchStock[activeBranchId] !== undefined)
                    ? (parseInt(p.branchStock[activeBranchId]) || 0)
                    : (parseInt(p.stock) || 0);
                const totalStock = parseInt(p.stock) || 0;
                const bodegaStock = Math.max(0, totalStock - activeStock);

                let price = 0;
                let totalValue = 0;
                if (currentValuationMode === 'sale') {
                    price = parseFloat(p.price || 0) || 0;
                    totalValue = activeStock * price;
                } else {
                    const { queue, lastKnownCost } = getFIFOQueue(p.id, null, null);
                    const fallbackCost = lastKnownCost || parseFloat(p.lastPurchaseCost || 0) || 0;
                    totalValue = calculateValuationFromQueue(queue, activeStock, fallbackCost);
                    price = activeStock > 0 ? (totalValue / activeStock) : fallbackCost;
                }

                itemsToRender.push({
                    name: p.name,
                    variant: null,
                    sku: sku,
                    activeStock: activeStock,
                    bodegaStock: bodegaStock,
                    category: p.category || 'Sin Categoría',
                    price: price,
                    totalValue: totalValue
                });
            }
        }
    });

    // 1. Calcular Consolidados de la Sede
    let grandTotalUnits = 0;
    let grandTotalValue = 0;

    itemsToRender.forEach(item => {
        grandTotalUnits += item.activeStock;
        grandTotalValue += item.totalValue;
    });

    const role = sessionStorage.getItem('adminUserRole');
    const isAdmin = (role === 'admin');
    const colSpanCount = isAdmin ? 6 : 4;

    const totalQtyEl = document.getElementById('inventory-total-qty');
    const totalValEl = document.getElementById('inventory-total-value');
    if (totalQtyEl) totalQtyEl.textContent = `${grandTotalUnits.toLocaleString('es-CO')} unds`;
    if (totalValEl) totalValEl.textContent = `$ ${grandTotalValue.toLocaleString('es-CO')}`;

    if (itemsToRender.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${colSpanCount}" class="p-10 text-center text-gray-400 uppercase font-bold text-xs">No se encontraron productos en el inventario.</td></tr>`;
        return;
    }

    // 2. Agrupar por Categoría
    const groupedByCategory = {};
    itemsToRender.forEach(item => {
        const cat = item.category;
        if (!groupedByCategory[cat]) {
            groupedByCategory[cat] = [];
        }
        groupedByCategory[cat].push(item);
    });

    // 3. Ordenar Categorías (Alfabético, "Sin Categoría" al final)
    const sortedCategories = Object.keys(groupedByCategory).sort((a, b) => {
        const aLower = a.toLowerCase();
        const bLower = b.toLowerCase();
        if (aLower === 'sin categoría' || aLower === 'sin categoria') return 1;
        if (bLower === 'sin categoría' || bLower === 'sin categoria') return -1;
        return a.localeCompare(b);
    });

    // 4. Renderizar Filas Agrupadas
    sortedCategories.forEach(cat => {
        const catItems = groupedByCategory[cat];
        
        let catUnits = 0;
        let catValue = 0;
        catItems.forEach(item => {
            catUnits += item.activeStock;
            catValue += item.totalValue;
        });

        // Crear una clase segura para los productos de esta categoría
        const safeCatClass = `cat-rows-${cat.replace(/[^a-z0-9]/gi, '_')}`;

        // Fila de Encabezado de Categoría
        const catTr = document.createElement('tr');
        catTr.className = "bg-slate-100/60 font-black text-[10px] text-brand-black border-y border-gray-200/80 cursor-pointer select-none hover:bg-slate-200/50 transition-colors";
        
        if (isAdmin) {
            catTr.innerHTML = `
                <td class="px-6 py-3 uppercase tracking-wider font-black text-brand-black">
                    <div class="flex items-center gap-2">
                        <i class="fa-solid fa-chevron-right text-brand-orange text-[9px] transition-transform duration-200 mr-1 cat-arrow"></i>
                        <i class="fa-solid fa-folder text-brand-orange text-xs"></i>
                        <span>Categoría: ${cat}</span>
                    </div>
                </td>
                <td class="px-6 py-3"></td>
                <td class="px-6 py-3 text-center text-brand-orange font-black">${catUnits} unds</td>
                <td class="px-6 py-3"></td>
                <td class="px-6 py-3 text-right text-emerald-700 font-black">$ ${catValue.toLocaleString('es-CO')}</td>
                <td class="px-6 py-3"></td>
            `;
        } else {
            catTr.innerHTML = `
                <td class="px-6 py-3 uppercase tracking-wider font-black text-brand-black">
                    <div class="flex items-center gap-2">
                        <i class="fa-solid fa-chevron-right text-brand-orange text-[9px] transition-transform duration-200 mr-1 cat-arrow"></i>
                        <i class="fa-solid fa-folder text-brand-orange text-xs"></i>
                        <span>Categoría: ${cat}</span>
                    </div>
                </td>
                <td class="px-6 py-3"></td>
                <td class="px-6 py-3 text-center text-brand-orange font-black">${catUnits} unds</td>
                <td class="px-6 py-3"></td>
            `;
        }
        tbody.appendChild(catTr);

        // Click handler para expandir/colapsar
        catTr.onclick = () => {
            const rows = tbody.querySelectorAll(`.${safeCatClass}`);
            const arrow = catTr.querySelector('.cat-arrow');
            
            rows.forEach(r => {
                r.classList.toggle('hidden');
            });
            
            if (arrow) {
                if (arrow.classList.contains('fa-chevron-right')) {
                    arrow.classList.remove('fa-chevron-right');
                    arrow.classList.add('fa-chevron-down');
                } else {
                    arrow.classList.remove('fa-chevron-down');
                    arrow.classList.add('fa-chevron-right');
                }
            }
        };

        // Filas de Productos de la Categoría
        catItems.forEach(item => {
            const tr = document.createElement('tr');
            // Inicialmente ocultos (comprimidos)
            tr.className = `hover:bg-slate-50 transition border-b border-gray-50 last:border-0 hidden ${safeCatClass}`;
            
            const activeStockClass = item.activeStock > 0 ? "text-green-600 bg-green-50 border-green-100" : "text-red-500 bg-red-50 border-red-100";
            const bodegaStockClass = item.bodegaStock > 0 ? "text-blue-600 bg-blue-50 border-blue-100" : "text-gray-400 bg-gray-50 border-gray-100";

            const variantBadge = item.variant 
                ? `<span class="text-[9px] bg-brand-orange/15 text-brand-orange border border-brand-orange/20 px-2 py-0.5 rounded font-black tracking-wider uppercase">${item.variant}</span>` 
                : '';

            if (isAdmin) {
                tr.innerHTML = `
                    <td class="px-6 py-4 pl-10">
                        <div class="flex flex-col gap-1">
                            <span class="font-black text-xs text-brand-black uppercase">${item.name}</span>
                            <div class="flex items-center gap-2">${variantBadge}</div>
                        </div>
                    </td>
                    <td class="px-6 py-4 font-mono font-bold text-xs text-gray-400 uppercase">${item.sku}</td>
                    <td class="px-6 py-4 text-center">
                        <span class="px-3 py-1.5 rounded-xl border text-xs font-black min-w-[3rem] inline-block ${activeStockClass}">
                            ${item.activeStock}
                        </span>
                    </td>
                    <td class="px-6 py-4 text-right font-bold text-xs text-gray-600">$ ${item.price.toLocaleString('es-CO')}</td>
                    <td class="px-6 py-4 text-right font-black text-xs text-emerald-600">$ ${item.totalValue.toLocaleString('es-CO')}</td>
                    <td class="px-6 py-4 text-center">
                        <span class="px-3 py-1.5 rounded-xl border text-xs font-black min-w-[3rem] inline-block ${bodegaStockClass}">
                            ${item.bodegaStock}
                        </span>
                    </td>
                `;
            } else {
                tr.innerHTML = `
                    <td class="px-6 py-4 pl-10">
                        <div class="flex flex-col gap-1">
                            <span class="font-black text-xs text-brand-black uppercase">${item.name}</span>
                            <div class="flex items-center gap-2">${variantBadge}</div>
                        </div>
                    </td>
                    <td class="px-6 py-4 font-mono font-bold text-xs text-gray-400 uppercase">${item.sku}</td>
                    <td class="px-6 py-4 text-center">
                        <span class="px-3 py-1.5 rounded-xl border text-xs font-black min-w-[3rem] inline-block ${activeStockClass}">
                            ${item.activeStock}
                        </span>
                    </td>
                    <td class="px-6 py-4 text-center">
                        <span class="px-3 py-1.5 rounded-xl border text-xs font-black min-w-[3rem] inline-block ${bodegaStockClass}">
                            ${item.bodegaStock}
                        </span>
                    </td>
                `;
            }
            tbody.appendChild(tr);
        });
    });
}

// ==========================================================================
// 5. GENERALES E INICIALIZACIÓN
// ==========================================================================
function showToast(msg) {
    const toast = document.createElement('div');
    toast.className = "fixed bottom-5 right-5 bg-brand-black text-brand-orange px-6 py-3 rounded-xl font-black text-[10px] uppercase tracking-widest shadow-2xl animate-in slide-in-from-bottom-5 z-[200]";
    toast.innerHTML = `<i class="fa-solid fa-check-circle mr-2"></i> ${msg}`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

// Iniciar con la primera pestaña
switchTab('branches');


