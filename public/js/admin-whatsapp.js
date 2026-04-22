import { auth, db, collection, onAuthStateChanged, query, orderBy, onSnapshot, doc, updateDoc, setDoc, functions, httpsCallable, limitToLast, storage, ref, uploadBytes, getDownloadURL, where, getDocs, limit, startAt, endAt, startAfter, addDoc, Timestamp } from "./firebase-init.js";
import { viewOrderDetail } from "./order-actions.js";
import { initManualSale, openManualSaleModal } from "./manual-sale.js";
import { AdminStore } from "./admin-store.js"; // 🔥 IMPORTAMOS EL CEREBRO

// --- REFERENCIAS DOM ---
const els = {
    chatList: document.getElementById('chat-list'),
    conversationPanel: document.getElementById('chat-conversation-panel'),
    chatHeader: document.getElementById('chat-header'),
    activeName: document.getElementById('active-chat-name'),
    activePhone: document.getElementById('active-chat-phone'),
    waLink: document.getElementById('wa-link-direct'),
    msgArea: document.getElementById('chat-messages-area'),
    emptyState: document.getElementById('chat-empty-state'),
    inputArea: document.getElementById('chat-input-area'),
    timerBadge: document.getElementById('session-timer-badge'),
    timerText: document.getElementById('session-timer-text'),
    txtInput: document.getElementById('message-input'),
    btnSend: document.getElementById('send-btn'),
    btnAttach: document.getElementById('btn-attach'),
    fileInput: document.getElementById('image-upload-input'),
    backBtn: document.getElementById('back-to-list-btn'),
    btnCloseChat: document.getElementById('btn-close-chat'),
    
    // PESTAÑAS NUEVAS
    tabMine: document.getElementById('tab-mine'),
    tabOpen: document.getElementById('tab-open'),
    tabResolved: document.getElementById('tab-resolved'),
    
    chatSearchInput: document.getElementById('chat-search-input'),
    btnResolve: document.getElementById('btn-resolve-chat'),
    btnProducts: document.getElementById('btn-products'),
    prodPicker: document.getElementById('product-picker-popover'),
    prodSearch: document.getElementById('prod-picker-search'),
    prodList: document.getElementById('prod-picker-list'),
    closeProdBtn: document.getElementById('close-prod-picker'),
    quickReplyMenu: document.getElementById('quick-reply-menu'),
    quickReplyList: document.getElementById('quick-reply-list'),
    btnActions: document.getElementById('btn-actions-trigger'),
    dropdownActions: document.getElementById('actions-dropdown'),
    btnActOrders: document.getElementById('btn-action-orders'),
    btnActClient: document.getElementById('btn-action-new-client'),
    btnActSale: document.getElementById('btn-action-new-sale'),
    infoPanel: document.getElementById('customer-info-panel'),
    closeInfoBtn: document.getElementById('close-info-panel'),
    infoName: document.getElementById('info-name'),
    infoPhone: document.getElementById('info-phone'),
    infoBadge: document.getElementById('info-status-badge'),
    ordersContainer: document.getElementById('orders-list-container'),
    btnLoadMore: document.getElementById('load-more-orders-btn'),
    inputSearchOrder: document.getElementById('order-search-input'),
    btnSearchOrder: document.getElementById('order-search-btn'),
    clientModal: document.getElementById('client-modal'),
    inpClientName: document.getElementById('new-client-name'),
    inpClientPhone: document.getElementById('new-client-phone'),
    inpClientDoc: document.getElementById('new-client-doc'),
    inpClientEmail: document.getElementById('new-client-email'),
    inpClientAddr: document.getElementById('new-client-address'),
    inpClientDept: document.getElementById('new-client-dept'),
    inpClientCity: document.getElementById('new-client-city'),
    btnSaveClient: document.getElementById('save-client'),
    notifySound: document.getElementById('notify-sound'),

    adminStatsSection: document.getElementById('admin-stats-section'),
    adminStatsTbody: document.getElementById('admin-stats-tbody'),
};

// --- CONFIGURACIÓN GLOBAL ---
let activeChatId = null;
let activeChatData = null;
let unsubscribeMessages = null;
let unsubscribeChats = null;
let timerInterval = null;
let currentTab = 'mine'; 
let chatSearchTimeout = null;
let oldestMessageDoc = null; 
let isChatLoading = false;   
let ordersLoadedForCurrentChat = false; 
let lastOrderSnapshot = null;
let currentPhoneNumbers = [];
const ORDERS_PER_PAGE = 3;

let chatProductsCache = []; // RAM de Productos
let allClientsCache = [];   // RAM de Clientes

const TIME_UNITS = { 'months': 'Meses', 'years': 'Años', 'days': 'Días' };
const QUICK_REPLIES = [
    { title: "👋 Saludo", text: "¡Hola! Gracias por escribir a PixelTech. ¿En qué podemos ayudarte hoy?" },
    { title: "🛵 Envío Bogotá", text: "Para Bogotá el envío llega el mismo día (Lunes a Sábado) si confirmas antes de las 3:30 PM.\n\n💰 Costo: $10.000\n🤝 Pago: Contra entrega." },
    { title: "🚚 Envío Nacional", text: "Realizamos envíos a toda Colombia 🇨🇴. Si confirmas antes de las 3:00 PM sale hoy mismo.\n\n📸 Te enviamos foto del paquete y la guía de rastreo.\n💰 Costo promedio: $18.000 (varía según ubicación)." },
    { title: "📍 Pasar a Recoger", text: "Estamos en el Centro internacional, Bogotá (a media cuadra de la 34).\n\n🏢 *Calle 31 # 13A-51*\nEdificio Panorama, Oficina 223." },
    { title: "⏰ Horarios", text: "Nuestros horarios de atención son:\n\n📅 Lunes a Viernes: 9:00 AM - 5:30 PM\n📅 Sábados: 10:00 AM - 3:00 PM" },
    { title: "🟣 Cuentas Cobro", text: "Puedes realizar el pago a:\n\n🏦 *Bancolombia Ahorros* \n*PixelTech Col SAS* \n*NIT:* 901.561.037 \n*Cuenta:* 237-000046-12 \n\n📱 *Nequi / Daviplata*\n3003729020\nLina Gil\n\n🗝️ *Llave / Bre-B:*\n0041243528 \nPixelTech Col" },
    { title: "📝 Pedir Datos", text: "Para procesar tu pedido, regálame por favor estos datos:\n\n🧑🏻 Nombre:\n🎫 C.C:\n📲 Cel:\n🏠 Dirección:\n🏭 Barrio:\n🌆 Ciudad:\n📩 Email:" },
];

initManualSale(() => {
    if (els.infoPanel.style.display === 'flex') resetOrdersPagination(activeChatId);
});

