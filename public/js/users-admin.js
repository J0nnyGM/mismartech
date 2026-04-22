// public/js/users-admin.js
import { db, updateDoc, doc } from './firebase-init.js';
import { AdminStore } from './admin-store.js'; // 🔥 IMPORTAMOS EL CEREBRO CENTRAL

const tableBody = document.getElementById('staff-table-body');
const searchInput = document.getElementById('search-staff');
const modal = document.getElementById('add-staff-modal');
const btnOpenModal = document.getElementById('btn-open-add-modal');
const searchAllUsers = document.getElementById('search-all-users');
const modalUsersList = document.getElementById('modal-users-list');

let allUsersCache = []; // Caché total de usuarios
let staffCache = [];    // Caché filtrado solo para la tabla (Empleados)

// ==========================================================================
// 🔥 CONEXIÓN AL STORE CENTRAL
// ==========================================================================
AdminStore.subscribeToClients((usersArray) => {
    allUsersCache = usersArray;
    
    // Filtramos para obtener solo a los empleados (excluir clientes)
    staffCache = allUsersCache.filter(u => {
        const role = u.role ? u.role.toLowerCase() : '';
        return role !== 'customer' && role !== 'cliente' && role !== 'client' && role !== '';
    });
    
    // Repintar la tabla principal
    if (searchInput.value.trim().length > 0) {
        searchInput.dispatchEvent(new Event('input'));
    } else {
        renderStaffTable(staffCache);
    }

    // Si el modal de agregar empleado está abierto y buscando, repintar sus resultados en vivo
    if (!modal.classList.contains('hidden') && searchAllUsers.value.trim().length >= 2) {
        searchAllUsers.dispatchEvent(new Event('input'));
    }
});