function normalizeText(text) { return text ? text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") : ""; }

// ==========================================================================
// 🔥 CONEXIÓN AL STORE CENTRAL (CERO LECTURAS EXTRAS)
// ==========================================================================
AdminStore.subscribeToProducts((products) => {
    chatProductsCache = products;
    // Repintar catálogo si está abierto
    if (els.prodPicker && !els.prodPicker.classList.contains('hidden') && els.prodSearch.value.trim() === "") {
        renderProductList(chatProductsCache.slice(0, 20));
    }
});

AdminStore.subscribeToClients((clients) => {
    allClientsCache = clients;
});


// ==========================================================================
// 1. GESTIÓN DE CHATS & ASIGNACIÓN
// ==========================================================================

function getAssignmentBadgeHTML(data) {
    const myEmail = auth.currentUser?.email || '';

    if (data.status === 'resolved') {
        if (data.lastAttendedBy) {
            const name = data.lastAttendedByName || data.lastAttendedBy.split('@')[0];
            return `<span class="text-[9px] bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full uppercase font-bold" title="Atendido por ${name}"><i class="fa-solid fa-lock mr-1"></i>${name}</span>`;
        }
        return '';
    }
    
    if (data.assignedTo) {
        if (data.assignedTo === myEmail) {
            return `<span class="text-[9px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full uppercase font-bold border border-emerald-200"><i class="fa-solid fa-headset mr-1"></i>Mío</span>`;
        } else {
            const name = data.assignedToName || data.assignedTo.split('@')[0];
            return `<span class="text-[9px] bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full uppercase font-bold border border-blue-200" title="${data.assignedTo}"><i class="fa-solid fa-user mr-1"></i>${name}</span>`;
        }
    }
    
    return `<span class="text-[9px] bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full uppercase font-bold border border-yellow-200 animate-pulse"><i class="fa-solid fa-hand-paper mr-1"></i>Libre</span>`;
}

function updateHeaderAssignmentBadge(data) {
    const badge = document.getElementById('active-chat-assignment');
    if (!badge) return;
    badge.innerHTML = getAssignmentBadgeHTML(data);
    badge.classList.remove('hidden');
    badge.className = "inline-block"; 
}

// Asignación automática al responder
async function assignToMeIfNeeded() {
    if (activeChatData && activeChatData.status === 'open' && !activeChatData.assignedTo && auth.currentUser) {
        const myEmail = auth.currentUser.email;
        const myName = auth.currentUser.displayName || myEmail.split('@')[0]; 

        try {
            await updateDoc(doc(db, "chats", activeChatId), {
                assignedTo: myEmail,
                assignedToName: myName,
                lastAttendedBy: myEmail,
                lastAttendedByName: myName
            });
            activeChatData.assignedTo = myEmail;
            activeChatData.assignedToName = myName;
            activeChatData.lastAttendedBy = myEmail;
            activeChatData.lastAttendedByName = myName;
            updateHeaderAssignmentBadge(activeChatData);
        } catch(e) {
            console.error("Error asignando chat:", e);
        }
    }
}

function initChatList() {
    if (unsubscribeChats) unsubscribeChats();
    const refChat = collection(db, "chats");
    
    const queryStatus = currentTab === 'resolved' ? 'resolved' : 'open';
    let q = query(refChat, where("status", "==", queryStatus), orderBy("lastMessageAt", "desc"), limit(50));
    
    if (!els.chatSearchInput.value) { els.chatList.innerHTML = ""; }

    unsubscribeChats = onSnapshot(q, (snapshot) => {
        if (els.chatSearchInput.value.trim().length > 0) return;
        if (snapshot.empty) {
            els.chatList.innerHTML = `<div class="p-10 text-center text-xs text-gray-400">No hay chats en esta bandeja.</div>`;
            return;
        }

        const myEmail = auth.currentUser?.email || '';

        snapshot.docChanges().forEach(change => {
            const data = change.doc.data();
            const id = change.doc.id;
            const source = change.doc.metadata.hasPendingWrites ? "Local" : "Server";

            let isVisible = true;
            if (currentTab === 'mine') {
                if (data.assignedTo && data.assignedTo !== myEmail) isVisible = false;
            }

            if ((change.type === "added" || change.type === "modified") && source === "Server") {
                if (data.unread && data.lastMessageAt && (Date.now() - data.lastMessageAt.toDate() < 10000)) {
                    if (document.hidden || activeChatId !== id) {
                        if (isVisible) {
                            playSound(); document.title = "🔔 Nuevo Mensaje!"; setTimeout(() => document.title = "WhatsApp CRM", 4000);
                        }
                    }
                }
            }

            if (change.type === "added") {
                if (isVisible) {
                    const card = createChatCard(id, data);
                    els.chatList.appendChild(card);
                    if (change.newIndex === 0) els.chatList.prepend(card);
                }
            }

            if (change.type === "modified") {
                const existingCard = document.getElementById(`chat-card-${id}`);
                
                if (isVisible) {
                    if (existingCard) {
                        updateChatCardContent(existingCard, data);
                        if (change.newIndex === 0) {
                            els.chatList.prepend(existingCard);
                            existingCard.classList.add('bg-blue-50'); 
                            setTimeout(() => existingCard.classList.remove('bg-blue-50'), 500);
                        }
                    } else {
                        const card = createChatCard(id, data);
                        els.chatList.prepend(card);
                    }
                } else {
                    if (existingCard) existingCard.remove();
                }

                if (activeChatId === id && isVisible) {
                    activeChatData = data;
                    updateHeaderAssignmentBadge(data);
                    startSessionTimer(data.lastCustomerInteraction);
                }
            }

            if (change.type === "removed") {
                const card = document.getElementById(`chat-card-${id}`);
                if (card) card.remove();
                if (activeChatId === id && currentTab !== 'resolved') closeActiveChat();
            }
        });

        if (els.chatList.children.length === 0) {
            els.chatList.innerHTML = `<div class="p-10 text-center text-xs text-gray-400">Todo al día, no hay chats libres ni asignados a ti.</div>`;
        }
    });
}

function createChatCard(id, data) {
    const div = document.createElement('div');
    div.id = `chat-card-${id}`;
    div.className = `flex items-center gap-3 p-3 rounded-xl cursor-pointer transition relative group border-b border-gray-50 last:border-0 hover:bg-gray-50`;
    if (id === activeChatId) div.classList.add('bg-gray-100');

    div.onclick = () => {
        document.querySelectorAll('[id^="chat-card-"]').forEach(el => el.classList.remove('bg-gray-100'));
        div.classList.add('bg-gray-100');
        openChat(id, data);
    };

    div.innerHTML = `
        <div class="w-12 h-12 rounded-full bg-slate-200 flex items-center justify-center text-gray-500 relative shrink-0">
            <i class="fa-solid fa-user"></i>
            <span id="badge-${id}" class="absolute top-0 right-0 w-3 h-3 bg-brand-cyan rounded-full border-2 border-white shadow-sm ${data.unread ? '' : 'hidden'}"></span>
        </div>
        <div class="flex-grow min-w-0">
            <div class="flex justify-between items-baseline mb-1">
                <h4 id="name-${id}" class="text-sm font-bold text-gray-800 truncate ${data.unread ? 'font-black' : ''}">${data.clientName || id}</h4>
                <span id="time-${id}" class="text-[10px] ${data.unread ? 'text-brand-cyan font-bold' : 'text-gray-400'}">${formatTime(data.lastMessageAt)}</span>
            </div>
            <div class="flex justify-between items-center">
                <p id="msg-${id}" class="text-[11px] text-gray-500 truncate pr-2 ${data.unread ? 'font-bold text-gray-700' : ''}">${formatPreview(data.lastMessage)}</p>
                <div id="assign-${id}" class="shrink-0">${getAssignmentBadgeHTML(data)}</div>
            </div>
        </div>
    `;
    return div;
}

function updateChatCardContent(card, data) {
    const id = card.id.replace('chat-card-', '');
    const badge = card.querySelector(`#badge-${id}`);
    const name = card.querySelector(`#name-${id}`);
    const time = card.querySelector(`#time-${id}`);
    const msg = card.querySelector(`#msg-${id}`);
    const assignBadge = card.querySelector(`#assign-${id}`);

    if(name) name.textContent = data.clientName || id;
    if(time) time.textContent = formatTime(data.lastMessageAt);
    if(msg) msg.textContent = formatPreview(data.lastMessage);
    if(assignBadge) assignBadge.innerHTML = getAssignmentBadgeHTML(data);

    if (data.unread) {
        badge.classList.remove('hidden'); name.classList.add('font-black');
        time.classList.replace('text-gray-400', 'text-brand-cyan'); time.classList.add('font-bold');
        msg.classList.add('font-bold', 'text-gray-700');
    } else {
        badge.classList.add('hidden'); name.classList.remove('font-black');
        time.classList.replace('text-brand-cyan', 'text-gray-400'); time.classList.remove('font-bold');
        msg.classList.remove('font-bold', 'text-gray-700');
    }
}

function formatTime(timestamp) {
    if (!timestamp) return "";
    const date = timestamp.toDate();
    const now = new Date();
    if (date.toDateString() === now.toDateString()) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return date.toLocaleDateString([], { day: '2-digit', month: '2-digit' });
}

function formatPreview(msg) {
    if (!msg) return "...";
    if (msg.includes('image') || msg.includes('📷')) return '📷 Foto';
    if (msg.includes('audio') || msg.includes('🎤')) return '🎤 Audio';
    if (msg.includes('🌟 Sticker')) return '🌟 Sticker';
    if (msg.includes('document') || msg.includes('📄')) return '📄 Archivo'; // 🔥 NUEVO
    if (msg.includes('📍 Ubicación')) return '📍 Ubicación';
    if (msg.includes('👤 Contacto')) return '👤 Contacto';
    return msg;
}

function setActiveTab(tab) {
    currentTab = tab;
    [els.tabMine, els.tabOpen, els.tabResolved].forEach(btn => {
        if(btn) { btn.classList.remove('bg-white', 'shadow-sm', 'text-brand-black'); btn.classList.add('text-gray-500'); }
    });
    const activeBtn = tab === 'mine' ? els.tabMine : (tab === 'open' ? els.tabOpen : els.tabResolved);
    if(activeBtn) { activeBtn.classList.add('bg-white', 'shadow-sm', 'text-brand-black'); activeBtn.classList.remove('text-gray-500'); }
    initChatList();
}

if(els.tabMine) els.tabMine.onclick = () => setActiveTab('mine');
if(els.tabOpen) els.tabOpen.onclick = () => setActiveTab('open');
if(els.tabResolved) els.tabResolved.onclick = () => setActiveTab('resolved');

els.chatSearchInput.oninput = (e) => {
    const term = e.target.value.toLowerCase().trim();
    if (!term) { initChatList(); return; }
    if (chatSearchTimeout) clearTimeout(chatSearchTimeout);

    chatSearchTimeout = setTimeout(async () => {
        els.chatList.innerHTML = `<div class="p-10 text-center"><i class="fa-solid fa-circle-notch fa-spin text-brand-cyan"></i></div>`;
        try {
            const refChat = collection(db, "chats");
            if (!isNaN(term) && term.length > 5) {
               const docSnap = await getDoc(doc(db, "chats", term));
               const docSnap57 = await getDoc(doc(db, "chats", "57"+term));
               els.chatList.innerHTML = "";
               if (docSnap.exists()) els.chatList.appendChild(createChatCard(docSnap.id, docSnap.data()));
               if (docSnap57.exists()) els.chatList.appendChild(createChatCard(docSnap57.id, docSnap57.data()));
               if(!docSnap.exists() && !docSnap57.exists()) els.chatList.innerHTML = `<div class="p-4 text-center text-xs text-gray-400">No encontrado.</div>`;
               return;
            }
            const termCap = term.charAt(0).toUpperCase() + term.slice(1);
            const q = query(refChat, orderBy('clientName'), startAt(termCap), endAt(termCap + '\uf8ff'), limit(10));
            const snap = await getDocs(q);
            els.chatList.innerHTML = "";
            if (snap.empty) els.chatList.innerHTML = `<div class="p-4 text-center text-xs text-gray-400">Sin resultados.</div>`;
            else snap.forEach(d => els.chatList.appendChild(createChatCard(d.id, d.data())));
        } catch (e) { console.error(e); initChatList(); }
    }, 600); 
};

// ==========================================================================
// 2. CONVERSACIÓN
// ==========================================================================

async function openChat(chatId, data) {
    if (activeChatId === chatId) return;
    activeChatId = chatId;
    activeChatData = data;

    els.conversationPanel.classList.remove('translate-x-full');
    els.emptyState.classList.add('hidden');
    els.chatHeader.classList.remove('hidden'); els.chatHeader.classList.add('flex');
    els.msgArea.classList.remove('hidden');
    els.inputArea.classList.remove('hidden');
    els.dropdownActions.classList.add('hidden');
    els.prodPicker.classList.add('hidden');
    els.quickReplyMenu.classList.add('hidden');

    if(els.infoPanel.style.display === 'flex') {
        ordersLoadedForCurrentChat = false;
        resetOrdersPagination(activeChatId);
    } else {
        ordersLoadedForCurrentChat = false;
        els.ordersContainer.innerHTML = "";
    }

    els.activeName.textContent = data.clientName || "Usuario";
    els.activePhone.textContent = `+${chatId}`;
    if (els.waLink) els.waLink.href = `https://wa.me/${chatId}`;

    updateHeaderAssignmentBadge(data);

    els.infoName.textContent = data.clientName || "Usuario";
    els.infoPhone.textContent = `+${chatId}`;
    els.infoBadge.textContent = "Sin verificar";
    els.infoBadge.className = "ml-auto px-2 py-0.5 bg-gray-100 text-gray-500 rounded text-[9px] font-bold uppercase";

    updateResolveButton(data.status);
    if(data.unread) updateDoc(doc(db, "chats", chatId), { unread: false }).catch(console.error);

    startSessionTimer(data.lastCustomerInteraction);
    if (unsubscribeMessages) unsubscribeMessages();
    loadMessages(chatId);
    checkInputState(); 
    els.txtInput.focus();
}

function updateResolveButton(status) {
    if (status === 'resolved') {
        els.btnResolve.innerHTML = '<i class="fa-solid fa-box-open"></i> <span class="hidden lg:inline">Reabrir</span>';
        els.btnResolve.classList.replace('hover:text-green-600', 'hover:text-blue-600');
        els.btnResolve.classList.replace('hover:bg-green-50', 'hover:bg-blue-50');
    } else {
        els.btnResolve.innerHTML = '<i class="fa-solid fa-check"></i> <span class="hidden lg:inline">Resolver</span>';
        els.btnResolve.classList.replace('hover:text-blue-600', 'hover:text-green-600');
        els.btnResolve.classList.replace('hover:bg-blue-50', 'hover:bg-green-50');
    }
}

els.btnResolve.onclick = async () => {
    if(!activeChatId) return;
    const isResolved = els.btnResolve.innerText.includes('Reabrir');
    const newStatus = isResolved ? 'open' : 'resolved';
    
    els.btnResolve.disabled = true;
    try {
        const updates = { status: newStatus };
        if (newStatus === 'resolved') updates.assignedTo = null; 
        
        await updateDoc(doc(db, "chats", activeChatId), updates);
        
        if ((currentTab === 'open' || currentTab === 'mine') && newStatus === 'resolved') {
            closeActiveChat();
        } else {
            updateResolveButton(newStatus);
            activeChatData.status = newStatus;
            if (newStatus === 'resolved') activeChatData.assignedTo = null;
            updateHeaderAssignmentBadge(activeChatData);
        }
    } catch(e) { console.error(e); } 
    finally { els.btnResolve.disabled = false; }
};

// ==========================================================================
// 3. MENSAJERÍA
// ==========================================================================

function loadMessages(id) {
    const liveContainerExists = document.getElementById('live-messages-container');
    const historyContainerExists = document.getElementById('history-messages-container');
    const btnWrapper = document.getElementById('btn-load-more-wrapper'); 

    if (liveContainerExists && historyContainerExists) {
        liveContainerExists.innerHTML = ""; historyContainerExists.innerHTML = "";
        if (btnWrapper) {
            btnWrapper.innerHTML = ""; 
            const btn = document.createElement('button');
            btn.className = "text-xs font-bold text-brand-cyan hover:underline bg-cyan-50 px-3 py-1 rounded-full border border-cyan-100 transition";
            btn.innerHTML = '<i class="fa-solid fa-clock-rotate-left"></i> Cargar mensajes anteriores';
            btn.onclick = loadOlderMessages;
            btnWrapper.appendChild(btn);
        }
    } else {
        els.msgArea.innerHTML = "";
        createLoadMoreButton(); 
        const historyDiv = document.createElement('div'); historyDiv.id = 'history-messages-container'; els.msgArea.appendChild(historyDiv);
        const liveDiv = document.createElement('div'); liveDiv.id = 'live-messages-container'; els.msgArea.appendChild(liveDiv);
    }
    
    oldestMessageDoc = null;
    const q = query(collection(db, "chats", id, "messages"), orderBy("timestamp", "asc"), limitToLast(20));
    
    unsubscribeMessages = onSnapshot(q, (snapshot) => {
        if (!document.getElementById('live-messages-container')) {
            els.msgArea.innerHTML = ""; createLoadMoreButton(); 
            const historyDiv = document.createElement('div'); historyDiv.id = 'history-messages-container'; els.msgArea.appendChild(historyDiv);
            const liveDiv = document.createElement('div'); liveDiv.id = 'live-messages-container'; els.msgArea.appendChild(liveDiv);
        }

        const liveContainer = document.getElementById('live-messages-container');
        if (!snapshot.empty) oldestMessageDoc = snapshot.docs[0];

        const isAtBottom = els.msgArea.scrollHeight - els.msgArea.scrollTop - els.msgArea.clientHeight < 100;

        snapshot.docChanges().forEach(change => {
            const data = change.doc.data();
            const msgId = change.doc.id;

            if (change.type === "added") {
                const node = createMessageNode(data); node.id = `msg-${msgId}`;
                liveContainer.appendChild(node);
                node.classList.add('animate-in', 'fade-in', 'slide-in-from-bottom-2');
            }
            if (change.type === "modified") {
                const existing = document.getElementById(`msg-${msgId}`);
                if (existing) {
                    const newNode = createMessageNode(data); newNode.id = `msg-${msgId}`;
                    liveContainer.replaceChild(newNode, existing);
                }
            }
            if (change.type === "removed") {
                const existing = document.getElementById(`msg-${msgId}`);
                if (existing) existing.remove();
            }
        });

        if (isAtBottom || snapshot.metadata.fromCache) {
            setTimeout(() => { els.msgArea.scrollTo({ top: els.msgArea.scrollHeight, behavior: 'smooth' }); }, 100);
        }
    });
}

function createLoadMoreButton() {
    const btnContainer = document.createElement('div'); btnContainer.className = "flex justify-center py-4"; btnContainer.id = "btn-load-more-wrapper";
    const btn = document.createElement('button'); btn.className = "text-xs font-bold text-brand-cyan hover:underline bg-cyan-50 px-3 py-1 rounded-full border border-cyan-100 transition"; btn.innerHTML = '<i class="fa-solid fa-clock-rotate-left"></i> Cargar mensajes anteriores'; btn.onclick = loadOlderMessages;
    btnContainer.appendChild(btn); els.msgArea.prepend(btnContainer);
}

async function loadOlderMessages() {
    if (!activeChatId || !oldestMessageDoc || isChatLoading) return;
    const btnWrapper = document.getElementById('btn-load-more-wrapper');
    const btn = btnWrapper.querySelector('button');
    const historyContainer = document.getElementById('history-messages-container');
    
    isChatLoading = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Cargando...';

    try {
        const previousHeight = els.msgArea.scrollHeight;
        const previousScroll = els.msgArea.scrollTop;

        const q = query(collection(db, "chats", activeChatId, "messages"), orderBy("timestamp", "desc"), startAfter(oldestMessageDoc), limit(20));
        const snap = await getDocs(q);

        if (snap.empty) {
            btnWrapper.innerHTML = `<span class="text-[10px] text-gray-400">Inicio de la conversación</span>`;
            isChatLoading = false; return;
        }

        oldestMessageDoc = snap.docs[snap.docs.length - 1];
        const docsReversed = snap.docs.reverse();

        const fragment = document.createDocumentFragment();
        docsReversed.forEach(doc => { fragment.appendChild(createMessageNode(doc.data())); });
        historyContainer.prepend(fragment);

        const newHeight = els.msgArea.scrollHeight;
        els.msgArea.scrollTop = newHeight - previousHeight + previousScroll;

        btn.innerHTML = '<i class="fa-solid fa-clock-rotate-left"></i> Cargar más antiguos';

    } catch (e) { console.error(e); btn.innerHTML = "Error al cargar"; } 
    finally { isChatLoading = false; }
}

function formatWhatsAppText(text) {
    if (!text) return "";
    let safeText = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return safeText
        .replace(/\*(.*?)\*/g, '<strong class="font-black">$1</strong>')
        .replace(/_(.*?)_/g, '<em class="italic">$1</em>')             
        .replace(/~(.*?)~/g, '<del class="line-through">$1</del>');    
}

function createMessageNode(m) {
    const inc = m.type === 'incoming';
    let contentHtml = "";
    
    const textClasses = "text-[13px] md:text-sm text-gray-800 whitespace-pre-wrap break-words leading-relaxed";
    const formattedContent = formatWhatsAppText(m.content);
    
    if (m.messageType === 'text' || m.type === 'text') {
        contentHtml = `<p class="${textClasses}">${formattedContent}</p>`;
    } 
    else if ((m.messageType === 'image' || m.type === 'image') && m.mediaUrl) {
        contentHtml = `
            <a href="${m.mediaUrl}" target="_blank" class="block w-full">
                <img src="${m.mediaUrl}" loading="lazy" class="rounded-lg w-full max-w-[250px] md:max-w-xs object-cover border border-black/5 hover:opacity-90 transition">
            </a>
            ${m.content && m.content !== '📷 Imagen recibida' ? `<p class="${textClasses} mt-2">${formattedContent}</p>` : ''}
        `;
    } 
    else if ((m.messageType === 'audio' || m.type === 'audio') && m.mediaUrl) {
        contentHtml = `
            <audio controls class="w-[200px] md:w-[260px] h-10 outline-none">
                <source src="${m.mediaUrl}">
            </audio>
        `;
    } 
    else if (m.messageType === 'sticker' || m.type === 'sticker') {
        contentHtml = `<img src="${m.mediaUrl}" loading="lazy" class="w-32 h-32 object-contain drop-shadow-md">`;
    } 
    else if ((m.messageType === 'document' || m.type === 'document') && m.mediaUrl) {
        contentHtml = `
            <div class="flex items-center gap-3 bg-white/50 p-3 rounded-lg border border-gray-200 mt-1 mb-1 min-w-[200px]">
                <div class="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center text-red-500 shrink-0 shadow-inner">
                    <i class="fa-solid fa-file-pdf text-lg"></i>
                </div>
                <div class="min-w-0 flex-1">
                    <p class="text-xs font-bold text-gray-800 truncate">${m.content || "Documento Adjunto"}</p>
                    <a href="${m.mediaUrl}" target="_blank" class="text-[10px] font-black text-brand-cyan uppercase hover:underline mt-1 block">Descargar Archivo</a>
                </div>
            </div>
        `;
    }
    else if (m.messageType === 'location' || m.type === 'location') {
        contentHtml = `
            <div class="flex flex-col items-center bg-slate-50/50 p-3 rounded-lg border border-gray-200 min-w-[200px]">
                <i class="fa-solid fa-map-location-dot text-3xl text-red-500 mb-2"></i>
                <p class="text-xs font-bold text-gray-700 text-center leading-tight mb-2 break-words">${m.content.replace('📍 Ubicación:', '').trim() || 'Ubicación compartida'}</p>
                <a href="${m.mediaUrl}" target="_blank" class="w-full bg-brand-cyan text-brand-black text-[10px] font-black uppercase tracking-widest py-2 rounded-md text-center hover:shadow-md transition">Abrir en Mapa</a>
            </div>`;
    } 
    else if (m.messageType === 'contacts' || m.type === 'contacts') {
        const cName = m.content.replace('👤 Contacto:', '').trim();
        const cPhone = m.mediaUrl;
        contentHtml = `
            <div class="flex flex-col bg-slate-50/50 p-3 rounded-lg border border-gray-200 min-w-[200px]">
                <div class="flex items-center gap-3 mb-3">
                    <div class="w-10 h-10 rounded-full bg-gray-300 flex items-center justify-center text-white shrink-0"><i class="fa-solid fa-user text-lg"></i></div>
                    <div class="overflow-hidden">
                        <p class="text-xs font-bold text-brand-black truncate">${cName}</p>
                        <p class="text-[10px] text-gray-500 font-mono">+${cPhone}</p>
                    </div>
                </div>
                <a href="https://wa.me/${cPhone}" target="_blank" class="w-full bg-brand-black text-white text-[10px] font-black uppercase tracking-widest py-2 rounded-md text-center hover:bg-brand-cyan hover:text-brand-black transition">Enviar Mensaje</a>
            </div>`;
    } 
    else {
        contentHtml = `<p class="text-sm text-gray-800 italic break-words">[Archivo no soportado: ${m.messageType || m.type}]</p>`;
    }

    const div = document.createElement('div');
    div.className = `flex w-full mb-1 ${inc ? 'justify-start' : 'justify-end'}`;
    const time = m.timestamp ? m.timestamp.toDate().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '';
    
    let authorTag = '';
    if (!inc && m.sentBy) {
        const shortName = m.sentBy.includes('@') ? m.sentBy.split('@')[0] : m.sentBy;
        authorTag = `<span class="block text-[10px] font-bold text-emerald-700 mb-1 leading-none capitalize">${shortName}</span>`;
    }
    
    let errorTag = '';
    if (m.error) {
        errorTag = `
        <div class="bg-red-50 border border-red-200 text-red-600 text-[10px] p-2 rounded-md mt-2 font-bold leading-tight">
            <i class="fa-solid fa-circle-exclamation mr-1"></i> Fallo de entrega: ${m.errorDetails}
        </div>`;
    }
    
    const isSticker = m.messageType === 'sticker' || m.type === 'sticker';
    const bubbleClass = isSticker 
        ? 'bg-transparent' 
        : (inc ? 'chat-bubble-in border border-gray-200/50' : 'chat-bubble-out border border-green-200/50');
    
    div.innerHTML = `
        <div class="max-w-[85%] md:max-w-[70%] px-3 py-2 ${bubbleClass} relative group flex flex-col min-w-[100px]">
            ${authorTag}
            <div class="w-full overflow-hidden break-words">
                ${contentHtml}
            </div>
            ${errorTag}
            <div class="w-full flex justify-end items-end gap-1 mt-1 opacity-60 shrink-0">
                <span class="text-[9px] font-bold leading-none ${isSticker ? 'text-gray-400 bg-white/80 px-1 rounded-md' : ''}">${time}</span>
                ${!inc && !isSticker && !m.error ? `<i class="fa-solid fa-check-double text-[10px] leading-none text-blue-500"></i>` : ''}
            </div>
        </div>
    `;
    return div;
}

async function sendMessage() {
    const text = els.txtInput.value.trim();
    if (!text || !activeChatId) return;
    
    els.txtInput.value = ""; 
    els.txtInput.style.height = 'auto'; 
    els.txtInput.style.overflowY = 'hidden';
    checkInputState(); 
    els.txtInput.focus();
    
    try {
        await assignToMeIfNeeded();
        const sendFn = httpsCallable(functions, 'sendWhatsappMessage');
        await sendFn({ phoneNumber: activeChatId, message: text, type: 'text' });
    } catch (e) {
        console.error(e); alert("Error al enviar: " + e.message); 
        els.txtInput.value = text; 
        els.txtInput.style.height = Math.min(els.txtInput.scrollHeight, 76) + 'px';
        checkInputState();
    }
}

els.txtInput.addEventListener('input', (e) => {
    els.txtInput.style.height = 'auto'; 
    const scrollHeight = els.txtInput.scrollHeight;
    els.txtInput.style.height = Math.min(scrollHeight, 76) + 'px';
    els.txtInput.style.overflowY = scrollHeight > 76 ? 'auto' : 'hidden';

    checkInputState();

    const val = e.target.value;
    if (val.startsWith('/')) {
        const filter = val.substring(1).toLowerCase();
        renderQuickReplies(filter); 
        els.quickReplyMenu.classList.remove('hidden');
    } else { 
        els.quickReplyMenu.classList.add('hidden'); 
    }
});

function renderQuickReplies(filter) {
    els.quickReplyList.innerHTML = "";
    const filtered = QUICK_REPLIES.filter(r => r.title.toLowerCase().includes(filter) || r.text.toLowerCase().includes(filter));
    
    if (filtered.length === 0) { 
        els.quickReplyList.innerHTML = `<div class="p-6 text-xs text-gray-400 font-bold text-center uppercase tracking-widest">Sin resultados</div>`; 
        return; 
    }

    filtered.forEach(r => {
        const div = document.createElement('div'); 
        const formattedPreview = formatWhatsAppText(r.text);

        div.className = "p-4 hover:bg-slate-50 cursor-pointer border-b border-gray-50 last:border-0 transition-colors group";
        div.innerHTML = `
            <p class="text-[11px] font-black uppercase text-brand-cyan mb-1.5 flex items-center gap-2 group-hover:translate-x-1 transition-transform">
                <i class="fa-solid fa-bolt text-yellow-500"></i> ${r.title}
            </p>
            <p class="text-xs font-medium text-gray-600 line-clamp-2 leading-relaxed pr-2">${formattedPreview}</p>
        `;
        
        div.onclick = () => {
            els.txtInput.value = r.text; 
            els.txtInput.style.height = 'auto';
            const scrollHeight = els.txtInput.scrollHeight;
            els.txtInput.style.height = Math.min(scrollHeight, 76) + 'px';
            els.txtInput.style.overflowY = scrollHeight > 76 ? 'auto' : 'hidden';
            
            els.quickReplyMenu.classList.add('hidden'); 
            els.txtInput.focus(); 
            checkInputState();
        };
        els.quickReplyList.appendChild(div);
    });
}

// ==========================================================================
// 5. CATALOGO RÁPIDO (CERO LECTURAS EXTRAS)
// ==========================================================================

els.btnProducts.onclick = () => {
    els.prodPicker.classList.toggle('hidden');
    if (!els.prodPicker.classList.contains('hidden')) { 
        els.prodSearch.value = ""; 
        els.prodSearch.focus(); 
        renderProductList(chatProductsCache.slice(0, 20)); 
    }
};

els.closeProdBtn.onclick = () => els.prodPicker.classList.add('hidden');

els.prodSearch.oninput = (e) => executeSearch(e.target.value);

function executeSearch(rawTerm) {
    if (rawTerm.trim().length === 0) { renderProductList(chatProductsCache.slice(0, 20)); return; }
    const term = normalizeText(rawTerm);
    const results = chatProductsCache.filter(p => normalizeText(p.name).includes(term) || normalizeText(p.category).includes(term) || normalizeText(p.subcategory).includes(term));
    if (results.length === 0) els.prodList.innerHTML = `<div class="p-4 text-center text-xs text-gray-400"><p>No encontrado en el catálogo.</p></div>`;
    else renderProductList(results.slice(0, 20));
}

function renderProductList(products) {
    els.prodList.innerHTML = "";
    if (products.length === 0) { els.prodList.innerHTML = `<div class="p-2 text-xs text-gray-400">No hay productos.</div>`; return; }
    
    products.forEach(p => {
        const isVariable = !p.isSimple || (p.combinations && p.combinations.length > 0);
        const priceLabel = isVariable ? `<span class="text-[9px] text-gray-400 font-normal mr-1">Desde</span>` : "";
        const price = (p.price || 0).toLocaleString('es-CO');
        let img = 'https://via.placeholder.com/50?text=No+Img';
        if (p.mainImage) img = p.mainImage; else if (p.image) img = p.image; else if (p.images && p.images.length > 0) img = p.images[0]; 
                
        let warrantyBadge = "";
        if (p.warranty && p.warranty.time > 0) {
            const unit = TIME_UNITS[p.warranty.unit] || p.warranty.unit;
            warrantyBadge = `<span class="ml-2 px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded text-[8px] font-bold border border-blue-100 uppercase"><i class="fa-solid fa-shield-halved"></i> ${p.warranty.time} ${unit}</span>`;
        }

        const isPromo = (p.name && p.name.toLowerCase().includes('promo')) || (p.originalPrice > p.price);
        const priceColor = isPromo ? 'text-red-500' : 'text-emerald-600';
        const isOutOfStock = (p.stock <= 0 || p.status !== 'active');
        const stockColor = isOutOfStock ? 'text-red-500 font-bold' : 'text-gray-400';

        const div = document.createElement('div');
        div.className = `flex items-start gap-3 p-2 rounded-lg transition border-b border-gray-50 last:border-0 group ${isOutOfStock ? 'bg-gray-50 opacity-80' : 'hover:bg-slate-50 cursor-pointer'}`;
        
        div.innerHTML = `
            <div class="relative w-12 h-12 shrink-0 ${isOutOfStock ? 'grayscale' : ''}">
                <img src="${img}" class="w-full h-full rounded-md object-cover border border-gray-100 bg-white">
                ${isPromo && !isOutOfStock ? '<div class="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full border border-white"></div>' : ''}
            </div>
            <div class="min-w-0 flex-1">
                <div class="flex justify-between items-start">
                    <p class="text-[10px] font-black uppercase ${isOutOfStock ? 'text-gray-500 line-through' : 'text-brand-black group-hover:text-brand-cyan transition'} line-clamp-1">${p.name}</p>
                </div>
                <div class="flex items-center mt-0.5">
                    ${priceLabel}<span class="text-xs font-black ${priceColor}">$${price}</span>${warrantyBadge}
                </div>
                <div class="flex gap-2 mt-1">
                    ${p.definedColors?.length > 0 ? `<span class="text-[8px] text-gray-400 bg-gray-100 px-1 rounded">🎨 ${p.definedColors.length} Colores</span>` : ''}
                    <span class="text-[8px] ${stockColor} ml-auto">${isOutOfStock ? 'AGOTADO' : `Stock: ${p.stock}`}</span>
                </div>
            </div>
        `;
        if (!isOutOfStock) div.onclick = () => sendProduct(p); else div.onclick = () => alert("Producto agotado.");
        els.prodList.appendChild(div);
    });
}

async function sendProduct(p) {
    if (!confirm(`¿Enviar tarjeta de ${p.name}?`)) return;
    els.prodPicker.classList.add('hidden'); els.btnSend.disabled = true; els.btnSend.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    
    await assignToMeIfNeeded();

    const price = (p.price || 0).toLocaleString('es-CO');
    const isVariable = !p.isSimple;
    const priceText = isVariable ? `Desde $${price}` : `$${price}`;
    
    let featuresText = "";
    if (p.definedColors && p.definedColors.length > 0) featuresText += `\n🎨 *Colores:* ${p.definedColors.join(', ')}`;
    if (p.definedCapacities && p.definedCapacities.length > 0) featuresText += `\n💾 *Capacidad:* ${p.definedCapacities.join(', ')}`;

    let warrantyText = "";
    if (p.warranty && p.warranty.time > 0) {
        const unit = TIME_UNITS[p.warranty.unit] || p.warranty.unit;
        warrantyText = `\n🛡️ *Garantía:* ${p.warranty.time} ${unit} (Directa)`;
    }

    const caption = `*${p.name}*\n💲 *Precio:* ${priceText}${featuresText}${warrantyText}`.trim();
    let imgUrl = p.mainImage || p.image || (p.images && p.images[0]) || "";
    if (p.variants && p.variants.length > 0 && p.variants[0].images && p.variants[0].images.length > 0 && !imgUrl) imgUrl = p.variants[0].images[0];
    
    let msgType = 'image';
    if (!imgUrl || imgUrl.includes('via.placeholder.com')) {
        msgType = 'text';
        imgUrl = null;
    }
    
    try {
        await (httpsCallable(functions, 'sendWhatsappMessage'))({ 
            phoneNumber: activeChatId, 
            message: caption, 
            type: msgType, 
            mediaUrl: imgUrl 
        });
    } catch(e) { 
        alert("Error: " + e.message); 
    } finally { 
        els.btnSend.disabled = false; 
        els.btnSend.innerHTML = '<i class="fa-solid fa-paper-plane"></i>'; 
        els.txtInput.focus(); 
    }
}

els.btnAttach.onclick = () => els.fileInput.click();
els.fileInput.onchange = async (e) => {
    const f = e.target.files[0]; if (!f || !activeChatId) return; 
    if (!confirm(`Enviar ${f.name}?`)) { els.fileInput.value = ""; return; }
    
    els.txtInput.disabled = true; els.btnSend.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    try {
        await assignToMeIfNeeded();
        
        // 🔥 Detectar si es documento o imagen
        const isDoc = f.type.includes('pdf') || f.type.includes('document') || f.name.endsWith('.pdf') || f.name.endsWith('.docx');
        const msgType = isDoc ? 'document' : 'image';

        const r = ref(storage, `chats/${activeChatId}/uploads/${Date.now()}_${f.name}`); 
        await uploadBytes(r, f); 
        
        await (httpsCallable(functions, 'sendMessage'))({ 
            phoneNumber: activeChatId, 
            message: isDoc ? f.name : "", // Meta usa el message como nombre del archivo en docs
            type: msgType, 
            mediaUrl: await getDownloadURL(r) 
        });
    } catch (e) { alert("Error al subir archivo: " + e.message); } 
    finally { els.fileInput.value = ""; els.txtInput.disabled = false; els.btnSend.innerHTML = '<i class="fa-solid fa-paper-plane"></i>'; els.txtInput.focus(); }
};

function playSound() { try { els.notifySound.currentTime = 0; els.notifySound.play().catch(() => {}); } catch(e){} }

function startSessionTimer(ts) {
    if (timerInterval) clearInterval(timerInterval);
    const check = () => {
        if (!ts) { updateTimer(0, false, "Esperando..."); return; }
        const ms = (24*60*60*1000) - (new Date() - ts.toDate());
        if (ms <= 0) { updateTimer(0, false, "Expirado"); clearInterval(timerInterval); } else updateTimer(ms, true);
    }; check(); timerInterval = setInterval(check, 1000);
}
function updateTimer(ms, open, txt) {
    els.timerBadge.className = open ? 'flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-emerald-100 text-emerald-700' : 'flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-red-100 text-red-700';
    els.timerBadge.classList.remove('hidden');
    els.timerText.textContent = open ? `${Math.floor(ms/3600000)}h ${Math.floor((ms%3600000)/60000)}m` : txt;
    
    if(!els.txtInput.dataset.uploading) { 
        els.txtInput.disabled = !open; els.btnAttach.disabled = !open; els.btnProducts.disabled = !open;
        if (!open) { els.btnSend.disabled = true; els.btnSend.classList.add('opacity-50', 'cursor-not-allowed'); } else checkInputState(); 
    }
}

function checkInputState() {
    if (!els.txtInput.disabled && els.txtInput.value.trim().length > 0) {
        els.btnSend.disabled = false; els.btnSend.classList.remove('opacity-50', 'cursor-not-allowed', 'bg-gray-200', 'text-gray-400'); els.btnSend.classList.add('bg-brand-black', 'text-white', 'hover:bg-brand-cyan', 'hover:text-brand-black');
    } else {
        els.btnSend.disabled = true; els.btnSend.classList.add('opacity-50', 'cursor-not-allowed', 'bg-gray-200', 'text-gray-400'); els.btnSend.classList.remove('bg-brand-black', 'text-white', 'hover:bg-brand-cyan', 'hover:text-brand-black');
    }
}

// ==========================================================================
// 4. PANEL DERECHO: PEDIDOS (HISTORIAL)
// ==========================================================================

els.btnActions.onclick = (e) => { e.stopPropagation(); els.dropdownActions.classList.toggle('hidden'); };
document.addEventListener('click', (e) => { if (!els.btnActions.contains(e.target) && !els.dropdownActions.contains(e.target)) els.dropdownActions.classList.add('hidden'); });

els.closeInfoBtn.onclick = () => { 
    els.infoPanel.style.display = 'none';
};

els.btnActOrders.onclick = () => {
    els.dropdownActions.classList.add('hidden');
    els.infoPanel.style.display = 'flex';
    
    if (!ordersLoadedForCurrentChat && activeChatId) {
        resetOrdersPagination(activeChatId);
        ordersLoadedForCurrentChat = true;
    }
};

els.btnActSale.onclick = async () => {
    els.dropdownActions.classList.add('hidden'); if(!activeChatId) return;
    const cleanPhone = activeChatId.replace(/^57/, '');
    
    // 🔥 USAR RAM EN LUGAR DE GETDOCS (0 Lecturas)
    const foundUser = allClientsCache.find(c => c.phone === cleanPhone || c.phone === `+57${cleanPhone}`);
    
    await openManualSaleModal();
    if (foundUser) { 
        document.getElementById('m-cust-search').value = foundUser.name; 
        document.getElementById('m-cust-phone').value = foundUser.phone; 
    } 
    else document.getElementById('m-cust-phone').value = cleanPhone;
};

els.btnActClient.onclick = () => {
    els.dropdownActions.classList.add('hidden'); if(!activeChatId) return;
    els.inpClientName.value = ""; els.inpClientPhone.value = activeChatId.replace(/^57/, ''); els.inpClientDoc.value = ""; els.inpClientEmail.value = ""; els.inpClientAddr.value = "";
    els.inpClientDept.innerHTML = '<option>Cargando...</option>'; els.inpClientCity.innerHTML = '...';
    fetch('https://api-colombia.com/api/v1/Department').then(r => r.json()).then(d => {
        d.sort((a,b)=>a.name.localeCompare(b.name)); els.inpClientDept.innerHTML = '<option value="">Seleccione...</option>';
        d.forEach(x => { const o = document.createElement('option'); o.value=x.id; o.textContent=x.name; o.dataset.name=x.name; els.inpClientDept.appendChild(o); });
    });
    els.clientModal.classList.remove('hidden');
};

els.inpClientDept.onchange = async (e) => {
    if(!e.target.value) return; els.inpClientCity.innerHTML = '<option>Cargando...</option>'; els.inpClientCity.disabled=true;
    const c = await (await fetch(`https://api-colombia.com/api/v1/Department/${e.target.value}/cities`)).json();
    c.sort((a,b)=>a.name.localeCompare(b.name)); els.inpClientCity.innerHTML = '<option value="">Ciudad...</option>';
    c.forEach(x => els.inpClientCity.innerHTML += `<option value="${x.name}">${x.name}</option>`); els.inpClientCity.disabled=false;
};

els.btnSaveClient.onclick = async () => {
    const name = els.inpClientName.value.trim(); const phone = els.inpClientPhone.value.trim();
    if(!name || !phone) return alert("Nombre y Teléfono requeridos");
    els.btnSaveClient.disabled = true; els.btnSaveClient.innerText = "Guardando...";
    try {
        const deptName = els.inpClientDept.options[els.inpClientDept.selectedIndex]?.dataset.name || "";
        const city = els.inpClientCity.value; const address = els.inpClientAddr.value;
        await addDoc(collection(db, "users"), { name, phone, email: els.inpClientEmail.value.trim(), document: els.inpClientDoc.value.trim(), source: 'MANUAL', role: 'client', createdAt: Timestamp.now(), updatedAt: Timestamp.now(), address, dept: deptName, city, addresses: address ? [{ alias: "Principal", address, dept: deptName, city, isDefault: true }] : [] });
        alert("✅ Cliente guardado"); els.clientModal.classList.add('hidden'); els.activeName.textContent = name; els.infoName.textContent = name;
    } catch(e) { alert(e.message); } finally { els.btnSaveClient.disabled = false; els.btnSaveClient.innerText = "Guardar Cliente"; }
};

function resetOrdersPagination(phoneNumber) {
    els.ordersContainer.innerHTML = ""; els.btnLoadMore.classList.add('hidden'); lastOrderSnapshot = null;
    let n = phoneNumber; if (n.startsWith('57')) n = n.substring(2); if (n.startsWith('+57')) n = n.substring(3);
    currentPhoneNumbers = [phoneNumber, n, `+57 ${n}`, `+57${n}`, parseInt(n)]; loadOrders(true);
}

async function loadOrders(isInitial = false) {
    if (isInitial) els.ordersContainer.innerHTML = `<div class="text-center py-10"><i class="fa-solid fa-circle-notch fa-spin text-brand-cyan"></i></div>`;
    else els.btnLoadMore.disabled = true;

    try {
        const refOrd = collection(db, "orders");
        let q = query(refOrd, where("buyerInfo.phone", "in", currentPhoneNumbers), orderBy("createdAt", "desc"), limit(ORDERS_PER_PAGE));
        if (!isInitial && lastOrderSnapshot) q = query(refOrd, where("buyerInfo.phone", "in", currentPhoneNumbers), orderBy("createdAt", "desc"), startAfter(lastOrderSnapshot), limit(ORDERS_PER_PAGE));
        
        const snap = await getDocs(q); if (isInitial) els.ordersContainer.innerHTML = "";

        if (snap.empty) {
            if (isInitial) {
                const snap2 = await getDocs(query(refOrd, where("shippingData.phone", "in", currentPhoneNumbers), limit(3)));
                if (snap2.empty) { els.ordersContainer.innerHTML = `<div class="text-center py-6 border border-dashed border-gray-200 rounded-xl"><p class="text-xs text-gray-400">Sin pedidos.</p></div>`; els.infoBadge.textContent = "Visitante"; return; }
                renderOrders(snap2.docs);
            } else els.btnLoadMore.classList.add('hidden');
        } else {
            els.infoBadge.className = "ml-auto px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded text-[9px] font-bold uppercase"; els.infoBadge.textContent = "Verificado";
            lastOrderSnapshot = snap.docs[snap.docs.length - 1]; renderOrders(snap.docs);
            if (snap.docs.length < ORDERS_PER_PAGE) els.btnLoadMore.classList.add('hidden'); else els.btnLoadMore.classList.remove('hidden');
        }
    } catch (e) { els.ordersContainer.innerHTML = `<p class="text-xs text-red-400 text-center">Error al cargar.</p>`; } finally { els.btnLoadMore.disabled = false; }
}

function renderOrders(docs) {
    docs.forEach(d => {
        const o = d.data(); const date = o.createdAt?.toDate().toLocaleDateString() || 'N/A'; const total = (o.total || 0).toLocaleString('es-CO');
        let c = "bg-gray-100 text-gray-600"; if(o.status==='PAGADO') c="bg-blue-50 text-blue-600"; if(o.status==='ENTREGADO') c="bg-emerald-50 text-emerald-600";
        const div = document.createElement('div'); div.className = "bg-white border border-gray-100 rounded-xl p-3 shadow-sm hover:shadow-md cursor-pointer group"; div.onclick = () => viewOrderDetail(d.id);
        div.innerHTML = `<div class="flex justify-between items-start mb-2"><div><span class="text-[10px] font-black uppercase text-gray-400">#${d.id.slice(0,8).toUpperCase()}</span><p class="text-xs font-bold text-brand-black mt-0.5">${date}</p></div><span class="px-2 py-1 rounded text-[9px] font-black uppercase ${c}">${o.status}</span></div><div class="flex justify-between items-center border-t border-gray-50 pt-2"><span class="text-sm font-black">$${total}</span><span class="text-[10px] font-bold text-brand-cyan group-hover:underline">Ver <i class="fa-solid fa-arrow-right"></i></span></div>`;
        els.ordersContainer.appendChild(div);
    });
}

els.btnSearchOrder.onclick = async () => {
    let term = els.inputSearchOrder.value.trim(); if (term.startsWith('#')) term = term.substring(1); if (!term) return;
    els.ordersContainer.innerHTML = `<div class="text-center py-4"><i class="fa-solid fa-circle-notch fa-spin text-brand-cyan"></i></div>`; els.btnLoadMore.classList.add('hidden');
    try { const s = await getDoc(doc(db, "orders", term)); if(s.exists()) { els.ordersContainer.innerHTML = ""; renderOrders([s]); return; } } catch(e) {}
    try {
        const matches = (await getDocs(query(collection(db, "orders"), where("buyerInfo.phone", "in", currentPhoneNumbers), orderBy("createdAt", "desc"), limit(20)))).docs.filter(d => d.id.toUpperCase().startsWith(term.toUpperCase()));
        if (matches.length > 0) { els.ordersContainer.innerHTML = `<div class="bg-blue-50 text-blue-700 text-[10px] p-2 rounded mb-2 font-bold text-center">Encontrado en historial</div>`; renderOrders(matches); } 
        else { els.ordersContainer.innerHTML = `<div class="text-center py-4"><p class="text-xs text-red-400 font-bold">No encontrada</p><button onclick="window.resetOrdersPagination('${activeChatId}')" class="text-[10px] underline mt-3 text-brand-black font-bold">Volver</button></div>`; }
    } catch(e) { alert("Error"); }
};

if(els.btnSend) els.btnSend.onclick = sendMessage;
if(els.txtInput) els.txtInput.onkeypress = (e) => { if(e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }};
if(els.btnLoadMore) els.btnLoadMore.onclick = () => loadOrders(false);
if(els.inputSearchOrder) els.inputSearchOrder.onkeypress = (e) => { if(e.key === 'Enter') { e.preventDefault(); els.btnSearchOrder.click(); }};
window.resetOrdersPagination = resetOrdersPagination;

// ==========================================================================
// 6. CERRAR CHAT ACTIVO
// ==========================================================================

function closeActiveChat() {
    if (!activeChatId) return;

    activeChatId = null;
    activeChatData = null;
    if (timerInterval) clearInterval(timerInterval);

    els.emptyState.classList.remove('hidden');
    els.chatHeader.classList.add('hidden');
    els.chatHeader.classList.remove('flex');
    els.msgArea.classList.add('hidden');
    els.inputArea.classList.add('hidden');
    
    els.infoPanel.style.display = 'none';
    els.dropdownActions.classList.add('hidden');

    document.querySelectorAll('[id^="chat-card-"]').forEach(el => el.classList.remove('bg-gray-100'));
    els.conversationPanel.classList.add('translate-x-full');
}

if (els.btnCloseChat) els.btnCloseChat.onclick = closeActiveChat;
if (els.backBtn) els.backBtn.onclick = closeActiveChat; 

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && activeChatId) closeActiveChat();
});

// ==========================================================================
// 7. MARKETING MASIVO (CAMPAÑAS INTELIGENTES)
// ==========================================================================

function initMarketingCampaigns() {
    const elsCamp = {
        trigger: document.getElementById('btn-open-campaigns'),
        modal: document.getElementById('campaign-modal'),
        counter: document.getElementById('monthly-counter'),
        tplName: document.getElementById('camp-template-name'),
        customMsg: document.getElementById('camp-custom-msg'),
        imgUrl: document.getElementById('camp-img-url'),
        imgPreview: document.getElementById('camp-img-preview'),
        fileInput: document.getElementById('camp-file-upload'),
        btnUploadImg: document.getElementById('btn-upload-camp-img'),
        tabProd: document.getElementById('tab-link-product'),
        tabCustom: document.getElementById('tab-link-custom'),
        areaProd: document.getElementById('camp-link-product-area'),
        areaCustom: document.getElementById('camp-link-custom-area'),
        searchProd: document.getElementById('camp-search-prod'),
        resProd: document.getElementById('camp-prod-results'),
        selectedProdArea: document.getElementById('camp-selected-prod'),
        selectedProdName: document.getElementById('camp-prod-name'),
        btnClearProd: document.getElementById('btn-clear-prod'),
        customUrl: document.getElementById('camp-custom-url'),
        btnCalc: document.getElementById('btn-calc-audience'),
        resText: document.getElementById('audience-result'),
        resCount: document.getElementById('audience-count'),
        btnSend: document.getElementById('btn-send-campaign'),
        audienceList: document.getElementById('audience-list-container'),
        btnUncheckAll: document.getElementById('btn-uncheck-all')
    };

    if (!elsCamp.trigger || !elsCamp.modal) return;

    let currentAudience = [];
    let finalCampaignLink = ""; 
    let linkMode = 'product';

    elsCamp.trigger.onclick = async () => {
        elsCamp.modal.classList.remove('hidden');
        elsCamp.resText.classList.add('hidden');
        elsCamp.btnSend.disabled = true;
        elsCamp.btnSend.classList.add('opacity-50', 'cursor-not-allowed');
        currentAudience = [];
        
        const dateId = new Date().toISOString().slice(0, 7); 
        try {
            const statDoc = await getDoc(doc(db, "stats", `wa_${dateId}`));
            elsCamp.counter.innerText = statDoc.exists() ? statDoc.data().sentPromoCount || 0 : 0;
        } catch(e) {}
    };

    elsCamp.btnUploadImg.onclick = () => elsCamp.fileInput.click();
    elsCamp.fileInput.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        elsCamp.btnUploadImg.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Subiendo...';
        elsCamp.btnUploadImg.disabled = true;
        try {
            const storageRef = ref(storage, `marketing/${Date.now()}_${file.name}`);
            await uploadBytes(storageRef, file);
            const url = await getDownloadURL(storageRef);
            elsCamp.imgUrl.value = url;
            elsCamp.imgPreview.innerHTML = `<img src="${url}" class="w-full h-full object-cover">`;
        } catch(err) { alert("Error al subir imagen."); } 
        finally { elsCamp.btnUploadImg.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> Cambiar Imagen'; elsCamp.btnUploadImg.disabled = false; validateCampaignForm(); }
    };

    elsCamp.tabProd.onclick = () => {
        linkMode = 'product';
        elsCamp.tabProd.classList.add('bg-white', 'shadow-sm', 'text-brand-black'); elsCamp.tabProd.classList.remove('text-gray-500');
        elsCamp.tabCustom.classList.remove('bg-white', 'shadow-sm', 'text-brand-black'); elsCamp.tabCustom.classList.add('text-gray-500');
        elsCamp.areaProd.classList.remove('hidden'); elsCamp.areaCustom.classList.add('hidden');
        validateCampaignForm();
    };

    elsCamp.tabCustom.onclick = () => {
        linkMode = 'custom';
        elsCamp.tabCustom.classList.add('bg-white', 'shadow-sm', 'text-brand-black'); elsCamp.tabCustom.classList.remove('text-gray-500');
        elsCamp.tabProd.classList.remove('bg-white', 'shadow-sm', 'text-brand-black'); elsCamp.tabProd.classList.add('text-gray-500');
        elsCamp.areaCustom.classList.remove('hidden'); elsCamp.areaProd.classList.add('hidden');
        validateCampaignForm();
    };

    elsCamp.searchProd.oninput = (e) => {
        const term = normalizeText(e.target.value);
        if (term.length < 2) { elsCamp.resProd.classList.add('hidden'); return; }
        const results = chatProductsCache.filter(p => normalizeText(p.name).includes(term) || normalizeText(p.category).includes(term));
        if (results.length === 0) {
            elsCamp.resProd.innerHTML = '<div class="p-3 text-xs text-center text-gray-400 font-bold">No encontrado</div>';
        } else {
            elsCamp.resProd.innerHTML = results.slice(0, 5).map(p => `
                <div class="flex items-center gap-3 p-2 hover:bg-slate-50 cursor-pointer border-b border-gray-50 last:border-0" data-id="${p.id}" data-name="${p.name.replace(/"/g, '&quot;')}">
                    <img src="${p.mainImage || 'https://placehold.co/50'}" class="w-8 h-8 rounded object-cover border border-gray-100 shrink-0">
                    <div class="min-w-0"><p class="text-[10px] font-black text-brand-black uppercase truncate">${p.name}</p><p class="text-[9px] text-gray-400 font-bold">$${(p.price||0).toLocaleString('es-CO')}</p></div>
                </div>
            `).join('');

            elsCamp.resProd.querySelectorAll('div[data-id]').forEach(row => {
                row.onclick = () => {
                    const pId = row.dataset.id; const pName = row.dataset.name;
                    finalCampaignLink = `shop/product.html?id=${pId}`;
                    elsCamp.selectedProdName.textContent = pName;
                    elsCamp.resProd.classList.add('hidden'); elsCamp.searchProd.value = ""; elsCamp.searchProd.classList.add('hidden');
                    elsCamp.selectedProdArea.classList.remove('hidden'); elsCamp.selectedProdArea.classList.add('flex');
                    validateCampaignForm();
                };
            });
        }
        elsCamp.resProd.classList.remove('hidden');
    };

    elsCamp.btnClearProd.onclick = () => {
        finalCampaignLink = ""; elsCamp.selectedProdArea.classList.add('hidden'); elsCamp.selectedProdArea.classList.remove('flex');
        elsCamp.searchProd.classList.remove('hidden'); elsCamp.searchProd.focus(); validateCampaignForm();
    };

    elsCamp.customUrl.oninput = () => { finalCampaignLink = elsCamp.customUrl.value.trim(); validateCampaignForm(); };
    elsCamp.customMsg.addEventListener('input', validateCampaignForm);

    function validateCampaignForm() {
        const hasImg = elsCamp.imgUrl.value.trim().length > 0; const hasLink = finalCampaignLink.length > 2; const hasMsg = elsCamp.customMsg.value.trim().length > 0;
        const checkedCount = elsCamp.audienceList ? elsCamp.audienceList.querySelectorAll('.audience-checkbox:checked').length : 0;
        if (hasImg && hasLink && checkedCount > 0 && hasMsg) { elsCamp.btnSend.disabled = false; elsCamp.btnSend.classList.remove('opacity-50', 'cursor-not-allowed'); } 
        else { elsCamp.btnSend.disabled = true; elsCamp.btnSend.classList.add('opacity-50', 'cursor-not-allowed'); }
    }

    elsCamp.btnCalc.onclick = async () => {
        const selectedSources = Array.from(document.querySelectorAll('.filter-source:checked')).map(cb => cb.value);
        if (selectedSources.length === 0) return alert("Selecciona al menos un origen.");
        elsCamp.btnCalc.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Buscando...';
        
        try {
            // 🔥 USAR RAM EN LUGAR DE GETDOCS
            currentAudience = allClientsCache.filter(u => {
                if (!u.phone || u.phone.length < 10) return false;
                const source = (u.source || 'WEB').toUpperCase();
                if (selectedSources.includes('MAYORISTA') && u.role === 'mayorista') return true;
                if (selectedSources.includes('WEB') && (source !== 'MANUAL' && source !== 'MAYORISTA' && source !== 'EXCEL_IMPORT')) return true;
                if (selectedSources.includes('MANUAL') && (source === 'MANUAL' || source === 'EXCEL_IMPORT')) return true;
                return false;
            });

            elsCamp.audienceList.innerHTML = currentAudience.map((u, index) => `
                <label class="flex items-center justify-between p-2 hover:bg-slate-50 rounded-lg cursor-pointer transition border border-transparent hover:border-gray-100">
                    <div class="min-w-0 flex-1 pr-3"><p class="text-[10px] font-black text-brand-black uppercase truncate">${u.name || u.userName || 'Sin Nombre'}</p><p class="text-[9px] text-gray-500 font-mono">${u.phone}</p></div>
                    <input type="checkbox" class="audience-checkbox w-4 h-4 text-brand-cyan rounded border-gray-300 focus:ring-brand-cyan" value="${index}" checked>
                </label>
            `).join('');

            const updateCount = () => { elsCamp.resCount.innerText = elsCamp.audienceList.querySelectorAll('.audience-checkbox:checked').length; validateCampaignForm(); };
            elsCamp.audienceList.querySelectorAll('.audience-checkbox').forEach(cb => cb.addEventListener('change', updateCount));
            elsCamp.btnUncheckAll.onclick = () => {
                const allChecked = elsCamp.audienceList.querySelectorAll('.audience-checkbox:checked').length > 0;
                elsCamp.audienceList.querySelectorAll('.audience-checkbox').forEach(cb => cb.checked = !allChecked);
                elsCamp.btnUncheckAll.innerText = allChecked ? "Marcar Todos" : "Desmarcar Todos"; updateCount();
            };

            elsCamp.resCount.innerText = currentAudience.length; elsCamp.resText.classList.remove('hidden'); validateCampaignForm();
        } catch(e) { alert("Error calculando audiencia: " + e.message); } finally { elsCamp.btnCalc.innerHTML = '<i class="fa-solid fa-users mr-1"></i> Calcular Audiencia'; }
    };

    // --- ENVIAR CAMPAÑA CON HISTORIAL (AUDITORÍA) ---
    elsCamp.btnSend.onclick = async () => {
        const finalAudience = Array.from(elsCamp.audienceList.querySelectorAll('.audience-checkbox:checked')).map(cb => currentAudience[parseInt(cb.value)]);
        
        const templateName = "promo_pixeltech_v1"; 
        const customMessage = elsCamp.customMsg.value.trim();
        
        if (!confirm(`¿Enviar esta promoción a ${finalAudience.length} clientes?`)) return;

        elsCamp.btnSend.disabled = true;
        elsCamp.btnSend.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Iniciando...';

        let successCount = 0;
        const sendFn = httpsCallable(functions, 'sendMassTemplate'); 

        const currentUser = auth.currentUser;
        const agentEmail = currentUser.email;
        const agentName = currentUser.displayName || agentEmail.split('@')[0];
        const monthId = new Date().toISOString().slice(0, 7); 

        const audienceLog = [];

        for (let i = 0; i < finalAudience.length; i++) {
            let clientRealName = finalAudience[i].name || finalAudience[i].userName || "Sin Nombre";
            try {
                let firstName = clientRealName.split(' ')[0];

                await sendFn({
                    phoneNumber: finalAudience[i].phone,
                    templateName: templateName,
                    imageUrl: elsCamp.imgUrl.value.trim(),
                    clientName: firstName,
                    customMessage: customMessage,
                    linkPath: finalCampaignLink
                });
                successCount++;
                
                audienceLog.push({ name: clientRealName, phone: finalAudience[i].phone, status: "Enviado" });
                
                await new Promise(r => setTimeout(r, 600)); 
                elsCamp.btnSend.innerHTML = `<i class="fa-solid fa-paper-plane"></i> Enviando... (${successCount}/${finalAudience.length})`;
            } catch (e) {
                console.error(`Fallo envío a ${finalAudience[i].phone}:`, e);
                audienceLog.push({ name: clientRealName, phone: finalAudience[i].phone, status: "Fallido" });
            }
        }

        if (successCount > 0 || audienceLog.length > 0) {
            try {
                const statRef = doc(db, "stats", `wa_${monthId}`);
                const statDoc = await getDoc(statRef);
                if(statDoc.exists()) {
                    await updateDoc(statRef, { sentPromoCount: (statDoc.data().sentPromoCount || 0) + successCount });
                } else {
                    await setDoc(statRef, { sentPromoCount: successCount });
                }

                await addDoc(collection(db, "campaigns_history"), {
                    month: monthId,
                    templateName: templateName,
                    customMessage: customMessage,
                    linkPath: finalCampaignLink,
                    imageUrl: elsCamp.imgUrl.value.trim(),
                    configuredBy: agentName, 
                    sentBy: agentName,       
                    sentByEmail: agentEmail,
                    targetCount: finalAudience.length,
                    successCount: successCount,
                    audience: audienceLog,   
                    createdAt: Timestamp.now()
                });

            } catch(e) {
                console.error("Error guardando historial de auditoría:", e);
            }
        }

        alert(`✅ Campaña Finalizada.\nMensajes enviados: ${successCount} de ${finalAudience.length}`);
        elsCamp.modal.classList.add('hidden');
        elsCamp.btnSend.innerHTML = '<i class="fa-solid fa-paper-plane mr-1"></i> Iniciar Envío Masivo';
        
        elsCamp.imgUrl.value = "";
        elsCamp.customMsg.value = "";
        elsCamp.imgPreview.innerHTML = '<i class="fa-regular fa-image text-gray-300 text-2xl"></i>';
        elsCamp.btnClearProd.click();
        elsCamp.resText.classList.add('hidden');
        elsCamp.audienceList.innerHTML = "";
        currentAudience = [];
    };
}