// --- 2. RENDERIZAR TABLA DE EMPLEADOS ---
function renderStaffTable(staffList) {
    tableBody.innerHTML = '';
    
    if (staffList.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="5" class="p-10 text-center text-gray-400 font-bold text-xs uppercase tracking-widest">No se encontró personal administrativo.</td></tr>`;
        return;
    }

    staffList.forEach((u) => {
        const date = u.createdAt?.toDate ? u.createdAt.toDate().toLocaleDateString('es-CO') : '---';
        const isSuperAdmin = u.role === 'admin';
        
        const tr = document.createElement('tr');
        tr.className = "hover:bg-slate-50 transition group";
        tr.innerHTML = `
            <td class="px-6 py-4 font-bold text-brand-black capitalize">
                <div class="flex items-center gap-3">
                    <div class="w-8 h-8 rounded-full bg-brand-black text-white flex items-center justify-center font-black text-xs shrink-0">${(u.name || 'U').charAt(0)}</div>
                    ${u.name || 'Anónimo'}
                </div>
            </td>
            <td class="px-6 py-4 text-gray-500 font-medium">${u.email || u.phone || '---'}</td>
            <td class="px-6 py-4 text-xs text-gray-400 font-bold">${date}</td>
            <td class="px-6 py-4">
                <div class="relative">
                    <select onchange="window.updateUserRole('${u.id}', this.value)" class="w-full bg-slate-100 border-none rounded-xl text-xs font-black p-3 outline-none focus:ring-2 focus:ring-brand-cyan/30 appearance-none cursor-pointer ${isSuperAdmin ? 'text-brand-cyan bg-cyan-50' : 'text-gray-600'}">
                        <option value="ventas" ${u.role === 'ventas' ? 'selected' : ''}>Ventas / Comercial</option>
                        <option value="contabilidad" ${u.role === 'contabilidad' ? 'selected' : ''}>Contabilidad</option>
                        <option value="logistica" ${u.role === 'logistica' ? 'selected' : ''}>Logística / Despachos</option>
                        <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Super Admin</option>
                    </select>
                    <i class="fa-solid fa-chevron-down absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none text-[10px]"></i>
                </div>
            </td>
            <td class="px-6 py-4 text-center">
                <button onclick="window.revokeAccess('${u.id}')" class="w-8 h-8 rounded-lg bg-red-50 text-red-500 hover:bg-red-500 hover:text-white transition shadow-sm" title="Revocar acceso (Convertir en Cliente)">
                    <i class="fa-solid fa-user-slash text-[10px]"></i>
                </button>
            </td>
        `;
        tableBody.appendChild(tr);
    });
}

// Búsqueda en la tabla de empleados
searchInput.addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const filtered = staffCache.filter(u => 
        (u.name && u.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes(term)) || 
        (u.email && u.email.toLowerCase().includes(term)) ||
        (u.phone && u.phone.includes(term))
    );
    renderStaffTable(filtered);
});

// --- 3. MODAL: AÑADIR EMPLEADO (Búsqueda en todo el caché) ---
btnOpenModal.onclick = () => {
    searchAllUsers.value = "";
    modalUsersList.innerHTML = `<div class="p-8 text-center text-gray-400 text-xs font-bold uppercase tracking-widest"><i class="fa-solid fa-keyboard text-2xl mb-2 block opacity-50"></i> Empieza a escribir el correo, nombre o teléfono...</div>`;
    modal.classList.remove('hidden');
    searchAllUsers.focus();
};

const btnClose = document.getElementById('btn-close-modal');
if (btnClose) {
    btnClose.onclick = () => {
        modal.classList.add('hidden');
    };
} else {
    // Plan B: Si tu botón usa la clase genérica de tu plantilla
    document.querySelectorAll('.close-modal').forEach(btn => {
        btn.addEventListener('click', () => modal.classList.add('hidden'));
    });
}

searchAllUsers.addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    
    if (term.length < 2) {
        modalUsersList.innerHTML = `<div class="p-8 text-center text-gray-400 text-xs font-bold uppercase tracking-widest">Escribe al menos 2 letras...</div>`;
        return;
    }

    // 🔥 BUSCAR SOLO EN CLIENTES (customer, client, cliente, o sin rol)
    const results = allUsersCache.filter(u => {
        const role = u.role ? u.role.toLowerCase() : '';
        const isClient = role === 'customer' || role === 'client' || role === 'cliente' || role === '';
        
        const matchSearch = 
            (u.name && u.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes(term)) || 
            (u.email && u.email.toLowerCase().includes(term)) ||
            (u.phone && u.phone.includes(term));
            
        return isClient && matchSearch;
    });

    if (results.length === 0) {
        modalUsersList.innerHTML = `<div class="p-8 text-center text-gray-400 text-xs font-bold uppercase tracking-widest">No hay clientes con ese nombre, teléfono o correo.</div>`;
        return;
    }

    modalUsersList.innerHTML = results.slice(0, 15).map(u => `
        <div class="flex items-center justify-between p-3 hover:bg-white rounded-xl cursor-pointer transition border border-transparent hover:border-gray-200 group">
            <div class="min-w-0">
                <p class="text-xs font-black text-brand-black uppercase truncate">${u.name || 'Sin Nombre'}</p>
                <p class="text-[10px] text-gray-500 truncate">${u.email || u.phone || 'Sin datos de contacto'}</p>
            </div>
            <div class="flex gap-2 opacity-0 group-hover:opacity-100 transition">
                <button onclick="window.updateUserRole('${u.id}', 'ventas')" class="px-3 py-1.5 bg-brand-cyan text-brand-black text-[9px] font-black uppercase rounded-lg hover:scale-105 transition">Ventas</button>
                <button onclick="window.updateUserRole('${u.id}', 'logistica')" class="px-3 py-1.5 bg-brand-black text-white text-[9px] font-black uppercase rounded-lg hover:scale-105 transition">Logística</button>
            </div>
        </div>
    `).join('');
});

// --- 4. FUNCIONES DE ACTUALIZACIÓN A BD ---
window.updateUserRole = async (uid, newRole) => {
    if(!confirm(`¿Confirmas el cambio de rol a ${newRole.toUpperCase()}? Esta persona tendrá acceso al panel administrativo.`)) {
        renderStaffTable(staffCache); // Revertir visualmente el select si cancela
        return;
    }
    
    try {
        // 🔥 CRÍTICO: Añadimos updatedAt para que AdminStore detecte el cambio en el "Delta Sync"
        await updateDoc(doc(db, "users", uid), { 
            role: newRole,
            updatedAt: new Date()
        });
        modal.classList.add('hidden'); // Cerrar modal si estaba abierto
        showToast(`Rol actualizado a ${newRole.toUpperCase()}`);
    } catch (e) {
        alert("Error al actualizar: " + e.message);
        renderStaffTable(staffCache); // Revertir visual
    }
};

window.revokeAccess = async (uid) => {
    if(!confirm("¿Estás seguro de revocar el acceso? El usuario volverá a ser un Cliente (customer) y será expulsado del panel.")) return;
    try {
        // 🔥 CRÍTICO: Añadimos updatedAt
        await updateDoc(doc(db, "users", uid), { 
            role: 'customer',
            updatedAt: new Date()
        });
        showToast("Acceso revocado");
    } catch (e) {
        alert("Error al revocar: " + e.message);
    }
};

function showToast(msg) {
    const toast = document.createElement('div');
    toast.className = "fixed bottom-5 right-5 bg-brand-black text-brand-cyan px-6 py-3 rounded-xl font-black text-[10px] uppercase tracking-widest shadow-2xl animate-in slide-in-from-bottom-5 z-[200]";
    toast.innerHTML = `<i class="fa-solid fa-check-circle mr-2"></i> ${msg}`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}