initMarketingCampaigns();

// ==========================================================================
// 8. PRUEBA DE PLANTILLA (HELLO WORLD)
// ==========================================================================
const btnTestTemplate = document.getElementById('btn-test-template');
if (btnTestTemplate) {
    btnTestTemplate.onclick = async () => {
        const phone = prompt("🧪 PRUEBA DE CONEXIÓN\n\nIngresa tu número de WhatsApp con código de país (Ej: 573001234567):");
        if (!phone) return;
        
        const originalHtml = btnTestTemplate.innerHTML; 
        btnTestTemplate.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>'; 
        btnTestTemplate.disabled = true;
        
        try {
            await (httpsCallable(functions, 'sendTestTemplate'))({ phoneNumber: phone.trim() }); 
            alert("✅ ¡ÉXITO!\nLa plantilla 'hello_world' fue enviada. Revisa tu celular.");
        } catch (e) { 
            alert("❌ ERROR DE META:\n" + e.message); 
        } finally { 
            btnTestTemplate.innerHTML = originalHtml; 
            btnTestTemplate.disabled = false; 
        }
    };
}

// ==========================================================================
// 9. PANEL DE ESTADÍSTICAS (SOLO ADMINISTRADOR)
// ==========================================================================
import { getDoc } from "./firebase-init.js"; 

async function loadAdminStats() {
    if (!els.adminStatsSection || !auth.currentUser) return;

    try {
        const userDoc = await getDoc(doc(db, "users", auth.currentUser.uid));
        if (!userDoc.exists() || userDoc.data().role !== 'admin') {
            return; 
        }

        els.adminStatsSection.classList.remove('hidden');

        const staffSnap = await getDocs(query(collection(db, "users"), where("role", "in", ["admin", "ventas", "logistica", "contabilidad"])));
        const staffMap = {};
        staffSnap.forEach(d => {
            const data = d.data();
            if (data.email) {
                staffMap[data.email.toLowerCase()] = data.name || data.userName || data.email.split('@')[0];
            }
        });

        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const chatsSnap = await getDocs(query(collection(db, "chats"), where("lastMessageAt", ">=", thirtyDaysAgo)));
        
        const stats = {};

        chatsSnap.forEach(d => {
            const chat = d.data();
            let email = null;
            let isActive = false;
            let isResolved = false;

            if (chat.status === 'open' && chat.assignedTo) {
                email = chat.assignedTo.toLowerCase();
                isActive = true;
            } else if (chat.status === 'resolved' && chat.lastAttendedBy) {
                email = chat.lastAttendedBy.toLowerCase();
                isResolved = true;
            }

            if (email) {
                if (!stats[email]) stats[email] = { active: 0, resolved: 0, total: 0 };
                if (isActive) stats[email].active++;
                if (isResolved) stats[email].resolved++;
                stats[email].total++;
            }
        });

        els.adminStatsTbody.innerHTML = "";
        
        const emails = Object.keys(stats).sort((a, b) => stats[b].total - stats[a].total);

        if (emails.length === 0) {
            els.adminStatsTbody.innerHTML = `<tr><td colspan="4" class="p-4 text-center text-[9px] font-bold text-gray-400 uppercase tracking-widest">Sin chats registrados en los últimos 30 días.</td></tr>`;
            return;
        }

        emails.forEach(email => {
            const name = staffMap[email] || email.split('@')[0];
            const s = stats[email];
            
            const tr = document.createElement('tr');
            tr.className = "hover:bg-slate-50 transition border-b border-gray-50 last:border-0";
            tr.innerHTML = `
                <td class="p-2 py-3 font-bold text-[10px] uppercase text-brand-black truncate max-w-[120px]">
                    <div class="flex items-center gap-2">
                        <div class="w-6 h-6 rounded-full bg-brand-cyan/20 text-brand-cyan flex items-center justify-center text-[10px] shrink-0"><i class="fa-solid fa-user-tie"></i></div>
                        <span class="truncate">${name}</span>
                    </div>
                </td>
                <td class="p-2 py-3 text-center font-black text-blue-500 text-xs">${s.active}</td>
                <td class="p-2 py-3 text-center font-black text-emerald-500 text-xs">${s.resolved}</td>
                <td class="p-2 py-3 text-center font-black text-brand-black text-xs bg-gray-50 rounded-r-md">${s.total}</td>
            `;
            els.adminStatsTbody.appendChild(tr);
        });

    } catch (error) {
        console.error("Error al cargar stats:", error);
        if(els.adminStatsTbody) els.adminStatsTbody.innerHTML = `<tr><td colspan="4" class="p-4 text-center text-xs font-bold text-red-400">Error al cargar métricas.</td></tr>`;
    }
}

// ==========================================================================
// 10. LÓGICA DE AUDITORÍA DE CAMPAÑAS (VISTA EXTRACTO BANCARIO)
// ==========================================================================

const btnOpenAudit = document.getElementById('btn-open-audit');
const auditModal = document.getElementById('audit-modal');
const auditContainer = document.getElementById('audit-history-container');

let groupedMonths = {};
let sortedMonths = [];
let currentMonthIndex = 0;
let lastAuditDoc = null;
let isLoadingAudit = false;

if (btnOpenAudit) {
    btnOpenAudit.onclick = async () => {
        auditModal.classList.remove('hidden');
        auditContainer.innerHTML = `<div class="p-20 text-center"><i class="fa-solid fa-circle-notch fa-spin text-3xl text-brand-cyan"></i><p class="text-[10px] font-black uppercase text-gray-400 mt-4 tracking-widest">Generando estado de cuenta...</p></div>`;
        
        groupedMonths = {};
        sortedMonths = [];
        currentMonthIndex = 0;
        lastAuditDoc = null;
        
        await loadMoreAuditData(true);
    };
}

async function loadMoreAuditData(isInitial = false) {
    if (isLoadingAudit) return;
    isLoadingAudit = true;

    try {
        const historyRef = collection(db, "campaigns_history");
        let q = query(historyRef, orderBy("createdAt", "desc"), limit(50)); 

        if (lastAuditDoc) {
            q = query(historyRef, orderBy("createdAt", "desc"), startAfter(lastAuditDoc), limit(50));
        }

        const snap = await getDocs(q);

        if (snap.empty && isInitial) {
            auditContainer.innerHTML = `<div class="p-20 text-center text-gray-400 font-bold uppercase text-xs tracking-widest">No hay campañas registradas.</div>`;
            isLoadingAudit = false;
            return;
        }

        if (!snap.empty) {
            lastAuditDoc = snap.docs[snap.docs.length - 1];

            snap.forEach(doc => {
                const camp = { id: doc.id, ...doc.data() };
                const monthId = camp.month || "Sin Mes";

                if (!groupedMonths[monthId]) {
                    groupedMonths[monthId] = {
                        monthId: monthId,
                        campaigns: [],
                        totalSent: 0,
                        totalSuccess: 0
                    };
                    if (!sortedMonths.includes(monthId)) {
                        sortedMonths.push(monthId);
                        sortedMonths.sort().reverse(); 
                    }
                }
                groupedMonths[monthId].campaigns.push(camp);
                groupedMonths[monthId].totalSent += (camp.targetCount || 0);
                groupedMonths[monthId].totalSuccess += (camp.successCount || 0);
            });
        }

        renderCurrentMonthView();

    } catch (e) {
        console.error("Error Auditoría:", e);
        if (isInitial) auditContainer.innerHTML = `<div class="p-10 text-center text-red-400 font-bold uppercase text-xs">Error al cargar datos.</div>`;
    } finally {
        isLoadingAudit = false;
    }
}

function renderCurrentMonthView() {
    if (sortedMonths.length === 0) return;

    const currentMonthId = sortedMonths[currentMonthIndex];
    const group = groupedMonths[currentMonthId];

    let readableMonth = currentMonthId;
    if(currentMonthId !== "Sin Mes") {
        const [year, month] = currentMonthId.split('-');
        const dateObj = new Date(year, month - 1);
        readableMonth = dateObj.toLocaleString('es-CO', { month: 'long', year: 'numeric' });
    }

    const effectiveness = group.totalSent > 0 ? Math.round((group.totalSuccess / group.totalSent) * 100) : 0;

    let html = `
        <div class="flex items-center justify-between bg-slate-50 p-4 md:p-6 rounded-3xl mb-6 border border-gray-100 shadow-sm">
            <button id="btn-prev-month" class="w-12 h-12 rounded-full bg-white border border-gray-200 text-gray-500 hover:text-brand-cyan hover:border-brand-cyan transition flex items-center justify-center shadow-sm disabled:opacity-30 disabled:cursor-not-allowed" ${currentMonthIndex >= sortedMonths.length - 1 ? (lastAuditDoc ? '' : 'disabled') : ''} title="Mes Anterior">
                <i class="fa-solid fa-chevron-left"></i>
            </button>
            <div class="text-center">
                <h3 class="text-xl md:text-2xl font-black uppercase text-brand-black tracking-tighter">${readableMonth}</h3>
                <p class="text-[10px] md:text-xs font-bold text-gray-500 uppercase tracking-widest mt-1">
                    ${group.campaigns.length} Campañas <span class="mx-1 text-gray-300">|</span> ${group.totalSent.toLocaleString('es-CO')} Mensajes <span class="mx-1 text-gray-300">|</span> <span class="${effectiveness >= 90 ? 'text-emerald-500' : 'text-orange-500'}">${effectiveness}% Efectividad</span>
                </p>
            </div>
            <button id="btn-next-month" class="w-12 h-12 rounded-full bg-white border border-gray-200 text-gray-500 hover:text-brand-cyan hover:border-brand-cyan transition flex items-center justify-center shadow-sm disabled:opacity-30 disabled:cursor-not-allowed" ${currentMonthIndex === 0 ? 'disabled' : ''} title="Mes Siguiente">
                <i class="fa-solid fa-chevron-right"></i>
            </button>
        </div>

        <div class="bg-white border border-gray-200 rounded-3xl overflow-hidden shadow-sm">
            <div class="overflow-x-auto custom-scroll">
                <table class="w-full text-left whitespace-nowrap min-w-[800px]">
                    <thead class="bg-slate-50 text-[9px] font-black text-gray-400 uppercase tracking-widest border-b border-gray-200">
                        <tr>
                            <th class="p-4 pl-6">Día / Hora</th>
                            <th class="p-4">Detalle de Campaña</th>
                            <th class="p-4">Asesor</th>
                            <th class="p-4 text-center">Volumen</th>
                            <th class="p-4 text-center">Estado</th>
                            <th class="p-4 pr-6 text-center">Revisar</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-gray-50 text-sm">
                        ${group.campaigns.map((camp, idx) => renderCampaignRow(camp, idx)).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    `;

    auditContainer.innerHTML = html;

    const btnPrev = document.getElementById('btn-prev-month');
    const btnNext = document.getElementById('btn-next-month');

    if (btnPrev) {
        btnPrev.onclick = async () => {
            if (currentMonthIndex < sortedMonths.length - 1) {
                currentMonthIndex++;
                renderCurrentMonthView();
            } else if (lastAuditDoc) {
                btnPrev.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
                await loadMoreAuditData();
                if (currentMonthIndex < sortedMonths.length - 1) {
                    currentMonthIndex++;
                }
                renderCurrentMonthView();
            }
        };
    }

    if (btnNext) {
        btnNext.onclick = () => {
            if (currentMonthIndex > 0) {
                currentMonthIndex--;
                renderCurrentMonthView();
            }
        };
    }
}

function renderCampaignRow(camp, idx) {
    const dateObj = camp.createdAt?.toDate() || new Date();
    const day = dateObj.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' }).toUpperCase();
    const time = dateObj.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
    const successRate = camp.targetCount > 0 ? Math.round((camp.successCount / camp.targetCount) * 100) : 0;

    const audienceListHtml = (camp.audience || []).map(person => `
        <div class="flex items-center justify-between bg-white shadow-sm p-2.5 rounded-lg border border-gray-100">
            <div class="min-w-0 pr-2">
                <p class="text-[10px] font-black text-brand-black uppercase truncate">${person.name || "Sin nombre"}</p>
                <p class="text-[9px] text-gray-500 font-mono mt-0.5">${person.phone}</p>
            </div>
            <span class="text-[8px] font-black px-2 py-1 rounded uppercase ${person.status === 'Enviado' ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500'}">
                ${person.status}
            </span>
        </div>
    `).join('');

    return `
        <tr class="hover:bg-slate-50/80 transition group">
            <td class="p-4 pl-6 align-top">
                <p class="font-black text-brand-black text-xs">${day}</p>
                <p class="text-[9px] font-bold text-gray-400 mt-1">${time}</p>
            </td>
            <td class="p-4 align-top max-w-[280px] whitespace-normal">
                <div class="flex items-center gap-2 mb-2">
                    <span class="bg-brand-black text-white text-[8px] font-black px-2 py-0.5 rounded uppercase">${camp.templateName || "PROMO"}</span>
                </div>
                <p class="text-xs font-bold text-gray-700 line-clamp-2 italic leading-relaxed">"${camp.customMessage}"</p>
                ${camp.linkPath ? `<p class="text-[9px] font-bold text-blue-500 mt-2"><i class="fa-solid fa-link mr-1"></i>/${camp.linkPath}</p>` : ''}
            </td>
            <td class="p-4 align-top">
                <p class="text-[10px] font-black text-brand-black uppercase"><i class="fa-solid fa-user-tie text-gray-300 mr-2"></i> ${camp.sentBy || "Asesor"}</p>
            </td>
            <td class="p-4 align-top text-center">
                <p class="font-black text-brand-black text-sm">${camp.targetCount}</p>
                <p class="text-[8px] text-gray-400 font-bold uppercase mt-1">Contactos</p>
            </td>
            <td class="p-4 align-top text-center">
                <span class="px-2 py-1 rounded-md text-[10px] font-black uppercase ${successRate >= 90 ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : 'bg-orange-50 text-orange-600 border border-orange-100'}">
                    ${successRate}% Éxito
                </span>
                <p class="text-[9px] text-gray-500 font-bold mt-2">${camp.successCount} Entregados</p>
            </td>
            <td class="p-4 pr-6 align-top text-center">
                <button onclick="document.getElementById('det-${camp.id || idx}').classList.toggle('hidden')" class="w-10 h-10 rounded-full bg-white border border-gray-200 text-brand-cyan hover:bg-brand-cyan hover:text-white transition shadow-sm" title="Ver Lista de Clientes">
                    <i class="fa-solid fa-users-viewfinder text-sm"></i>
                </button>
            </td>
        </tr>
        
        <tr id="det-${camp.id || idx}" class="hidden bg-slate-50/50 border-b-2 border-brand-cyan/20">
            <td colspan="6" class="p-6">
                <div class="flex items-center justify-between mb-4">
                    <h4 class="text-[10px] font-black uppercase text-brand-black tracking-widest flex items-center gap-2">
                        <i class="fa-solid fa-list-check text-brand-cyan"></i> Reporte de Entrega
                    </h4>
                </div>
                <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 max-h-60 overflow-y-auto custom-scroll pr-2">
                    ${audienceListHtml}
                </div>
            </td>
        </tr>
    `;
}

onAuthStateChanged(auth, (user) => {
    if (user) {
        loadAdminStats();
    }
});

initChatList();